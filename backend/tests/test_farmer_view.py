"""Stage 10: the farmer's plain-language "why this amount" view."""
from datetime import date, timedelta

from app.services import claims as engine
from app.services import farmer_view as view

POLICY = {"id": "P1", "policy_number": "POL-1", "farm_id": "F1", "status": "active", "farmer_profile_id": "PR1",
          "coverage_start": date.today() - timedelta(days=5), "coverage_end": date.today() + timedelta(days=200),
          "sum_insured": 80000.0, "rainfall_trigger_mm": 20.0, "rainfall_max_payout_mm": 60.0, "payout_limit": None}


def claim_for(rain, sigma=2.0, trust=0.9, paid=0.0, status="AWAITING_APPROVAL", event="sim-abc"):
    calc = engine.calculate_claim(POLICY, event_id=event, event_date=date.today(), estimated_rainfall_mm=rain,
                                  rainfall_sigma_mm=sigma, sensor_trust=trust, already_paid=paid)
    return {"id": calc.idempotency_key, "policy_id": "P1", "farm_id": "F1", "event_id": event, "status": status,
            "outcome": calc.outcome, "recommended_amount": calc.recommended_amount, "calculation": calc.to_dict(),
            "history": [{"at": "2026-01-01T00:00:00Z", "by": "secret-user-uid", "from": None, "to": status, "reason": "Queued"}],
            "created_at": "2026-01-01T00:00:00Z", "decided_by": "secret-user-uid"}


def test_explanation_restates_the_engine_numbers():
    c = claim_for(rain=40.0)               # halfway between 20 and 60 → 50 % of 80,000
    v = view.explain(c, farm={"name": "Negi farm"}, policy=POLICY, run=None, payment=None)
    amount_rows = {r["label"]: r["value"] for r in v["sections"][2]["rows"]}
    assert v["amount"] == c["recommended_amount"] == 40000.0
    assert amount_rows["Amount for this claim"] == "₹40,000"
    assert "50%" in amount_rows["How far past the trigger"]
    assert v["gauge"]["trigger"] == 20.0 and v["gauge"]["full"] == 60.0 and v["gauge"]["rain"] == 40.0
    assert v["headline"].startswith("₹40,000") and "Negi farm" in v["headline"]


def test_prior_payments_and_caps_are_shown():
    c = claim_for(rain=70.0, paid=36740.0)          # full severity but ₹36,740 already paid
    rows = {r["label"]: r["value"] for r in view.explain(c, farm=None, policy=POLICY, run=None, payment=None)["sections"][2]["rows"]}
    assert rows["Already paid on this policy"] == "− ₹36,740"
    assert rows["Amount for this claim"] == "₹43,260"


def test_no_payout_is_explained_not_hidden():
    v = view.explain(claim_for(rain=5.0, status="REJECTED"), farm=None, policy=POLICY, run=None, payment=None)
    assert v["amount"] == 0 and "No payout" in v["headline"]
    assert v["status"]["tone"] == "bad" and v["status"]["stopped"]


def test_no_internal_ids_leak_to_the_farmer():
    import json
    v = view.explain(claim_for(rain=40.0), farm=None, policy=POLICY, run=None, payment=None)
    assert "secret-user-uid" not in json.dumps(v)


def test_agent_run_adds_only_this_farms_evidence():
    run = {"sensor": {"farm_findings": [
              {"farm_id": "F1", "contributing_sensors": 4, "excluded_sensors": ["RG-3"], "verdict": "uncertain"},
              {"farm_id": "OTHER", "contributing_sensors": 9, "excluded_sensors": [], "verdict": "verified"}]},
           "compliance": {"farms": [{"farm_id": "F1", "checks": {"not_duplicate": True, "within_policy_limit": True, "evidence_verified": False}}]},
           "recommendations": [{"farm_id": "F1", "explanation": "40.0 mm/hr against a 20 mm/hr trigger"}]}
    v = view.explain(claim_for(rain=40.0), farm=None, policy=POLICY, run=run, payment=None)
    ev = {r["label"]: r["value"] for r in v["sections"][0]["rows"]}
    assert ev["Gauges used for your farm"] == "4" and "RG-3" in ev["Gauges left out (looked faulty)"]
    assert {"id": "evidence_verified", "label": "Rain evidence verified", "ok": False} in v["checks"]
    assert v["ai_summary"].startswith("40.0 mm/hr") and "9" not in ev.values()


def test_paid_claim_shows_masked_payment_and_tracker_at_paid():
    pay = {"amount": 40000.0, "transaction_ref": "SIM-ABC", "created_at": "t", "simulated": True,
           "destination": {"account": "XXXX1234", "bank_name": "SBI"}}
    v = view.explain(claim_for(rain=40.0, status="PAID"), farm=None, policy=POLICY, run=None, payment=pay)
    assert v["payment"]["to"] == "XXXX1234" and v["status"]["step"] == 4 and v["status"]["tone"] == "good"


def test_simulated_storms_are_labelled():
    assert view.explain(claim_for(rain=40.0, event="sim-1"), farm=None, policy=POLICY, run=None, payment=None)["simulated"] is True
    assert view.explain(claim_for(rain=40.0, event="real-2024-07"), farm=None, policy=POLICY, run=None, payment=None)["simulated"] is False


def test_rows_carry_keys_and_raw_numbers_so_the_frontend_can_translate():
    v = view.explain(claim_for(rain=70.0, paid=36740.0), farm=None, policy=POLICY, run=None, payment=None)
    rows = {r["key"]: r for r in v["sections"][2]["rows"]}
    assert rows["row.alreadyPaid"]["vars"]["v"] == 36740.0 and rows["row.alreadyPaid"]["vkey"] == "val.minusInr"
    assert rows["row.amountFinal"]["vars"]["v"] == 43260.0
    assert v["sections"][2]["note_key"] == "note.outcome.PAY"
    assert all(t["code"] for t in v["timeline"])
