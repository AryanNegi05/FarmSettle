"""Portfolio backtest on real IMD data (36 Maharashtra districts, 19 Aug - 14 Nov 2026).

Policy for every district: sum insured 100,000, trigger 75 mm, full payout 125 mm,
wettest 3 consecutive days. Hand-computed expectations:

  Suburban Mumbai 182.7 mm >= 125            -> 100,000 (full)
  Gadchiroli      100.6 mm (100.6-75)/50     ->  51,200
  Palghar          94.6 mm (94.6-75)/50      ->  39,200
  Mumbai City      85.8 mm (85.8-75)/50      ->  21,600
  total payout                               -> 212,000 ; every other district below 75 mm -> 0
"""
import pytest

from scripts.portfolio_backtest import load_daily, run

HAND = {"SUBURBAN MUMBAI": 100000.0, "GADCHIROLI": 51200.0, "PALGHAR": 39200.0, "MUMBAI CITY": 21600.0}


@pytest.fixture(scope="module")
def report():
    return run(75.0, 125.0, 100000.0, 3)


def test_all_districts_evaluated(report):
    assert report["districts"] == 36


def test_paying_districts_and_amounts_match_hand_calculation(report):
    paid = {r["district"]: r["payout"] for r in report["results"] if r["payout"] > 0}
    assert paid.keys() == HAND.keys()
    for d, amt in HAND.items():
        assert paid[d] == pytest.approx(amt, abs=0.01)


def test_total_payout(report):
    assert report["total_payout"] == pytest.approx(212000.0, abs=0.01)
    assert report["districts_paid"] == 4


def test_matches_independent_formula(report):
    """Recompute every district from raw daily data with a separate implementation."""
    import datetime as dt
    daily = load_daily()
    for r in report["results"]:
        d = daily[r["district"]]
        best = 0.0
        for s in d:
            span = [(dt.date.fromisoformat(s) + dt.timedelta(i)).isoformat() for i in range(3)]
            if all(x in d for x in span):
                best = max(best, sum(d[x] for x in span))
        expect = 100000.0 * min(1.0, max(0.0, (best - 75.0) / 50.0))
        assert r["payout"] == pytest.approx(expect, abs=0.01), r["district"]


def test_payout_never_exceeds_sum_insured(report):
    assert all(r["payout"] <= 100000.0 for r in report["results"])


def test_district_detail_matches_hand_calculation():
    from app.services.backtest import district_detail
    d = district_detail("palghar", 75.0, 125.0, 100000.0, 3)
    assert (d["window_start"], d["window_end"]) == ("2026-09-13", "2026-09-15")
    assert d["window_rainfall_mm"] == pytest.approx(94.6)
    assert d["calculation"]["recommended_amount"] == pytest.approx(39200.0, abs=0.01)
    assert len(d["daily"]) > 80


def test_district_detail_unknown_raises():
    from app.services.backtest import district_detail
    with pytest.raises(KeyError):
        district_detail("atlantis", 75.0, 125.0, 100000.0, 3)
