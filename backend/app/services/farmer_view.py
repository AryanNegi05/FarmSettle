"""Farmer-facing view of a claim: plain language, every step of "why this amount", no internal ids.

Pure functions over already-loaded records so they can be tested without Firestore. Nothing here
calculates money: it re-states what the deterministic claim engine stored in the claim.
"""
from __future__ import annotations

from typing import Any, Optional

from app.services import disputes as disp

Z = 1.2816   # same 80 % bound the claim engine uses

TRACKER = ["Rain detected", "Evidence checked", "Insurer review", "Approved", "Paid"]

# status -> (tracker step reached, headline, tone, what happens next)
STATUS: dict[str, tuple[int, str, str, str]] = {
    "CREATED": (1, "Claim opened", "info", "We are checking the rain evidence for your farm."),
    "UNDER_INVESTIGATION": (1, "Checking the evidence", "warn",
                            "The rain evidence needs a closer look before your insurer can decide."),
    "RECOMMENDED": (2, "Waiting for your insurer", "info", "Your insurer will review and decide."),
    "AWAITING_APPROVAL": (2, "Waiting for your insurer", "info", "Your insurer will review and decide."),
    "ON_HOLD": (2, "On hold", "warn", "Your insurer paused this claim. Nothing is lost; they will resume it."),
    "APPROVED": (3, "Approved", "good", "Payment is being sent to your registered bank account."),
    "PAYMENT_PENDING": (3, "Approved, payment in progress", "good", "Payment is on its way."),
    "PAID": (4, "Paid", "good", "The money has been sent to your bank account."),
    "REJECTED": (2, "Not approved", "bad", "You can ask your insurer to review this decision."),
    "DISPUTED": (2, "Challenge under review", "warn", "Your insurer is reviewing your challenge. You will see their answer here."),
}

STATUS_LABEL = {
    "CREATED": "Claim opened", "UNDER_INVESTIGATION": "Evidence being checked", "RECOMMENDED": "Recommended",
    "AWAITING_APPROVAL": "Sent to insurer for approval", "ON_HOLD": "Put on hold", "APPROVED": "Approved by insurer",
    "PAYMENT_PENDING": "Payment started", "PAID": "Paid to your bank account", "REJECTED": "Not approved",
    "DISPUTED": "You challenged this decision",
}


def _inr(v: float) -> str:
    return f"₹{round(float(v)):,}"


def _row(label: str, value: str, key: str, vkey: str, **vars: Any) -> dict[str, Any]:
    """A fact row. `label`/`value` are English fallbacks; the frontend renders `key`/`vkey` with `vars`
    in the farmer's language, so the numbers are always the engine's and only the wording is translated."""
    return {"label": label, "value": value, "key": key, "vkey": vkey, "vars": vars}


def is_simulated(claim: dict[str, Any]) -> bool:
    return str(claim.get("event_id", "")).startswith(("sim-", "command-centre-sim"))


def status_view(claim: dict[str, Any]) -> dict[str, Any]:
    step, label, tone, nxt = STATUS.get(claim.get("status", ""), (1, claim.get("status", ""), "info", ""))
    if claim.get("status") == "DISPUTED" and claim.get("pre_dispute_status") in STATUS:
        step = STATUS[claim["pre_dispute_status"]][0]       # progress stays where the decision had reached
    return {"code": claim.get("status"), "label": label, "tone": tone, "next": nxt,
            "tracker": TRACKER, "step": step, "stopped": claim.get("status") in ("REJECTED", "ON_HOLD", "DISPUTED")}


def list_item(claim: dict[str, Any], farm_name: Optional[str], policy_number: Optional[str]) -> dict[str, Any]:
    c = claim.get("calculation") or {}
    return {
        "id": claim["id"], "farm_name": farm_name, "policy_number": policy_number,
        "amount": claim.get("recommended_amount", 0), "outcome": claim.get("outcome"),
        "status": status_view(claim), "created_at": claim.get("created_at"),
        "rain_mm": c.get("estimated_rainfall_mm"), "trigger_mm": c.get("trigger_start_mm"),
        "paid_at": claim.get("paid_at"), "simulated": is_simulated(claim),
        "disputed": claim.get("status") == "DISPUTED", "supplementary": bool(claim.get("supplementary")),
    }


def _outcome_text(c: dict[str, Any]) -> str:
    o = c.get("outcome")
    if o == "PAY":
        return "Rain was above your trigger even at the cautious end of our estimate, so the full calculated amount is recommended."
    if o == "ADVANCE":
        return ("Rain probably crossed your trigger, but the estimate is uncertain. A partial advance is recommended now "
                "and the balance depends on further evidence.")
    if o == "HOLD":
        return "The evidence is not yet strong enough to pay. Your insurer will look into it."
    return "No payout is due for this event."


def dispute_view(claim: dict[str, Any]) -> dict[str, Any]:
    """Whether the farmer can challenge this claim, and the history of their challenges."""
    problem = disp.challenge_problem(claim)
    items = [{"id": d["id"], "category": disp.CATEGORIES.get(d["category"], d["category"]), "category_id": d["category"], "reason": d["reason"],
              "status": d["status"], "created_at": d["created_at"], "resolved_at": d.get("resolved_at"),
              "response": d.get("resolution_note"), "outcome": d.get("resolution")}
             for d in claim.get("disputes", [])]
    can = problem is None
    code = None if can else ("open" if "already" in problem else "max" if "at most" in problem else "undecided")
    return {"can_challenge": can, "blocked_reason": None if can else problem, "blocked_code": code,
            "categories": [{"id": k, "label": v} for k, v in disp.CATEGORIES.items()],
            "items": items, "open": disp.open_dispute(claim) is not None,
            "supplementary_of": claim.get("parent_claim_id")}


def explain(claim: dict[str, Any], *, farm: Optional[dict], policy: Optional[dict], run: Optional[dict],
            payment: Optional[dict]) -> dict[str, Any]:
    """Build the transparent "why this claim, why this amount" story for the farmer."""
    c = claim.get("calculation") or {}
    mu = float(c.get("estimated_rainfall_mm") or 0)
    sigma = float(c.get("rainfall_sigma_mm") or 0)
    trig, full = c.get("trigger_start_mm"), c.get("trigger_full_mm")
    insured = float(c.get("sum_insured") or 0)
    sev = float(c.get("severity") or 0)
    entitlement = float(c.get("entitlement") or 0)
    paid_before = float(c.get("already_paid") or 0)
    recommended = float(claim.get("recommended_amount") or 0)

    # Evidence details come only from this farm's slice of the agent run (no other farmer's data).
    findings = next((f for f in ((run or {}).get("sensor") or {}).get("farm_findings", []) if f.get("farm_id") == claim.get("farm_id")), None)
    comp = next((f for f in ((run or {}).get("compliance") or {}).get("farms", []) if f.get("farm_id") == claim.get("farm_id")), None)
    rec = next((r for r in (run or {}).get("recommendations", []) if r.get("farm_id") == claim.get("farm_id")), None)

    rng = {"mu": round(mu, 2), "low": round(max(0.0, mu - Z * sigma), 1), "high": round(mu + Z * sigma, 1)}
    evidence_rows = [
        _row("Estimated rain at your farm", f"{mu:g} mm/hr" + (f" (likely between {rng['low']} and {rng['high']})" if sigma else ""),
             "row.estRain", "val.estRainRange" if sigma else "val.mmhr", **rng),
        _row("Trust in the rain gauges used", "not available" if c.get("sensor_trust") is None else f"{float(c['sensor_trust']):.0%}",
             "row.trust", "val.na" if c.get("sensor_trust") is None else "val.pct", v=c.get("sensor_trust")),
    ]
    if findings:
        n = findings.get("contributing_sensors", 0)
        evidence_rows.append(_row("Gauges used for your farm", str(n), "row.gaugesUsed", "val.num", v=n))
        if findings.get("excluded_sensors"):
            evidence_rows.append(_row("Gauges left out (looked faulty)", ", ".join(findings["excluded_sensors"]),
                                      "row.gaugesLeftOut", "val.text", v=", ".join(findings["excluded_sensors"])))
        verdict = findings.get("verdict")
        evidence_rows.append(_row("Evidence verdict", {"verified": "Verified", "uncertain": "Uncertain", "insufficient": "Not enough"}.get(verdict, "n/a"),
                                  "row.verdict", f"val.verdict.{verdict}" if verdict in ("verified", "uncertain", "insufficient") else "val.na"))

    pn = (policy or {}).get("policy_number") or "n/a"
    policy_rows = [
        _row("Policy", pn, "row.policy", "val.text", v=pn),
        _row("Pays from", f"{trig:g} mm/hr of rain" if trig is not None else "n/a", "row.paysFrom", "val.mmhr" if trig is not None else "val.na", mu=trig),
        _row("Pays in full at", f"{full:g} mm/hr of rain" if full is not None else "n/a", "row.paysFull", "val.mmhr" if full is not None else "val.na", mu=full),
        _row("Sum insured", _inr(insured), "row.sumInsured", "val.inr", v=insured),
    ]
    if c.get("payout_limit") is not None:
        policy_rows.append(_row("Payout limit", _inr(c["payout_limit"]), "row.payoutLimit", "val.inr", v=c["payout_limit"]))

    calc_rows = [
        _row("How far past the trigger", f"{sev:.0%} of the way to full payout", "row.severity", "val.severity", v=sev),
        _row(f"{sev:.0%} of {_inr(insured)}", _inr(entitlement), "row.entitlement", "val.inr", sev=sev, insured=insured, v=entitlement),
    ]
    if paid_before:
        calc_rows.append(_row("Already paid on this policy", f"− {_inr(paid_before)}", "row.alreadyPaid", "val.minusInr", v=paid_before))
    if c.get("cap_applied"):
        calc_rows.append(_row("Reduced to stay within your limit", _inr(c.get("payable_amount", 0)), "row.capped", "val.inr", v=c.get("payable_amount", 0)))
    if c.get("outcome") == "ADVANCE":
        calc_rows.append(_row("Advance (part now, rest after checks)", _inr(recommended), "row.advance", "val.inr", v=recommended))
    if claim.get("original_recommended_amount") is not None:
        o = claim["original_recommended_amount"]
        calc_rows.append(_row("Corrected after your challenge", f"{_inr(o)} → {_inr(recommended)}", "row.corrected", "val.fromTo", a=o, b=recommended))
    calc_rows.append(_row("Amount for this claim", _inr(recommended), "row.amountFinal", "val.inr", v=recommended))

    checks = []
    if comp:
        labels = {"not_duplicate": "No duplicate claim for this storm", "within_policy_limit": "Within your policy limit",
                  "evidence_complete": "Evidence complete", "evidence_verified": "Rain evidence verified",
                  "within_budget": "Within the insurer's payout budget"}
        checks = [{"id": k, "label": labels[k], "ok": bool(v)} for k, v in (comp.get("checks") or {}).items() if k in labels]

    timeline = [{"at": h.get("at"), "code": h.get("to"), "label": STATUS_LABEL.get(h.get("to"), h.get("to")),
                 "note": h.get("reason") if h.get("to") not in ("CREATED",) else None}
                for h in claim.get("history", [])]

    if claim.get("supplementary"):
        calc_rows = [_row("Additional payment after your challenge", _inr(recommended), "row.additional", "val.inr", v=recommended)]
    sections = [
        {"id": "measured", "title": "1. What the rain gauges measured", "rows": evidence_rows, "note_key": "note.measured",
         "note": "Your farm has no gauge of its own, so rain is estimated from nearby gauges, trusting reliable ones more and ignoring faulty ones."},
        {"id": "policy", "title": "2. What your policy says", "rows": policy_rows, "note_key": "note.policy",
         "note": "Nothing is paid below the trigger. Payout rises evenly from the trigger up to the full level."},
        {"id": "amount", "title": "3. How your amount was worked out", "rows": calc_rows,
         "note_key": "note.supplementary" if claim.get("supplementary") else f"note.outcome.{c.get('outcome') or 'NONE'}",
         "note": ("Your insurer agreed with your challenge and approved an additional payment on top of your earlier claim."
                  if claim.get("supplementary") else _outcome_text(c))},
    ]
    return {
        "id": claim["id"], "farm_name": (farm or {}).get("name"), "policy_number": (policy or {}).get("policy_number"),
        "amount": recommended, "outcome": c.get("outcome"), "status": status_view(claim),
        "simulated": is_simulated(claim),
        "headline": (f"{_inr(recommended)} for {(farm or {}).get('name') or 'your farm'}" if recommended else "No payout for this event"),
        "gauge": {"rain": mu, "rain_low": max(0.0, mu - Z * sigma), "rain_high": mu + Z * sigma,
                  "trigger": trig, "full": full, "severity": sev},
        "formula": "Payout = sum insured × (rain − trigger) ÷ (full − trigger), limited by your policy cap and earlier payments.",
        "sections": sections, "checks": checks, "reasons": c.get("reasons") or [],
        "ai_summary": (rec or {}).get("explanation"),
        "decision": {"by_human": claim.get("status") in ("APPROVED", "PAYMENT_PENDING", "PAID", "REJECTED", "ON_HOLD"),
                     "reason": claim.get("decision_reason"), "at": claim.get("decided_at")},
        "timeline": timeline,
        "dispute": dispute_view(claim),
        "payment": None if not payment else {
            "amount": payment.get("amount"), "reference": payment.get("transaction_ref"), "at": payment.get("created_at"),
            "to": (payment.get("destination") or {}).get("account"), "bank": (payment.get("destination") or {}).get("bank_name"),
            "simulated": payment.get("simulated", True)},
        "created_at": claim.get("created_at"),
    }
