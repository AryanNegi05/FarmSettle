"""Claim challenges: farmer asks for review, insurer answers; money stays consistent."""
from datetime import date, timedelta

import pytest

from app.services import claims as engine
from app.services import disputes as disp
from app.services import farmer_view as view
from app.services import payments as pay

POLICY = {"id": "P1", "policy_number": "POL-1", "farm_id": "F1", "status": "active", "farmer_profile_id": "PR1",
          "coverage_start": date.today() - timedelta(days=5), "coverage_end": date.today() + timedelta(days=200),
          "sum_insured": 80000.0, "rainfall_trigger_mm": 20.0, "rainfall_max_payout_mm": 60.0, "payout_limit": None}


def mk(status, amount=40000.0, cid="C1", **extra):
    calc = engine.calculate_claim(POLICY, event_id="sim-x", event_date=date.today(), estimated_rainfall_mm=40.0, sensor_trust=0.9)
    return {"id": cid, "policy_id": "P1", "farm_id": "F1", "farmer_profile_id": "PR1", "event_id": "sim-x", "status": status,
            "outcome": "PAY", "recommended_amount": amount, "calculation": calc.to_dict(), "history": [], **extra}


def challenged(status, **kw):
    c = mk(status, **kw)
    return {**c, **disp.apply_challenge(c, "amount_too_low", "My loss was much higher than this.", "farmer-uid")}


@pytest.mark.parametrize("status", ["REJECTED", "APPROVED", "PAID"])
def test_decided_claims_can_be_challenged(status):
    assert disp.challenge_problem(mk(status)) is None


@pytest.mark.parametrize("status", ["AWAITING_APPROVAL", "UNDER_INVESTIGATION", "ON_HOLD", "CREATED"])
def test_undecided_claims_cannot_be_challenged(status):
    assert disp.challenge_problem(mk(status))


def test_one_open_challenge_and_a_maximum():
    c = challenged("PAID")
    assert "already" in disp.challenge_problem(c)
    c2 = {**mk("PAID"), "disputes": [{"id": 1, "status": "dismissed"}, {"id": 2, "status": "dismissed"}]}
    assert "at most" in disp.challenge_problem(c2)


def test_challenge_moves_to_disputed_and_remembers_where_it_was():
    c = challenged("PAID")
    assert c["status"] == "DISPUTED" and c["pre_dispute_status"] == "PAID"
    assert engine.can_transition("PAID", "DISPUTED") and engine.can_transition("APPROVED", "DISPUTED")
    assert c["history"][-1]["to"] == "DISPUTED" and c["disputes"][0]["status"] == "open"


def test_disputed_paid_claim_still_counts_as_paid_for_caps_and_reconciliation():
    c = challenged("PAID")
    assert engine.is_committed(c) and engine.effective_status(c) == "PAID"
    rec = pay.reconcile([c], [{"claim_id": "C1", "amount": 40000.0}])
    assert rec["balanced"], rec["issues"]
    assert pay.portfolio_stats([c], [{"claim_id": "C1", "amount": 40000.0}])["paid"] == 1


def test_dismiss_restores_the_previous_status():
    for before in ("PAID", "REJECTED", "APPROVED"):
        upd, sup = disp.resolve(challenged(before), POLICY, [], outcome="dismiss", note="Checked, decision stands.", amount=None, by_uid="i")
        assert upd["status"] == before and sup is None and upd["disputes"][0]["status"] == "dismissed"


def test_uphold_on_paid_claim_creates_a_separate_supplementary_claim_not_a_second_payment():
    c = challenged("PAID")
    upd, sup = disp.resolve(c, POLICY, [c], outcome="uphold", note="Gauge was wrong.", amount=15000.0, by_uid="i")
    assert upd["status"] == "PAID"                         # original stays paid
    assert sup["status"] == "AWAITING_APPROVAL" and sup["recommended_amount"] == 15000.0
    assert sup["parent_claim_id"] == "C1" and sup["supplementary"] and sup["id"] == "C1__adj1"


def test_uphold_cannot_exceed_the_policy_cap():
    c = challenged("PAID", amount=70000.0)
    with pytest.raises(ValueError, match="cap"):
        disp.resolve(c, POLICY, [c], outcome="uphold", note="ok", amount=20000.0, by_uid="i")   # 70k + 20k > 80k
    with pytest.raises(ValueError):
        disp.resolve(c, POLICY, [c], outcome="uphold", note="ok", amount=0, by_uid="i")


def test_uphold_on_unpaid_claim_returns_to_approval_with_corrected_amount():
    c = challenged("REJECTED", amount=0.0)
    with pytest.raises(ValueError):                         # nothing to approve without a corrected amount
        disp.resolve(c, POLICY, [c], outcome="uphold", note="ok", amount=None, by_uid="i")
    upd, sup = disp.resolve(c, POLICY, [c], outcome="uphold", note="Re-checked.", amount=30000.0, by_uid="i")
    assert upd["status"] == "AWAITING_APPROVAL" and upd["recommended_amount"] == 30000.0 and sup is None
    assert upd["original_recommended_amount"] == 0.0


def test_cannot_resolve_without_an_open_challenge():
    with pytest.raises(ValueError):
        disp.resolve(mk("PAID"), POLICY, [], outcome="dismiss", note="x", amount=None, by_uid="i")


def test_farmer_view_reflects_the_challenge_and_the_answer():
    c = challenged("PAID")
    v = view.explain(c, farm=None, policy=POLICY, run=None, payment=None)
    assert v["dispute"]["open"] and not v["dispute"]["can_challenge"] and v["status"]["label"] == "Challenge under review"
    assert v["status"]["step"] == 4                          # progress stays at "Paid"
    upd, _ = disp.resolve(c, POLICY, [c], outcome="dismiss", note="Decision stands.", amount=None, by_uid="i")
    v2 = view.explain({**c, **upd}, farm=None, policy=POLICY, run=None, payment=None)
    assert v2["dispute"]["items"][0]["status"] == "dismissed" and v2["dispute"]["items"][0]["response"] == "Decision stands."
    assert v2["dispute"]["can_challenge"]                     # may challenge once more (max 2)
