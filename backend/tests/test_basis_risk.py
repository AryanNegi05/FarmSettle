"""Basis Risk Monitor: indicators from rainfall vs trigger, the claim engine result and recorded loss reports."""
from datetime import date, timedelta

import pytest

from app.services import basis_risk as br
from app.services import claims as engine
from app.services import command_centre as cc
from tests.test_command_centre import make_farms


def mk(mu, sigma=1.0, trig=20.0, full=60.0, insured=80000.0, trust=0.9, risk="moderate", flood=0.3, policy=True, fid="F1"):
    pol = {"id": "P1", "policy_number": "POL-1", "farm_id": fid, "status": "active",
           "coverage_start": date.today() - timedelta(days=5), "coverage_end": date.today() + timedelta(days=200),
           "sum_insured": insured, "rainfall_trigger_mm": trig, "rainfall_max_payout_mm": full, "payout_limit": None}
    calc = engine.calculate_claim(pol, event_id="e", event_date=date.today(), estimated_rainfall_mm=mu,
                                  rainfall_sigma_mm=sigma, sensor_trust=trust)
    return {"farm_id": fid, "name": f"Farm {fid}", "farmer_label": "Farmer", "crop": "cotton", "area_ha": 1.0, "centre": [79.15, 21.03],
            "estimated_rainfall": mu, "uncertainty": sigma, "lower": mu - 1.28 * sigma, "upper": mu + 1.28 * sigma,
            "sensor_confidence": trust, "risk": risk, "flood_probability": flood,
            "policy": {"id": "P1", "number": "POL-1", "sum_insured": insured, "trigger": trig, "full": full, "payout_limit": None} if policy else None,
            "claim": None if not policy else {"outcome": calc.outcome, "recommended_amount": calc.recommended_amount,
                                               "entitlement": calc.entitlement, "trigger_crossed": calc.trigger_crossed}}


def report(pct, farm="F1", on="2026-01-01", **kw):
    return {"id": "R1", "farm_id": farm, "loss_pct": pct, "source": "insurer_field", "cause": "excess_rain",
            "observed_on": on, "created_at": on + "T00:00:00Z", "note": "", **kw}


def flags(a):
    return {f["id"] for f in a["flags"]}


def test_probability_of_crossing_the_trigger():
    assert br.p_trigger_crossed(20.0, 3.0, 20.0) == 0.5
    assert br.p_trigger_crossed(26.0, 3.0, 20.0) > 0.97
    assert br.p_trigger_crossed(12.0, 3.0, 20.0) < 0.01
    assert br.p_trigger_crossed(19.0, 0.0, 20.0) == 0.0 and br.p_trigger_crossed(21.0, 0.0, 20.0) == 1.0


def test_calm_farm_far_from_trigger_is_aligned():
    a = br.assess_farm(mk(4.0, risk="low", flood=0.05), None)
    assert a["verdict"] == "aligned" and a["flags"] == [] and a["under"]["level"] == a["over"]["level"] == "none"


def test_near_miss_is_an_under_compensation_indicator_not_proof():
    a = br.assess_farm(mk(18.5, sigma=2.5), None)           # 7.5% below the trigger, decent chance it was crossed
    assert "UC_NEAR_MISS" in flags(a) and a["verdict"] == "under_risk"
    assert a["payout"]["amount"] == 0 and a["evidence"] == "model_only" and a["under"]["basis"] == "model"


def test_reported_loss_with_no_payout_is_a_high_report_backed_flag():
    a = br.assess_farm(mk(6.0, risk="low", flood=0.05), report(80.0))
    f = next(x for x in a["flags"] if x["id"] == "UC_REPORTED_LOSS")
    assert f["level"] == "high" and f["basis"] == "reported" and a["under"]["basis"] == "reported" and a["evidence"] == "reported"


def test_trigger_crossed_but_small_reported_loss_is_an_over_compensation_flag():
    a = br.assess_farm(mk(70.0, risk="extreme", flood=0.8), report(5.0))
    f = next(x for x in a["flags"] if x["id"] == "OC_REPORTED_LOW")
    assert f["level"] == "high" and a["verdict"] == "over_risk" and a["payout"]["ratio"] == 1.0


def test_marginal_crossing_and_moderately_weak_sensors_flag_over_compensation_without_any_report():
    a = br.assess_farm(mk(20.5, sigma=4.0, trust=0.7), None)   # engine pays (trust >= 0.6) but the crossing is a coin flip
    assert {"OC_MARGINAL_TRIGGER", "OC_LOW_TRUST"} <= flags(a)
    assert a["over"]["basis"] == "model" and a["payout"]["amount"] > 0


def test_untrusted_sensors_hold_the_payout_so_the_over_payment_flag_does_not_apply():
    a = br.assess_farm(mk(21.0, sigma=4.0, trust=0.4), None)   # engine HOLD, nothing is paid
    assert a["payout"]["amount"] == 0 and not {"OC_LOW_TRUST", "OC_MARGINAL_TRIGGER"} & flags(a)


def test_low_trigger_gives_large_payout_for_modest_rain():
    a = br.assess_farm(mk(10.0, trig=4.0, full=8.0, risk="low", flood=0.05), None)
    assert "OC_LOW_DAMAGE_PROXY" in flags(a)


def test_high_damage_potential_without_payout_is_flagged_but_a_contradicting_report_suppresses_it():
    high = mk(15.0, trig=40.0, full=80.0, risk="extreme", flood=0.9)
    assert "UC_DAMAGE_PROXY" in flags(br.assess_farm(high, None))
    assert "UC_DAMAGE_PROXY" not in flags(br.assess_farm(high, report(2.0)))


def test_held_claim_is_flagged_as_delayed():
    a = br.assess_farm(mk(60.0, sigma=40.0, trust=0.3), None)   # engine HOLD: entitlement but nothing recommended
    assert a["payout"]["outcome"] in ("HOLD", "ADVANCE") and "UC_DELAYED" in flags(a)


def test_farm_without_policy_is_reported_as_a_coverage_gap_only_when_damage_is_plausible():
    quiet = br.assess_farm(mk(3.0, policy=False, risk="low", flood=0.05), None)
    wet = br.assess_farm(mk(70.0, policy=False, risk="extreme", flood=0.9), None)
    assert quiet["verdict"] == "uninsured" and quiet["flags"] == []
    assert wet["verdict"] == "no_cover" and "UC_NO_COVER" in flags(wet)


def test_latest_loss_report_per_farm_wins():
    reps = [report(10.0, on="2026-01-01"), {**report(70.0, on="2026-02-01"), "id": "R2"}]
    assert br.latest_reports(reps)["F1"]["loss_pct"] == 70.0


def test_portfolio_summary_and_ordering():
    ev = {"farms": [mk(4.0, fid="A", risk="low", flood=0.05), mk(6.0, fid="B", risk="low", flood=0.05), mk(70.0, fid="C", risk="extreme", flood=0.8)]}
    out = br.assess_all(ev, [report(80.0, farm="B"), report(5.0, farm="C")])
    s = out["summary"]
    assert s["farms"] == 3 and s["under_flagged"] == 1 and s["over_flagged"] == 1 and s["aligned"] == 1
    assert s["farms_with_reports"] == 2 and s["report_backed_flags"] == 2 and s["mean_abs_gap"] is not None
    assert [a["farm_id"] for a in out["assessments"]][-1] == "A"           # aligned farm sorts last
    assert any("not proof" in n for n in out["notes"])


def test_works_on_a_real_command_centre_evaluation():
    farms = make_farms(8)
    ev = cc.evaluate(cc.Controls(district_mm_hr=22.0, seed=3), farms=[dict(f) for f in farms])
    out = br.assess_all(ev, [])
    assert len(out["assessments"]) == 8
    for a in out["assessments"]:
        assert a["verdict"] in ("aligned", "under_risk", "over_risk", "mixed", "no_cover", "uninsured", "insufficient")
        assert a["rain"]["estimate"] is not None and a["centre"] and a["crop"] == "cotton"
        assert all(f["basis"] == "model" for f in a["flags"])              # no reports given: nothing can be report-backed
