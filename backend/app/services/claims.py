"""Deterministic parametric claim engine (Stage 8).

Pure functions only: no database, no network, no LLM. Given a policy and farm-level
evidence it always returns the same result, so every decision can be replayed from
the stored inputs plus ENGINE_VERSION.

PROTOTYPE FORMULA (the roadmap's illustrative one). Real policy wording, exclusions,
waiting periods and caps must determine a production calculation:

    severity    = clip((rainfall - trigger_start) / (trigger_full - trigger_start), 0, 1)
    entitlement = sum_insured * severity          (then capped, minus prior payments)

Uncertainty never silently increases a payout: the amount is computed from the point
estimate, but the *outcome* depends on the lower/upper confidence bounds and on sensor
trust (see `calculate_claim`).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, field
from datetime import date, datetime
from typing import Any, Optional

ENGINE_VERSION = "claims-1.0"

# Claim lifecycle (roadmap Stage 8).
STATUSES = (
    "CREATED", "UNDER_INVESTIGATION", "RECOMMENDED", "AWAITING_APPROVAL",
    "APPROVED", "ON_HOLD", "REJECTED", "PAYMENT_PENDING", "PAID", "DISPUTED",
)

# Allowed status transitions. PAID/REJECTED are terminal except DISPUTED.
TRANSITIONS: dict[str, set[str]] = {
    "CREATED": {"UNDER_INVESTIGATION", "RECOMMENDED", "AWAITING_APPROVAL", "REJECTED"},
    "UNDER_INVESTIGATION": {"RECOMMENDED", "AWAITING_APPROVAL", "ON_HOLD", "REJECTED"},
    "RECOMMENDED": {"AWAITING_APPROVAL", "ON_HOLD", "REJECTED"},
    "AWAITING_APPROVAL": {"APPROVED", "ON_HOLD", "REJECTED"},
    "ON_HOLD": {"AWAITING_APPROVAL", "APPROVED", "REJECTED"},
    "APPROVED": {"PAYMENT_PENDING", "ON_HOLD"},
    "PAYMENT_PENDING": {"PAID", "ON_HOLD"},
    "PAID": {"DISPUTED"},
    "REJECTED": {"DISPUTED"},
    "DISPUTED": {"AWAITING_APPROVAL", "REJECTED"},
}


@dataclass(frozen=True)
class ClaimConfig:
    """Explicit, configurable settlement rules (no hidden thresholds)."""
    z_score: float = 1.2816          # 80 % one-sided bound
    min_sensor_trust: float = 0.6    # below this, evidence is not trusted enough to pay
    advance_fraction: float = 0.5    # bounded advance when the trigger crossing is uncertain
    default_full_multiple: float = 1.5   # full payout at 1.5 x trigger if the policy gives none


@dataclass
class ClaimCalculation:
    # inputs (kept verbatim so the decision can be replayed)
    policy_id: str
    farm_id: str
    event_id: str
    event_date: str
    estimated_rainfall_mm: float
    rainfall_sigma_mm: float
    sensor_trust: Optional[float]
    water_level: Optional[float]
    already_paid: float
    # policy parameters actually used
    sum_insured: float
    trigger_start_mm: Optional[float]
    trigger_full_mm: Optional[float]
    payout_limit: Optional[float]
    # outputs
    eligible: bool
    outcome: str                     # PAY | ADVANCE | HOLD | NONE
    severity: float
    severity_lower: float
    severity_upper: float
    entitlement: float               # before caps
    payable_amount: float            # after caps and prior payments (what the outcome would pay)
    recommended_amount: float        # 0 for HOLD/NONE; bounded for ADVANCE
    cap_applied: bool
    trigger_crossed: bool
    flood_trigger_crossed: bool
    requires_human_approval: bool
    needs_investigation: bool
    reasons: list[str] = field(default_factory=list)
    idempotency_key: str = ""
    engine_version: str = ENGINE_VERSION

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def idempotency_key(farm_id: str, event_id: str, policy_id: str) -> str:
    """Settlement identity: one claim per farm + event + policy."""
    return f"{farm_id}__{event_id}__{policy_id}"


def severity(rainfall_mm: float, trigger_start: float, trigger_full: float) -> float:
    """Graduated severity in [0, 1]."""
    if trigger_full <= trigger_start:
        return 1.0 if rainfall_mm >= trigger_start else 0.0
    return min(1.0, max(0.0, (rainfall_mm - trigger_start) / (trigger_full - trigger_start)))


def _as_date(v: Any) -> date:
    if isinstance(v, datetime):   # Firestore timestamps arrive as datetimes
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def calculate_claim(
    policy: dict[str, Any],
    *,
    event_id: str,
    event_date: Any,
    estimated_rainfall_mm: float,
    rainfall_sigma_mm: float = 0.0,
    sensor_trust: Optional[float] = None,
    water_level: Optional[float] = None,
    already_paid: float = 0.0,
    config: ClaimConfig = ClaimConfig(),
) -> ClaimCalculation:
    """Compute the claim recommendation for one policy and one event."""
    reasons: list[str] = []
    sum_insured = float(policy.get("sum_insured") or 0.0)
    trigger = policy.get("rainfall_trigger_mm")
    trigger = float(trigger) if trigger is not None else None
    full = policy.get("rainfall_max_payout_mm")
    if trigger is not None:
        if full is None or float(full) <= trigger:
            full_v = trigger * config.default_full_multiple
            if full is not None:
                reasons.append("Policy full-payout level was not above the trigger; default 1.5x trigger used.")
        else:
            full_v = float(full)
    else:
        full_v = None
    limit = policy.get("payout_limit")
    limit = float(limit) if limit is not None else None
    sigma = max(0.0, float(rainfall_sigma_mm or 0.0))
    mu = float(estimated_rainfall_mm)

    # ── eligibility ─────────────────────────────────────────────────────────
    eligible = True
    if policy.get("status") != "active":
        eligible = False
        reasons.append(f"Policy status is '{policy.get('status')}', not active.")
    try:
        d = _as_date(event_date)
        if not (_as_date(policy["coverage_start"]) <= d <= _as_date(policy["coverage_end"])):
            eligible = False
            reasons.append("Event date is outside the coverage period.")
    except Exception:  # noqa: BLE001
        eligible = False
        reasons.append("Event date or coverage dates are missing or invalid.")
    if trigger is None:
        eligible = False
        reasons.append("Policy has no rainfall trigger configured.")
    if sum_insured <= 0:
        eligible = False
        reasons.append("Policy sum insured is not positive.")

    flood_trigger = policy.get("flood_trigger_level")
    flood_crossed = (
        flood_trigger is not None and water_level is not None and float(water_level) >= float(flood_trigger)
    )

    def blank(outcome: str) -> ClaimCalculation:
        return ClaimCalculation(
            policy_id=str(policy.get("id", "")), farm_id=str(policy.get("farm_id", "")),
            event_id=event_id, event_date=str(event_date)[:10],
            estimated_rainfall_mm=mu, rainfall_sigma_mm=sigma, sensor_trust=sensor_trust,
            water_level=water_level, already_paid=already_paid, sum_insured=sum_insured,
            trigger_start_mm=trigger, trigger_full_mm=full_v, payout_limit=limit,
            eligible=eligible, outcome=outcome, severity=0.0, severity_lower=0.0,
            severity_upper=0.0, entitlement=0.0, payable_amount=0.0, recommended_amount=0.0,
            cap_applied=False, trigger_crossed=False, flood_trigger_crossed=bool(flood_crossed),
            requires_human_approval=False, needs_investigation=False, reasons=reasons,
            idempotency_key=idempotency_key(str(policy.get("farm_id", "")), event_id, str(policy.get("id", ""))),
        )

    if not eligible:
        reasons.append("Not eligible: no payout.")
        return blank("NONE")

    assert trigger is not None and full_v is not None
    sev = severity(mu, trigger, full_v)
    sev_lo = severity(mu - config.z_score * sigma, trigger, full_v)
    sev_hi = severity(mu + config.z_score * sigma, trigger, full_v)

    entitlement = sum_insured * sev
    cap = sum_insured if limit is None else min(sum_insured, limit)
    remaining = max(0.0, cap - already_paid)
    payable = min(entitlement, remaining)
    cap_applied = payable < entitlement

    calc = blank("NONE")
    calc.severity, calc.severity_lower, calc.severity_upper = sev, sev_lo, sev_hi
    calc.entitlement = round(entitlement, 2)
    calc.payable_amount = round(payable, 2)
    calc.cap_applied = cap_applied
    calc.trigger_crossed = mu >= trigger

    trust_ok = sensor_trust is None or sensor_trust >= config.min_sensor_trust

    # ── outcome (uncertainty-aware, never increases the payout) ─────────────
    if sev_hi <= 0.0:
        calc.outcome = "NONE"
        reasons.append("Even the upper confidence bound is below the trigger: no payout.")
    elif remaining <= 0.0 and sev > 0:
        calc.outcome = "NONE"
        reasons.append("Policy cap already fully paid: nothing further payable.")
    elif sev_lo > 0.0 and trust_ok:
        calc.outcome = "PAY"
        calc.recommended_amount = calc.payable_amount
        reasons.append("Trigger crossed even at the lower confidence bound with trusted sensor evidence.")
    elif sev > 0.0 and trust_ok:
        calc.outcome = "ADVANCE"
        calc.recommended_amount = round(calc.payable_amount * config.advance_fraction, 2)
        calc.needs_investigation = True
        reasons.append(
            f"Trigger crossing is uncertain: bounded advance ({int(config.advance_fraction * 100)}%) "
            "recommended; balance depends on further evidence."
        )
    else:
        calc.outcome = "HOLD"
        calc.needs_investigation = True
        if not trust_ok:
            reasons.append(
                f"Sensor trust {sensor_trust:.2f} is below {config.min_sensor_trust:.2f}: hold for investigation."
            )
        else:
            reasons.append("Evidence is inconclusive at the point estimate: hold for investigation.")

    if cap_applied:
        reasons.append("Amount reduced by the sum-insured / payout-limit / prior-payment cap.")
    if flood_crossed:
        reasons.append("Flood water-level trigger was also crossed (informational; not added to the rainfall payout).")

    calc.requires_human_approval = calc.outcome in ("PAY", "ADVANCE", "HOLD")
    calc.reasons = reasons
    return calc


def can_transition(current: str, new: str) -> bool:
    return new in TRANSITIONS.get(current, set())


def initial_status(calc: ClaimCalculation) -> str:
    """Status a freshly calculated claim starts in."""
    if calc.outcome == "NONE":
        return "REJECTED" if not calc.eligible else "CREATED"
    if calc.needs_investigation:
        return "UNDER_INVESTIGATION"
    return "AWAITING_APPROVAL"
