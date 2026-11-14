"""Backtest service: replay REAL IMD district rainfall through the claim engine.

Pure functions over a committed fixture (data/validation/imd_maharashtra_daily_2026.csv,
rows: district,date,mm). Used by the API (/api/backtest) and scripts/portfolio_backtest.py.
One policy per district, one settlement per policy, on that district's wettest rolling
N consecutive-day window. Missing observations are never filled in.
"""
from __future__ import annotations

import csv
import datetime as dt
import pathlib
from collections import defaultdict

from app.services.claims import calculate_claim

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
VAL = ROOT / "data" / "validation"
FIXTURE = VAL / "imd_maharashtra_daily_2026.csv"
SOURCE = "IMD district-wise daily rainfall (gauge-based district averages)"


def load_daily(path: pathlib.Path = FIXTURE) -> dict[str, dict[str, float]]:
    by: dict[str, dict[str, float]] = defaultdict(dict)
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh):
            by[r["district"]][r["date"]] = float(r["mm"])
    return by


def worst_window(days: dict[str, float], window: int) -> tuple[str, str, float]:
    """Wettest run of `window` CONSECUTIVE calendar days (gaps are not bridged)."""
    best = ("", "", -1.0)
    dates = sorted(days)
    for d0 in dates:
        span = [(dt.date.fromisoformat(d0) + dt.timedelta(i)).isoformat() for i in range(window)]
        if all(d in days for d in span):
            total = round(sum(days[d] for d in span), 2)
            if total > best[2]:
                best = (span[0], span[-1], total)
    return best


def _policy(district, start, end, sum_insured, trigger, full):
    return {
        "id": f"pol-{district}", "farm_id": f"farm-{district}", "status": "active",
        "coverage_start": start, "coverage_end": end, "sum_insured": sum_insured,
        "rainfall_trigger_mm": trigger, "rainfall_max_payout_mm": full,
        "payout_limit": None, "flood_trigger_level": None,
    }


def coverage(daily) -> tuple[dt.date, dt.date]:
    all_dates = sorted({d for m in daily.values() for d in m})
    return dt.date.fromisoformat(all_dates[0]), dt.date.fromisoformat(all_dates[-1])


def district_detail(district: str, trigger: float, full: float, sum_insured: float, window: int,
                    path: pathlib.Path = FIXTURE) -> dict:
    """Daily series + the engine's full calculation for one district's wettest window."""
    daily = load_daily(path)
    district = district.upper()
    if district not in daily:
        raise KeyError(district)
    start, end = coverage(daily)
    s, e, total = worst_window(daily[district], window)
    c = calculate_claim(_policy(district, start, end, sum_insured, trigger, full),
                        event_id=f"{district}-{s}", event_date=e,
                        estimated_rainfall_mm=total, sensor_trust=0.9)
    return {
        "district": district, "source": SOURCE, "window_start": s, "window_end": e,
        "window_rainfall_mm": total,
        "daily": [{"date": d, "mm": v} for d, v in sorted(daily[district].items())],
        "calculation": c.to_dict(),
    }


def run(trigger: float, full: float, sum_insured: float, window: int, path: pathlib.Path = FIXTURE) -> dict:
    daily = load_daily(path)
    start, end = coverage(daily)
    results = []
    for district in sorted(daily):
        s, e, total = worst_window(daily[district], window)
        if not s:
            continue
        c = calculate_claim(_policy(district, start, end, sum_insured, trigger, full), event_id=f"{district}-{s}", event_date=e,
                            estimated_rainfall_mm=total, sensor_trust=0.9)
        results.append({
            "district": district, "window_start": s, "window_end": e, "rainfall_mm": total,
            "outcome": c.outcome, "severity": round(c.severity, 4), "payout": c.recommended_amount,
        })
    paid = [r for r in results if r["payout"] > 0]
    report = {
        "source": SOURCE,
        "coverage": [start.isoformat(), end.isoformat()],
        "terms": {"sum_insured": sum_insured, "trigger_mm": trigger, "full_payout_mm": full, "window_days": window},
        "districts": len(results),
        "districts_paid": len(paid),
        "total_sum_insured": sum_insured * len(results),
        "total_payout": round(sum(r["payout"] for r in results), 2),
        "results": sorted(results, key=lambda r: -r["rainfall_mm"]),
    }
    return report


