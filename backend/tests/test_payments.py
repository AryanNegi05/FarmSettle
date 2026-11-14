"""Stage 9: simulated payment rules (pure functions)."""
from app.services import payments as pay


def claim(**o):
    c = {"id": "f__e__p", "status": "APPROVED", "recommended_amount": 50000.0, "policy_id": "p",
         "farm_id": "f", "farmer_profile_id": "u1", "event_id": "e"}
    c.update(o)
    return c


BANK = {"bank_name": "Test Bank", "masked_account_number": "****1234",
        "account_holder_name": "A Farmer", "verification_status": "verified"}


def test_approved_claim_with_verified_bank_is_payable():
    assert pay.validate_payable(claim(), BANK) == []


def test_unapproved_claim_not_payable():
    assert pay.validate_payable(claim(status="AWAITING_APPROVAL"), BANK)


def test_paid_claim_cannot_be_paid_again():
    assert "already paid" in " ".join(pay.validate_payable(claim(status="PAID"), BANK)).lower()


def test_missing_or_unverified_bank_blocks():
    assert pay.validate_payable(claim(), None)
    assert pay.validate_payable(claim(), {**BANK, "verification_status": "pending"})


def test_zero_amount_blocks():
    assert pay.validate_payable(claim(recommended_amount=0), BANK)


def test_payment_record_is_simulated_and_masked():
    r = pay.build_payment_record(claim(), BANK, "ins1")
    assert r["simulated"] and r["transaction_ref"].startswith("SIM-")
    assert r["amount"] == 50000.0 and r["destination"]["account"] == "****1234"


def test_reconcile_balanced_and_detects_problems():
    c = claim(status="PAID")
    p = {"claim_id": c["id"], "amount": 50000.0}
    assert pay.reconcile([c], [p])["balanced"]
    assert not pay.reconcile([c], [])["balanced"]                         # paid, no payment
    assert not pay.reconcile([claim()], [p])["balanced"]                  # payment, not paid
    assert not pay.reconcile([c], [{**p, "amount": 1.0}])["balanced"]     # amount mismatch


def test_portfolio_stats():
    s = pay.portfolio_stats(
        [claim(status="AWAITING_APPROVAL"), claim(id="b", status="PAID"), claim(id="c", status="ON_HOLD")],
        [{"claim_id": "b", "amount": 50000.0}],
    )
    assert s["awaiting_approval"] == 1 and s["paid"] == 1 and s["on_hold"] == 1
    assert s["amount_paid"] == 50000.0 and s["approved_exposure"] == 50000.0
