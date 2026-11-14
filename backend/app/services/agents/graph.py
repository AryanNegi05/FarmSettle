"""LangGraph workflow: Storm Intelligence → Sensor Investigation → Claims Resolution → Compliance & Audit.

Every tool call and hand-off is written to a trace the insurer can read. Amounts come only from the
deterministic claim engine. The run ends at `awaiting_human`: nothing becomes a claim until an
authorised user queues it, and nothing is paid until a human approves it in the claims queue.
"""
import hashlib
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.core.config import settings
from app.services import claims as engine
from app.services import command_centre as cc
from app.services.agents import llm as llm_mod

AGENTS = ("Storm Intelligence", "Sensor Investigation", "Claims Resolution", "Compliance & Audit")
COMMITTED = {"APPROVED", "PAYMENT_PENDING", "PAID"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def inr(v: float) -> str:
    return f"₹{round(v):,}"


def event_fingerprint(c: cc.Controls) -> str:
    """Same storm → same event id, so re-running an investigation can never create a second claim."""
    key = json.dumps({"d": c.district_mm_hr, "s": c.storm, "f": c.faults, "o": c.sensor_overrides,
                      "a": c.farm_adjust, "n": c.sensor_count, "seed": c.seed}, sort_keys=True, default=str)
    return "sim-" + hashlib.sha1(key.encode()).hexdigest()[:10]


class State(TypedDict, total=False):
    event: dict
    sensor: dict
    recommendations: list
    compliance: dict
    approval_status: str


@dataclass
class Context:
    controls: cc.Controls
    run_id: str
    event_id: str
    farms: Optional[list] = None                                  # injectable (tests)
    get_policy: Callable[[str], Optional[dict]] = lambda pid: None
    paid_for_policy: Callable[[str], float] = lambda pid: 0.0
    claim_exists: Callable[[str], bool] = lambda key: False
    narrate: Callable[[str, dict], Optional[dict]] = llm_mod.narrate
    evaluation: dict = field(default_factory=dict)
    trace: list = field(default_factory=list)
    agents: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)

    # ── trace helpers ──────────────────────────────────────────────────────
    def log(self, agent: str, kind: str, name: str, detail: str, ms: Optional[int] = None) -> None:
        self.trace.append({"n": len(self.trace) + 1, "at": _now(), "agent": agent, "kind": kind,
                           "name": name, "detail": detail, "ms": ms})

    def tool(self, agent: str, name: str, fn: Callable, summarize: Callable[[Any], str], *a, **kw):
        t0 = time.time()
        try:
            out = fn(*a, **kw)
        except Exception as e:  # noqa: BLE001
            self.log(agent, "error", name, f"{type(e).__name__}: {e}", round((time.time() - t0) * 1000))
            self.errors.append(f"{agent}: {name} failed")
            raise
        self.log(agent, "tool", name, summarize(out), round((time.time() - t0) * 1000))
        return out

    def explain(self, agent: str, role: str, facts: dict, fallback: str, concerns: list[str]) -> None:
        t0 = time.time()
        out = self.narrate(role, facts)
        src = "llm" if out else "fallback"
        self.agents[agent] = {"summary": out["summary"] if out else fallback,
                              "concerns": (out["concerns"] if out else None) or concerns, "source": src}
        self.log(agent, "llm" if out else "note", "explain",
                 "Model-written explanation" if out else "Deterministic explanation (no LLM)",
                 round((time.time() - t0) * 1000))

    def handoff(self, a: str, b: str, what: str) -> None:
        self.log(a, "handoff", f"→ {b}", what)


def _guard(agent: str, ctx: Context, fn: Callable[[State], dict]) -> Callable[[State], dict]:
    """A failing agent records the error and lets the graph continue; Compliance then blocks."""
    def run(state: State) -> dict:
        try:
            return fn(state)
        except Exception as e:  # noqa: BLE001
            ctx.agents.setdefault(agent, {"summary": f"{agent} could not complete: {e}", "concerns": [str(e)],
                                          "source": "error"})
            return {}
    return run


# ─── Agent 1: Storm Intelligence ──────────────────────────────────────────────

def storm_agent(ctx: Context) -> Callable[[State], dict]:
    A = AGENTS[0]

    def node(state: State) -> dict:
        ev = ctx.tool(A, "evaluate_scenario", cc.evaluate,
                      lambda r: f"{r['summary']['farms']} farms, {len(r['sensors'])} sensors evaluated",
                      ctx.controls, farms=[dict(f) for f in ctx.farms] if ctx.farms is not None else None)
        ctx.evaluation = ev
        farms = ev["farms"]
        affected = [f for f in farms if f["claim"] and f["claim"]["trigger_crossed"]]
        ctx.log(A, "tool", "list_affected_farms",
                f"{len(affected)} of {len(farms)} farms have estimated rain at or above their policy trigger")
        c = ctx.controls
        scope = ("a storm cell" if c.storm else "district-wide rain")
        peak = c.storm["peak_mm_hr"] if c.storm else c.district_mm_hr
        exposure = sum(float((f["policy"] or {}).get("sum_insured") or 0) for f in affected)
        event = {
            "event_id": ctx.event_id, "kind": "storm" if c.storm else "district_rain", "peak_mm_hr": peak,
            "district_mm_hr": c.district_mm_hr, "storm": c.storm,
            "farms_total": len(farms), "affected_farm_ids": [f["farm_id"] for f in affected],
            "affected": [{"farm_id": f["farm_id"], "name": f["name"], "farmer": f["farmer_label"],
                          "estimated_mm_hr": f["estimated_rainfall"]} for f in affected],
            "exposure_sum_insured": round(exposure, 2), "source": "simulated (slider/preset)"}
        ctx.explain(A, "Storm Intelligence: describe the event and the affected farms",
                    {k: event[k] for k in ("kind", "peak_mm_hr", "farms_total", "exposure_sum_insured")}
                    | {"affected": event["affected"][:8]},
                    f"{scope[0].upper()}{scope[1:]} with a peak of {peak:g} mm/hr puts {len(affected)} of {len(farms)} farms at or above their trigger "
                    f"({inr(exposure)} insured).",
                    [] if affected else ["No farm is at or above its policy trigger."])
        ctx.handoff(A, AGENTS[1], f"event {ctx.event_id}: {len(affected)} candidate farms")
        return {"event": event}
    return _guard(A, ctx, node)


# ─── Agent 2: Sensor Investigation ────────────────────────────────────────────

def sensor_agent(ctx: Context) -> Callable[[State], dict]:
    A = AGENTS[1]

    def node(state: State) -> dict:
        ev = ctx.evaluation
        sensors = ctx.tool(A, "get_sensor_findings", lambda: ev["sensors"],
                           lambda s: f"{sum(x['status']=='faulty' for x in s)} faulty, "
                                     f"{sum(x['status']=='suspicious' for x in s)} suspicious of {len(s)} sensors")
        flagged = [{"id": s["id"], "class": s["classification"], "confidence": s["confidence"], "note": s["note"]}
                   for s in sensors if s["status"] == "faulty"]
        genuine = [s["id"] for s in sensors if s["classification"] == "genuine_localised_cell"]
        affected_ids = set(state["event"]["affected_farm_ids"])
        findings = []
        for f in ev["farms"]:
            if f["farm_id"] not in affected_ids:
                continue
            trust, n = f["sensor_confidence"], len(f["contributors"])
            if f["estimated_rainfall"] is None or trust is None:
                verdict = "insufficient"
            elif trust >= 0.6 and n >= 2 and not f["excluded"]:
                verdict = "verified"
            else:
                verdict = "uncertain"
            findings.append({"farm_id": f["farm_id"], "name": f["name"], "estimated_mm_hr": f["estimated_rainfall"],
                             "uncertainty": f["uncertainty"], "trust": trust, "contributing_sensors": n,
                             "excluded_sensors": [e["sensor_id"] for e in f["excluded"]], "verdict": verdict})
        ctx.log(A, "tool", "get_farm_estimates",
                f"Gaussian-process rain estimate + uncertainty for {len(findings)} affected farms")
        ctx.log(A, "tool", "compare_neighbours",
                f"{sum(x['verdict']=='verified' for x in findings)} verified, "
                f"{sum(x['verdict']!='verified' for x in findings)} uncertain/insufficient")
        sensor = {"flagged": flagged, "genuine_localised": genuine, "farm_findings": findings,
                  "flagged_count": len(flagged)}
        ctx.explain(A, "Sensor Investigation: judge whether the rain evidence is trustworthy",
                    {"flagged_sensors": flagged, "localised_cells": genuine, "farm_findings": findings[:8]},
                    (f"{len(flagged)} sensor(s) flagged faulty and excluded; " if flagged else "No sensor flagged faulty; ")
                    + f"{sum(x['verdict']=='verified' for x in findings)} of {len(findings)} affected farms have verified evidence.",
                    [f"Sensor {x['id']} classified {x['class']} ({x['confidence']:.0%})" for x in flagged][:4])
        ctx.handoff(A, AGENTS[2], f"{len(findings)} farm evidence packs")
        return {"sensor": sensor}
    return _guard(A, ctx, node)


# ─── Agent 3: Claims Resolution ───────────────────────────────────────────────

def claims_agent(ctx: Context) -> Callable[[State], dict]:
    A = AGENTS[2]

    def node(state: State) -> dict:
        verdict = {f["farm_id"]: f["verdict"] for f in state["sensor"]["farm_findings"]}
        recs = []
        for f in ctx.evaluation["farms"]:
            if f["farm_id"] not in verdict or not f["policy"]:
                continue
            pid = f["policy"]["id"]
            policy = ctx.tool(A, "get_policy", ctx.get_policy, lambda p: f"{p['policy_number']} sum insured {inr(p['sum_insured'])}"
                              if p else "policy record not found", pid) if pid else None
            if not policy:
                continue
            paid = ctx.paid_for_policy(pid)
            calc = ctx.tool(A, "calculate_claim", engine.calculate_claim,
                            lambda c: f"{c.outcome} {inr(c.recommended_amount)} (severity {c.severity:.0%})",
                            policy, event_id=ctx.event_id, event_date=date.today(),
                            estimated_rainfall_mm=round(f["estimated_rainfall"], 2),
                            rainfall_sigma_mm=round(f["uncertainty"] or 0.0, 2),
                            sensor_trust=None if f["sensor_confidence"] is None else round(f["sensor_confidence"], 3),
                            already_paid=paid)
            amt = calc.recommended_amount
            why = (f"{f['estimated_rainfall']:.1f} mm/hr estimated against a {calc.trigger_start_mm:g} mm/hr trigger "
                   f"(full payout at {calc.trigger_full_mm:g}) → severity {calc.severity:.0%} of {inr(calc.sum_insured)}; "
                   f"engine outcome {calc.outcome}" + (f", recommended {inr(amt)}." if amt else "."))
            recs.append({"farm_id": f["farm_id"], "farm": f["name"], "farmer": f["farmer_label"],
                         "policy_id": pid, "policy_number": policy.get("policy_number"), "farmer_profile_id": policy.get("farmer_profile_id"), "outcome": calc.outcome,
                         "amount": amt, "evidence": verdict[f["farm_id"]], "explanation": why,
                         "reasons": calc.reasons, "calculation": calc.to_dict()})
        total = sum(r["amount"] for r in recs)
        ctx.explain(A, "Claims Resolution: explain each proposed outcome; the amounts are fixed by the engine",
                    {"proposals": [{k: r[k] for k in ("farm", "outcome", "amount", "evidence", "explanation")}
                                   | {"severity_pct": round(r["calculation"]["severity"] * 100),
                                      "sum_insured": r["calculation"]["sum_insured"],
                                      "already_paid": r["calculation"]["already_paid"]} for r in recs[:8]],
                     "total": total},
                    f"{len(recs)} claim proposal(s) totalling {inr(total)}; every amount comes from the deterministic claim engine.",
                    [f"{r['farm']}: {r['outcome']} needs investigation" for r in recs if r["outcome"] in ("HOLD", "ADVANCE")][:4])
        ctx.handoff(A, AGENTS[3], f"{len(recs)} proposals, total {inr(total)}")
        return {"recommendations": recs}
    return _guard(A, ctx, node)


# ─── Agent 4: Compliance & Audit ──────────────────────────────────────────────

def compliance_agent(ctx: Context) -> Callable[[State], dict]:
    A = AGENTS[3]

    def node(state: State) -> dict:
        recs = state.get("recommendations") or []
        upstream_failed = bool(ctx.errors) or any(a.get("source") == "error" for a in ctx.agents.values())
        total = sum(r["amount"] for r in recs)
        over_budget = total > settings.agent_payout_budget
        ctx.log(A, "tool", "check_budget", f"run total {inr(total)} vs budget {inr(settings.agent_payout_budget)}"
                + (" — OVER BUDGET" if over_budget else " — within budget"))
        out = []
        for r in recs:
            calc, flags, checks = r["calculation"], [], {}
            checks["not_duplicate"] = not ctx.claim_exists(calc["idempotency_key"])
            cap = min(calc["sum_insured"], calc["payout_limit"]) if calc["payout_limit"] is not None else calc["sum_insured"]
            checks["within_policy_limit"] = calc["already_paid"] + r["amount"] <= cap + 0.01
            checks["evidence_complete"] = (calc["sensor_trust"] is not None and r["evidence"] != "insufficient")
            checks["evidence_verified"] = r["evidence"] == "verified"
            checks["within_budget"] = not over_budget
            if not checks["not_duplicate"]:
                flags.append("A claim for this farm, event and policy already exists.")
            if not checks["within_policy_limit"]:
                flags.append("Amount would exceed the policy limit.")
            if not checks["evidence_complete"]:
                flags.append("Evidence is incomplete.")
            if not checks["evidence_verified"] and checks["evidence_complete"]:
                flags.append("Sensor evidence is uncertain; investigate before paying.")
            if over_budget:
                flags.append("Run exceeds the payout budget.")
            if r["amount"] >= settings.agent_large_claim:
                flags.append("Large claim: senior review.")
            if upstream_failed:
                flags.append("An earlier agent failed; blocked until re-run.")
            hard = upstream_failed or not (checks["not_duplicate"] and checks["within_policy_limit"] and checks["within_budget"])
            if r["outcome"] == "NONE" or r["amount"] <= 0 and r["outcome"] != "HOLD":
                status = "no_action"
            elif hard:
                status = "blocked"
            elif r["outcome"] in ("HOLD", "ADVANCE") or not checks["evidence_verified"] or not checks["evidence_complete"]:
                status = "needs_investigation"
            else:
                status = "ready_for_approval"
            out.append({"farm_id": r["farm_id"], "farm": r["farm"], "policy_id": r["policy_id"], "outcome": r["outcome"],
                        "amount": r["amount"], "status": status, "checks": checks, "flags": flags,
                        "idempotency_key": calc["idempotency_key"]})
        ctx.log(A, "tool", "check_duplicates_and_limits",
                f"{sum(not o['checks']['not_duplicate'] for o in out)} duplicate(s), "
                f"{sum(not o['checks']['within_policy_limit'] for o in out)} over limit")
        ctx.log(A, "tool", "check_evidence_completeness",
                f"{sum(o['checks']['evidence_complete'] for o in out)} of {len(out)} complete")
        queueable = [o for o in out if o["status"] in ("ready_for_approval", "needs_investigation")]
        if upstream_failed:
            approval = "blocked"
        elif queueable:
            approval = "awaiting_human"
        else:
            approval = "no_claims"
        compliance = {"farms": out, "total_amount": total, "budget": settings.agent_payout_budget,
                      "needs_human": len(queueable), "approval_status": approval}
        ctx.explain(A, "Compliance & Audit: report the checks and whether a person must approve",
                    {"approval_status": approval, "farms": [{k: o[k] for k in ("farm", "outcome", "amount", "status", "flags")} for o in out[:8]]},
                    {"awaiting_human": f"{len(queueable)} claim(s) ({inr(sum(o['amount'] for o in queueable))}) passed the checks "
                                       "and are waiting for a human decision. No money moves until a person approves.",
                     "blocked": "An earlier step failed, so nothing is queued. Re-run the investigation.",
                     "no_claims": "No claim needs action for this event."}[approval],
                    sorted({fl for o in out for fl in o["flags"]})[:5])
        ctx.log(A, "handoff", "→ Human reviewer", {"awaiting_human": f"{len(queueable)} claims paused for approval",
                                                  "blocked": "run blocked", "no_claims": "nothing to review"}[approval])
        return {"compliance": compliance, "approval_status": approval}
    return _guard(A, ctx, node)


# ─── Orchestration ────────────────────────────────────────────────────────────

def build_graph(ctx: Context):
    g = StateGraph(State)
    g.add_node("storm", storm_agent(ctx))
    g.add_node("sensor", sensor_agent(ctx))
    g.add_node("claims", claims_agent(ctx))
    g.add_node("compliance", compliance_agent(ctx))
    g.add_edge(START, "storm")
    g.add_edge("storm", "sensor")
    g.add_edge("sensor", "claims")
    g.add_edge("claims", "compliance")
    g.add_edge("compliance", END)
    return g.compile()


def run_investigation(controls: cc.Controls, *, farms: Optional[list] = None, get_policy=None, paid_for_policy=None,
                      claim_exists=None, narrate=None) -> dict[str, Any]:
    """Run the four agents on the current scenario and return the full, replayable record."""
    run_id = uuid.uuid4().hex[:12]
    ctx = Context(controls=controls, run_id=run_id, event_id=event_fingerprint(controls), farms=farms)
    if get_policy: ctx.get_policy = get_policy
    if paid_for_policy: ctx.paid_for_policy = paid_for_policy
    if claim_exists: ctx.claim_exists = claim_exists
    if narrate: ctx.narrate = narrate
    t0 = time.time()
    final = build_graph(ctx).invoke({})
    if "compliance" not in final:      # an agent failed before Compliance could run: block explicitly
        final["compliance"] = {"farms": [], "total_amount": 0, "needs_human": 0, "approval_status": "blocked"}
        final["approval_status"] = "blocked"
    used_llm = any(a.get("source") == "llm" for a in ctx.agents.values())
    return {
        "id": run_id, "created_at": _now(), "event_id": ctx.event_id, "approval_status": final["approval_status"],
        "event": final.get("event"), "sensor": final.get("sensor"), "recommendations": [
            {k: v for k, v in r.items() if k != "calculation"} | {"calculation": r["calculation"]}
            for r in final.get("recommendations", [])],
        "compliance": final["compliance"], "agents": [{"name": n, **ctx.agents[n]} for n in AGENTS if n in ctx.agents],
        "trace": ctx.trace, "errors": ctx.errors,
        "llm": {**llm_mod.status(), "used": used_llm},
        "controls": {"district_mm_hr": controls.district_mm_hr, "storm": controls.storm, "faults": controls.faults,
                     "farm_adjust": controls.farm_adjust, "sensor_count": controls.sensor_count, "seed": controls.seed},
        "elapsed_ms": round((time.time() - t0) * 1000),
        "queued_claim_ids": [],
    }


def queue_claims(run: dict, user_uid: str, create_claim_once: Callable[[str, dict], tuple[dict, bool]]) -> list[dict]:
    """Human action: turn the run's checked proposals into claim records (idempotent) for review."""
    ok = {o["farm_id"] for o in run["compliance"]["farms"] if o["status"] in ("ready_for_approval", "needs_investigation")}
    made = []
    for r in run["recommendations"]:
        if r["farm_id"] not in ok:
            continue
        calc = engine.ClaimCalculation(**r["calculation"])
        status = engine.initial_status(calc)
        record = {
            "policy_id": calc.policy_id, "farm_id": calc.farm_id, "farmer_profile_id": r.get("farmer_profile_id"),
            "event_id": calc.event_id, "status": status,
            "outcome": calc.outcome, "recommended_amount": calc.recommended_amount, "calculation": r["calculation"],
            "decision_reason": None, "agent_run_id": run["id"], "agent_explanation": r["explanation"],
            "history": [{"at": _now(), "by": user_uid, "from": None, "to": status,
                         "reason": f"Queued from agent investigation {run['id']}"}],
            "created_at": _now(), "created_by": user_uid}
        claim, created = create_claim_once(calc.idempotency_key, record)
        made.append({"claim_id": claim.get("id", calc.idempotency_key), "farm": r["farm"], "created": created,
                     "status": claim.get("status"), "amount": claim.get("recommended_amount")})
    return made
