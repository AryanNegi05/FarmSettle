"""Stage 8: deterministic claim engine (pure functions, no database)."""
from datetime import date

from app.services.claims import (
    calculate_claim, severity, idempotency_key, can_transition, initial_status, ClaimConfig,
)


def policy(**over):
    p = {
        "id": "pol1", "farm_id": "farm1", "status": "active",
        "coverage_start": date(2026, 1, 1), "coverage_end": date(2026, 12, 31),
        "sum_insured": 100000.0, "rainfall_trigger_mm": 75.0,
        "rainfall_max_payout_mm": 125.0, "payout_limit": None, "flood_trigger_level": None,
    }
    p.update(over)
    return p


def calc(rain, sigma=0.0, trust=0.9, pol=None, paid=0.0, d="2026-06-01"):
    return calculate_claim(pol or policy(), event_id="ev1", event_date=d,
                           estimated_rainfall_mm=rain, rainfall_sigma_mm=sigma,
                           sensor_trust=trust, already_paid=paid)


def test_severity_graduated():
    assert severity(50, 75, 125) == 0.0
    assert severity(100, 75, 125) == 0.5
    assert severity(200, 75, 125) == 1.0


def test_below_trigger_pays_nothing():
    c = calc(60)
    assert c.outcome == "NONE" and c.recommended_amount == 0 and not c.trigger_crossed


def test_midpoint_pays_half_sum_insured():
    c = calc(100)
    assert c.outcome == "PAY"
    assert c.payable_amount == 50000.0 and c.recommended_amount == 50000.0
    assert c.requires_human_approval


def test_never_exceeds_sum_insured():
    c = calc(500)
    assert c.payable_amount == 100000.0 and c.recommended_amount <= 100000.0


def test_payout_limit_caps_and_flags():
    c = calc(500, pol=policy(payout_limit=40000.0))
    assert c.payable_amount == 40000.0 and c.cap_applied


def test_prior_payments_reduce_remaining():
    c = calc(500, paid=70000.0)
    assert c.payable_amount == 30000.0
    c2 = calc(500, paid=100000.0)
    assert c2.outcome == "NONE" and c2.recommended_amount == 0


def test_uncertain_crossing_gives_bounded_advance():
    # point estimate just above trigger, wide uncertainty -> lower bound below trigger
    c = calc(85, sigma=15)
    assert c.outcome == "ADVANCE" and c.needs_investigation
    assert c.recommended_amount == round(c.payable_amount * 0.5, 2)


def test_uncertainty_never_increases_payout():
    certain = calc(100, sigma=0)
    uncertain = calc(100, sigma=20)
    assert uncertain.payable_amount == certain.payable_amount
    assert uncertain.recommended_amount <= certain.recommended_amount


def test_low_trust_holds():
    c = calc(100, trust=0.3)
    assert c.outcome == "HOLD" and c.recommended_amount == 0 and c.needs_investigation


def test_upper_bound_below_trigger_is_none():
    c = calc(30, sigma=5)
    assert c.outcome == "NONE"


def test_inactive_policy_and_outside_coverage_not_eligible():
    assert not calc(100, pol=policy(status="expired")).eligible
    out = calc(100, d="2027-03-01")
    assert not out.eligible and out.outcome == "NONE"


def test_missing_trigger_not_eligible():
    assert not calc(100, pol=policy(rainfall_trigger_mm=None)).eligible


def test_default_full_level_when_policy_has_none():
    c = calc(100, pol=policy(rainfall_max_payout_mm=None))
    assert c.trigger_full_mm == 75.0 * 1.5


def test_reproducible_from_inputs():
    assert calc(93.3, sigma=4).to_dict() == calc(93.3, sigma=4).to_dict()


def test_idempotency_key_is_farm_event_policy():
    assert idempotency_key("f", "e", "p") == "f__e__p"
    assert calc(100).idempotency_key == "farm1__ev1__pol1"


def test_status_machine():
    assert can_transition("AWAITING_APPROVAL", "APPROVED")
    assert not can_transition("PAID", "APPROVED")      # cannot be paid/approved again
    assert not can_transition("REJECTED", "PAID")
    assert initial_status(calc(100)) == "AWAITING_APPROVAL"
    assert initial_status(calc(85, sigma=15)) == "UNDER_INVESTIGATION"
