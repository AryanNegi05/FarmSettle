"""Assessment of ONE farmer's claim request.

The rainfall is the insurer's simulated scenario (a demo stand-in for real gauge data). From it the
backend builds a small evidence packet for that farm only:

    scenario → sensor readings → LightGBM trust → trust-weighted GP estimate at the farm (+/- sigma)
             → deterministic claim engine (the ONLY source of the amount)
             → LLM (optional) writes a plain-language explanation of that packet.

The model never produces or changes a number: its text is thrown away if it contains a figure that is
not in the packet, and a templated explanation is shown instead. The recommendation comes from the engine.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from app.services import command_centre as cc
from app.services.agents import llm

RECOMMEND = {"PAY": "approve", "ADVANCE": "approve", "HOLD": "hold", "NONE": "reject"}

SYSTEM = (
    "You assist an insurance officer reviewing ONE farmer's parametric rainfall claim. Use ONLY the facts in the "
    "user message. Never invent, change or recompute any number. Explain, in plain English, why the claim engine "
    "reached its outcome and amount, mention the sensor evidence and any uncertainty. Do not decide for the officer. "
    'Reply with a JSON object {"summary": "<=90 words", "concerns": ["short items, may be empty"]}.'
)


def sensor_windows(controls: cc.Controls, all_farms: list[dict[str, Any]], sensor_ids: list[str]) -> dict[str, dict]:
    """The recorded readings (5 previous + current, mm/hr) of the sensors that fed this farm's estimate."""
    fld, _ = cc.make_field(controls, all_farms)
    ctx = cc.sensor_context(controls, fld)
    now = {r.sensor_id: r.value for r in ctx["readings"]}
    out: dict[str, dict] = {}
    for sid in sensor_ids:
        if sid not in now or sid not in ctx["history"]:
            continue
        vals = [*ctx["history"][sid], now[sid]]
        out[sid] = {"readings_mm_hr": [round(v, 2) for v in vals], "latest": round(vals[-1], 2),
                    "peak": round(max(vals), 2), "mean": round(sum(vals) / len(vals), 2)}
    return out


def build_evidence(farm: dict[str, Any], windows: dict[str, dict], note: Optional[str],
                   committed: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    """Everything the engine and the model are allowed to see about this claim."""
    claim = farm.get("claim") or {}
    pol = farm.get("policy") or {}
    return {
        "farm": farm["name"], "farmer": farm["farmer_label"], "crop": farm.get("crop"), "area_ha": farm.get("area_ha"),
        "farmer_note": (note or "")[:300] or None,
        "rainfall": {"estimate_mm_hr": farm.get("estimated_rainfall"), "uncertainty_mm_hr": farm.get("uncertainty"),
                     "likely_range_mm_hr": [farm.get("lower"), farm.get("upper")]},
        "policy": {"number": pol.get("number"), "sum_insured": pol.get("sum_insured"), "trigger_mm_hr": pol.get("trigger"),
                   "full_payout_mm_hr": pol.get("full"), "already_paid": claim.get("already_paid", 0.0),
                   "earlier_claims": committed or []},
        "engine": {"outcome": claim.get("outcome"), "amount": claim.get("recommended_amount"),
                   "entitlement_before_caps": claim.get("entitlement"), "trigger_crossed": claim.get("trigger_crossed"),
                   "eligible": claim.get("eligible"), "reasons": claim.get("reasons", [])},
        "sensors_used": [{**c, "recorded": windows.get(c["sensor_id"])} for c in farm.get("contributors", [])],
        "sensors_excluded": farm.get("excluded", []),
        "sensor_confidence": farm.get("sensor_confidence"),
        "risk_category": farm.get("risk"), "flood_probability": farm.get("flood_probability"),
    }


def _inr(n: Any) -> str:
    return f"₹{round(float(n or 0)):,}"


def templated(ev: dict[str, Any]) -> dict[str, Any]:
    """Deterministic explanation, used when no model is configured or its answer was rejected."""
    r, p, e = ev["rainfall"], ev["policy"], ev["engine"]
    est = r["estimate_mm_hr"]
    lo, hi = r["likely_range_mm_hr"]
    head = (f"Estimated rainfall at {ev['farm']} is {est} mm/hr (likely {lo}–{hi}) against a trigger of "
            f"{p['trigger_mm_hr']} mm/hr and full payout at {p['full_payout_mm_hr']} mm/hr. ")
    tail = {
        "PAY": f"The trigger is crossed even at the lower bound with trusted sensors, so the engine recommends paying {_inr(e['amount'])}.",
        "ADVANCE": f"The trigger is crossed but not firmly at the lower bound, so the engine recommends a partial advance of {_inr(e['amount'])}.",
        "HOLD": "The evidence is not strong enough to pay yet (low sensor trust or an inconclusive estimate), so the engine holds the claim.",
        "NONE": "The estimate is below the trigger (or the policy cannot pay), so the engine recommends no payout.",
    }.get(e["outcome"], "")
    concerns = [f"{x['sensor_id']} excluded: {x['reason']}" for x in ev["sensors_excluded"][:3]]
    if ev["sensor_confidence"] is not None and ev["sensor_confidence"] < 0.75:
        concerns.append(f"Sensor confidence is only {round(ev['sensor_confidence'] * 100)}%.")
    return {"summary": head + tail, "concerns": concerns, "source": "template"}


def explain(ev: dict[str, Any]) -> dict[str, Any]:
    """Model-written explanation when available and number-checked, else the templated one."""
    facts = json.dumps(ev, default=str)[:6000]
    out = llm.chat_json(SYSTEM, facts)
    if out and isinstance(out.get("summary"), str):
        concerns = out.get("concerns") if isinstance(out.get("concerns"), list) else []
        text = out["summary"] + " " + " ".join(str(c) for c in concerns)
        if not llm.unsupported_numbers(text, facts):
            return {"summary": out["summary"].strip()[:700], "concerns": [str(c)[:200] for c in concerns][:5],
                    "source": "llm", "model": llm.settings.llm_model}
    return templated(ev)


def assess(controls: cc.Controls, farm_id: str, note: Optional[str], farms: Optional[list[dict[str, Any]]] = None,
           committed: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    all_farms = farms if farms is not None else cc._collect_farms()
    result = cc.evaluate(controls, farms=[dict(f) for f in all_farms], only_farm_ids={farm_id})
    farm = next((f for f in result["farms"] if f["farm_id"] == farm_id), None)
    if farm is None:
        raise KeyError(farm_id)
    if not farm["policy"] or not farm["claim"] or farm["estimated_rainfall"] is None:
        return {"farm": farm, "evidence": None, "ai": None, "recommendation": "reject",
                "problem": "This farm has no usable policy or rainfall estimate, so no claim amount can be calculated."}
    windows = sensor_windows(controls, [dict(f) for f in all_farms], [c["sensor_id"] for c in farm["contributors"]])
    ev = build_evidence(farm, windows, note, committed)
    cap = min(float(pol_ := farm["policy"]["sum_insured"] or 0), float(farm["policy"].get("payout_limit") or pol_))
    cap_used = cap > 0 and float(farm["claim"].get("already_paid") or 0) >= cap
    return {"farm": farm, "evidence": ev, "ai": explain(ev), "problem": None, "cap_exhausted": cap_used,
            "recommendation": RECOMMEND.get(farm["claim"]["outcome"], "hold"),
            "llm": llm.status()}
