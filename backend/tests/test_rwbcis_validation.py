"""Validation against the OFFICIAL RWBCIS Revised Operational Guidelines (DAC&FW, Govt. of India).

Part 1 - the guideline's own published worked example (para 21.6): the expected numbers come
from the document, not from our code.
Part 2 - the guideline's Annexure-1 excess-rainfall term sheet is internally consistent.
Part 3 - hand-worked payouts on real IMD data under that term sheet.
"""
import pytest

from app.services.rwbcis_backtest import PHASES, evaluate_district, guideline_example, run
from app.services.weather_index import slab_payout
from app.services.backtest import load_daily

DEF = dict(strike1=200.0, strike2=150.0, exit_=100.0, notional1=50.0, notional2=80.0, limit=6500.0, deficit=True)


# ── Part 1: published worked example (deficit cover, Rs/hectare) ────────────────
def test_published_rua_x_no_claim():            # observed 300 > strike 200
    assert slab_payout(300, **DEF) == 0.0


def test_published_rua_y_4900_per_hectare():     # {(200-150)*50} + {(150-120)*80}
    assert slab_payout(120, **DEF) == 4900.0
    assert slab_payout(120, **DEF) * 2 == 9800.0


def test_published_rua_z_full_limit():           # observed 80 breaches exit 100 -> 6500
    assert slab_payout(80, **DEF) == 6500.0
    assert slab_payout(80, **DEF) * 2 == 13000.0


def test_guideline_example_helper_all_match():
    assert all(c["matches"] for c in guideline_example())


# ── Part 2: Annexure-1 term sheet consistency (slab maths reaches the policy limit at exit) ─
@pytest.mark.parametrize("p", PHASES)
def test_term_sheet_slabs_add_up_to_limit(p):
    full = (p["strike2"] - p["strike1"]) * p["notional1"] + (p["exit"] - p["strike2"]) * p["notional2"]
    assert full == pytest.approx(p["limit"], abs=0.5)


# ── Part 3: real IMD data, hand-worked ──────────────────────────────────────────
def test_suburban_mumbai_september_phase_by_hand():
    # wettest 2 days 13+14 Sep 2026: 78.7 + 89.0 = 167.7 mm; phase 2: strike1 33, strike2 95, exit 200
    #   (95-33)*6.45 = 399.90 ; (167.7-95)*24.76 = 1800.05 ; total 2199.95 per hectare
    ev = evaluate_district(load_daily()["SUBURBAN MUMBAI"], hectares=1)
    ph = ev["phases"][1]
    assert (ph["window_start"], ph["window_end"], ph["observed_mm"]) == ("2026-09-13", "2026-09-14", 167.7)
    assert ph["payout_per_ha"] == pytest.approx(2199.95, abs=0.01)
    assert ev["payout_per_ha"] == pytest.approx(2199.95, abs=0.01)


def test_palghar_stays_in_first_slab():
    # 89.0 mm < strike2 95 -> only slab 1: (89-33)*6.45 = 361.20
    ev = evaluate_district(load_daily()["PALGHAR"], hectares=1)
    assert ev["payout_per_ha"] == pytest.approx(361.20, abs=0.01)


def test_payout_scales_with_hectares():
    d = load_daily()["SUBURBAN MUMBAI"]
    assert evaluate_district(d, 3)["payout"] == pytest.approx(3 * 2199.95, abs=0.02)


def test_payout_never_exceeds_policy_limit_and_is_monotonic():
    last = 0.0
    for mm in range(0, 400, 5):
        v = slab_payout(float(mm), 33, 95, 200, 6.45, 24.76, 3000.0)
        assert 0.0 <= v <= 3000.0 and v >= last
        last = v


def test_portfolio_totals():
    r = run(1.0)
    assert r["districts"] == 36
    assert r["total_payout"] == pytest.approx(sum(x["payout"] for x in r["results"]), abs=0.01)
    assert r["total_payout"] <= r["total_insured"]


def test_invalid_strike_order_rejected():
    with pytest.raises(ValueError):
        slab_payout(100, 175, 80, 285, 7.37, 20.91, 3000)


# ── Basis-risk proxies ──────────────────────────────────────────────────────────
def test_window_sensitivity_by_hand_suburban_mumbai():
    from app.services.rwbcis_backtest import basis_risk
    d = load_daily()["SUBURBAN MUMBAI"]
    br = basis_risk(d, evaluate_district(d, 1.0))
    w = br["payout_per_ha_by_window_days"]
    # 1-day index peak 89.0 (13 Sep?) hand: (89-33)*6.45 = 361.20 ; 2-day = 2199.95
    assert w[1] == pytest.approx(361.20, abs=0.01)
    assert w[2] == pytest.approx(2199.95, abs=0.01)
    assert w[1] < w[2] < w[3]          # longer window, more rain captured, higher payout


def test_amravati_misses_the_trigger_by_a_third_of_a_millimetre():
    from app.services.rwbcis_backtest import basis_risk
    d = load_daily()["AMARAVATI"]
    ev = evaluate_district(d, 1.0)
    br = basis_risk(d, ev)
    # Sept phase strike 1 = 33 mm; wettest 2 days 13-14 Sep = 32.7 mm -> 99.1 % of strike, payout 0
    assert ev["phases"][1]["observed_mm"] == 32.7 and ev["payout_per_ha"] == 0.0
    assert "NEAR_MISS" in br["flags"] and br["near_misses"][0]["pct_of_strike1"] == 99.1


def test_ratnagiri_heavy_week_low_payout():
    from app.services.rwbcis_backtest import basis_risk
    d = load_daily()["RATNAGIRI"]
    br = basis_risk(d, evaluate_district(d, 1.0))
    assert br["peak_7day_mm"] == pytest.approx(117.6, abs=0.05) and "HEAVY_WEEK_LOW_PAYOUT" in br["flags"]


def test_summary_counts_match_rows():
    r = run(1.0)
    assert r["basis_risk_summary"]["near_miss"] == sum("NEAR_MISS" in x["flags"] for x in r["results"])
