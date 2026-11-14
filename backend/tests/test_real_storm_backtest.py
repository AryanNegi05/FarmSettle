"""Backtest: replay a real storm (ERA5-Land, Nagpur, 12-14 Jul 2022) through the claim engine.

Expected payouts below are worked out BY HAND from the formula, not by calling the engine:

    severity    = (rain - trigger) / (full - trigger)
    entitlement = sum_insured * severity

Test policy: sum insured 100,000, 3-day cumulative trigger 100 mm, full payout at 200 mm.
Event rainfall: 54.95 + 34.14 + 35.87 = 124.96 mm  ->  severity 0.2496  ->  24,960.00.

NOTE: ERA5-Land is reanalysis, not a gauge record (see fixture `is_gauge_record`).
"""
import json
import pathlib
from datetime import date

import pytest

from app.services.claims import calculate_claim

FIXTURE = pathlib.Path(__file__).parent.parent / "data" / "validation" / "vidarbha_2022_07.json"
EVENT = json.loads(FIXTURE.read_text())

HAND_TOTAL_MM = 124.96
HAND_PAYOUT = 24960.00


def policy(**over):
    p = {
        "id": "pol-real", "farm_id": "farm-nagpur", "status": "active",
        "coverage_start": date(2022, 6, 1), "coverage_end": date(2022, 10, 31),
        "sum_insured": 100000.0, "rainfall_trigger_mm": 100.0,
        "rainfall_max_payout_mm": 200.0, "payout_limit": None, "flood_trigger_level": None,
    }
    p.update(over)
    return p


def run(rain, **kw):
    return calculate_claim(policy(), event_id="vidarbha-2022-07", event_date="2022-07-14",
                           estimated_rainfall_mm=rain, sensor_trust=kw.pop("trust", 0.9), **kw)


def test_fixture_is_labelled_honestly():
    assert EVENT["is_gauge_record"] is False
    assert "ERA5" in EVENT["source"]


def test_three_day_total_matches_hand_sum():
    total = sum(d["mm"] for d in EVENT["daily_mm"])
    assert total == pytest.approx(HAND_TOTAL_MM, abs=0.01)


def test_real_storm_reaches_correct_payout():
    total = sum(d["mm"] for d in EVENT["daily_mm"])
    c = run(total)
    assert c.outcome == "PAY"
    assert c.trigger_crossed
    assert c.severity == pytest.approx(0.2496, abs=1e-4)
    assert c.payable_amount == pytest.approx(HAND_PAYOUT, abs=0.01)
    assert c.recommended_amount == pytest.approx(HAND_PAYOUT, abs=0.01)


def test_replay_is_deterministic():
    total = sum(d["mm"] for d in EVENT["daily_mm"])
    assert run(total).to_dict() == run(total).to_dict()


def test_single_day_below_trigger_pays_nothing():
    peak_day = max(d["mm"] for d in EVENT["daily_mm"])   # 54.95 mm < 100 mm trigger
    c = run(peak_day)
    assert c.outcome == "NONE" and c.recommended_amount == 0.0


def test_quiet_day_before_storm_pays_nothing():
    c = run(EVENT["prior_day"]["mm"])
    assert c.outcome == "NONE" and c.payable_amount == 0.0


def test_uncertainty_moderate_still_pays_in_full():
    # sigma 15 mm: lower bound 124.96 - 1.2816*15 = 105.7 mm, still above trigger -> PAY
    assert run(HAND_TOTAL_MM, rainfall_sigma_mm=15.0).outcome == "PAY"


def test_uncertainty_large_gives_bounded_advance():
    # sigma 25 mm: lower bound 92.9 mm < trigger -> ADVANCE = 50 % of 24,960
    c = run(HAND_TOTAL_MM, rainfall_sigma_mm=25.0)
    assert c.outcome == "ADVANCE"
    assert c.recommended_amount == pytest.approx(HAND_PAYOUT * 0.5, abs=0.01)
