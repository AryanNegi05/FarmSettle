"""Backtest on REAL IMD district rainfall (gauge-based), Vidarbha, 2026.

Hand-computed expectations (policy: sum insured 100,000, trigger 75 mm, full at 125 mm,
3-day cumulative rainfall):

  Gadchiroli 23-25 Aug 2026: 23.6 + 48.2 + 28.8 = 100.6 mm
      severity = (100.6 - 75) / (125 - 75) = 0.512  ->  payout 51,200.00
  Nagpur 12-14 Sep 2026 (Nagpur's wettest 3-day spell in the file): 44.6 mm < 75 -> no payout
"""
import json
import pathlib
from datetime import date

import pytest

from app.services.claims import calculate_claim

VAL = pathlib.Path(__file__).parent.parent / "data" / "validation"


def load(name):
    return json.loads((VAL / name).read_text())


def policy(**over):
    p = {
        "id": "pol-imd", "farm_id": "farm-vidarbha", "status": "active",
        "coverage_start": date(2026, 6, 1), "coverage_end": date(2026, 10, 31),
        "sum_insured": 100000.0, "rainfall_trigger_mm": 75.0,
        "rainfall_max_payout_mm": 125.0, "payout_limit": None, "flood_trigger_level": None,
    }
    p.update(over)
    return p


def run(ev, **kw):
    total = round(sum(d["mm"] for d in ev["daily_mm"]), 2)
    return total, calculate_claim(policy(), event_id=ev["event"], event_date=ev["daily_mm"][-1]["date"],
                                  estimated_rainfall_mm=total, sensor_trust=0.9, **kw)


def test_fixtures_are_real_imd():
    for f in ("imd_gadchiroli_2026_08.json", "imd_nagpur_2026_09.json"):
        ev = load(f)
        assert ev["is_gauge_record"] is True and "IMD" in ev["source"]


def test_gadchiroli_storm_pays_hand_computed_amount():
    total, c = run(load("imd_gadchiroli_2026_08.json"))
    assert total == pytest.approx(100.6)
    assert c.outcome == "PAY"
    assert c.severity == pytest.approx(0.512)
    assert c.payable_amount == pytest.approx(51200.00, abs=0.01)
    assert c.recommended_amount == pytest.approx(51200.00, abs=0.01)


def test_nagpur_wettest_spell_is_below_trigger():
    total, c = run(load("imd_nagpur_2026_09.json"))
    assert total == pytest.approx(44.6)
    assert c.outcome == "NONE" and c.recommended_amount == 0.0


def test_payout_cap_applies_to_real_event():
    _, c = run(load("imd_gadchiroli_2026_08.json"), already_paid=30000.0)
    # entitlement 51,200 but only 100,000 - 30,000 = 70,000 remains -> still 51,200
    assert c.payable_amount == pytest.approx(51200.00, abs=0.01)
    _, c2 = run(load("imd_gadchiroli_2026_08.json"), already_paid=60000.0)
    assert c2.payable_amount == pytest.approx(40000.00, abs=0.01) and c2.cap_applied
