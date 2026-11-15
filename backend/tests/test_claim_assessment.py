"""Claim-request assessment: one farm, amount from the engine, model text number-checked, prior payments counted."""
from app.services import claim_assessment as ca
from app.services import command_centre as cc
from app.services.agents import llm
from tests.test_command_centre import make_farms


def controls(**kw):
    return cc.Controls(district_mm_hr=45.0, **kw)


def test_assess_single_farm_uses_engine_amount_and_template_without_llm(monkeypatch):
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: None)
    farms = make_farms()
    res = ca.assess(controls(), "F0", "water in field", farms=farms)
    ev, claim = res["evidence"], res["farm"]["claim"]
    assert ev["engine"]["amount"] == claim["recommended_amount"]
    assert res["ai"]["source"] == "template"
    assert res["recommendation"] == {"PAY": "approve", "ADVANCE": "approve", "HOLD": "hold", "NONE": "reject"}[claim["outcome"]]
    assert ev["farmer_note"] == "water in field"
    assert ev["sensors_used"] and ev["sensors_used"][0]["recorded"]["readings_mm_hr"]


def test_llm_text_with_invented_number_is_rejected(monkeypatch):
    farms = make_farms()
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: {"summary": "Pay 987654 rupees now.", "concerns": []})
    assert ca.assess(controls(), "F0", None, farms=farms)["ai"]["source"] == "template"


def test_llm_text_with_given_numbers_is_kept(monkeypatch):
    farms = make_farms()
    ev_est = ca.assess(controls(), "F0", None, farms=farms)["evidence"]["rainfall"]["estimate_mm_hr"]
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: {"summary": f"Estimated rain was {ev_est} mm/hr.", "concerns": []})
    assert ca.assess(controls(), "F0", None, farms=farms)["ai"]["source"] == "llm"


def test_farm_without_policy_has_no_amount():
    farms = make_farms(with_policy=False)
    res = ca.assess(controls(), "F0", None, farms=farms)
    assert res["problem"] and res["evidence"] is None and res["recommendation"] == "reject"


def test_prior_payments_reduce_liability():
    farms = make_farms()
    full = cc.evaluate(controls(), farms=[dict(f) for f in farms])["summary"]["total_liability"]
    paid = [dict(f, paid=f["policy"]["sum_insured"]) for f in farms]          # every cap already used
    assert full > 0
    assert cc.evaluate(controls(), farms=paid)["summary"]["total_liability"] == 0
