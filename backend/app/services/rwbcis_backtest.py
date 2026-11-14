"""Replay REAL IMD district rainfall through the RWBCIS excess-rainfall term sheet.

Index (Annexure-1 term sheet of the Revised RWBCIS Operational Guidelines):
    "Maximum of cumulative rainfall in mm of any 2 consecutive days during the cover phase"
Three cover phases, each with its own strikes, notionals and policy limit. Phase payouts add up.

NOTE: the term-sheet numbers are the guideline's own *suggestive illustration* for a
hypothetical crop/tehsil, not a notified term sheet for a real district.
"""
from __future__ import annotations

import datetime as dt
import pathlib

from app.services.backtest import FIXTURE, SOURCE, load_daily
from app.services.weather_index import slab_payout

SCHEME = "Restructured Weather Based Crop Insurance Scheme (RWBCIS), Revised Operational Guidelines, Annexure 1"
YEAR = 2026
PHASES = [
    {"name": "15 Jul – 31 Aug", "start": f"{YEAR}-07-15", "end": f"{YEAR}-08-31",
     "strike1": 80.0, "strike2": 175.0, "exit": 285.0, "notional1": 7.37, "notional2": 20.91, "limit": 3000.0},
    {"name": "1 – 30 Sep", "start": f"{YEAR}-09-01", "end": f"{YEAR}-09-30",
     "strike1": 33.0, "strike2": 95.0, "exit": 200.0, "notional1": 6.45, "notional2": 24.76, "limit": 3000.0},
    {"name": "1 – 31 Oct", "start": f"{YEAR}-10-01", "end": f"{YEAR}-10-31",
     "strike1": 15.0, "strike2": 45.0, "exit": 134.0, "notional1": 9.67, "notional2": 30.45, "limit": 3000.0},
]
TOTAL_LIMIT_PER_HA = sum(p["limit"] for p in PHASES)

# Worked example published in the guidelines (para 21.6), deficit cover, Rs/hectare.
GUIDELINE_EXAMPLE = {
    "terms": {"strike1": 200.0, "strike2": 150.0, "exit": 100.0, "notional1": 50.0,
              "notional2": 80.0, "limit": 6500.0, "deficit": True},
    "cases": [  # (RUA, hectares, observed mm, claim per ha as published, overall as published)
        {"rua": "X", "hectares": 1, "observed": 300.0, "published_per_ha": 0.0, "published_total": 0.0},
        {"rua": "Y", "hectares": 2, "observed": 120.0, "published_per_ha": 4900.0, "published_total": 9800.0},
        {"rua": "Z", "hectares": 2, "observed": 80.0, "published_per_ha": 6500.0, "published_total": 13000.0},
    ],
}


def guideline_example() -> list[dict]:
    t = GUIDELINE_EXAMPLE["terms"]
    out = []
    for c in GUIDELINE_EXAMPLE["cases"]:
        per_ha = slab_payout(c["observed"], t["strike1"], t["strike2"], t["exit"],
                             t["notional1"], t["notional2"], t["limit"], deficit=True)
        out.append({**c, "engine_per_ha": per_ha, "engine_total": round(per_ha * c["hectares"], 2),
                    "matches": per_ha == c["published_per_ha"] and round(per_ha * c["hectares"], 2) == c["published_total"]})
    return out


def _n_day(days: dict[str, float], n: int) -> list[tuple[str, str, float]]:
    """All (start, end, mm) for n consecutive calendar days that are all observed."""
    out = []
    for d in sorted(days):
        span = [(dt.date.fromisoformat(d) + dt.timedelta(i)).isoformat() for i in range(n)]
        if all(x in days for x in span):
            out.append((span[0], span[-1], round(sum(days[x] for x in span), 2)))
    return out


def _two_day(days: dict[str, float]) -> list[tuple[str, str, float]]:
    return _n_day(days, 2)


# Basis-risk PROXIES. We have no crop-loss data, so these flag where a rainfall index and
# real-world hardship are most likely to diverge; they do not measure actual loss.
NEAR_MISS_RATIO = 0.70        # observed >= 70 % of Strike 1 but still no payout
HEAVY_WEEK_MM = 100.0         # >= 100 mm in some 7 consecutive days ...
LOW_PAYOUT_FRACTION = 0.10    # ... yet paid < 10 % of the maximum limit


def basis_risk(days: dict[str, float], ev: dict) -> dict:
    by_window = {n: evaluate_district(days, 1.0, window=n)["payout_per_ha"] for n in (1, 2, 3)}
    week = max((x[2] for x in _n_day(days, 7)), default=0.0)
    near = [{"phase": ph["name"], "observed_mm": ph["observed_mm"], "strike1": ph["strike1"],
             "pct_of_strike1": round(100 * ph["observed_mm"] / ph["strike1"], 1)}
            for ph in ev["phases"]
            if ph["observed_mm"] is not None and ph["payout_per_ha"] == 0
            and ph["observed_mm"] >= NEAR_MISS_RATIO * ph["strike1"]]
    flags = []
    if ev["payout_per_ha"] == 0 and near:
        flags.append("NEAR_MISS")
    if week >= HEAVY_WEEK_MM and ev["payout_per_ha"] < LOW_PAYOUT_FRACTION * TOTAL_LIMIT_PER_HA:
        flags.append("HEAVY_WEEK_LOW_PAYOUT")
    return {"flags": flags, "near_misses": near, "peak_7day_mm": round(week, 1),
            "payout_per_ha_by_window_days": by_window}


def evaluate_district(days: dict[str, float], hectares: float = 1.0, window: int = 2) -> dict:
    pairs = _n_day(days, window)
    first_obs = min(days)
    phases = []
    for p in PHASES:
        inside = [x for x in pairs if p["start"] <= x[0] and x[1] <= p["end"]]
        if inside:
            s, e, mm = max(inside, key=lambda x: x[2])
            per_ha = slab_payout(mm, p["strike1"], p["strike2"], p["exit"], p["notional1"], p["notional2"], p["limit"])
        else:
            s = e = mm = None
            per_ha = 0.0
        phases.append({**p, "observed_mm": mm, "window_start": s, "window_end": e,
                       "payout_per_ha": per_ha, "partial_data": first_obs > p["start"] and bool(inside)})
    per_ha_total = round(sum(x["payout_per_ha"] for x in phases), 2)
    return {"phases": phases, "payout_per_ha": per_ha_total, "payout": round(per_ha_total * hectares, 2),
            "peak_two_day_mm": max((x["observed_mm"] for x in phases if x["observed_mm"] is not None), default=0.0)}


def run(hectares: float = 1.0, path: pathlib.Path = FIXTURE) -> dict:
    daily = load_daily(path)
    rows = []
    for district in sorted(daily):
        ev = evaluate_district(daily[district], hectares)
        br = basis_risk(daily[district], ev)
        rows.append({"district": district, "peak_two_day_mm": ev["peak_two_day_mm"],
                     "peak_7day_mm": br["peak_7day_mm"], "flags": br["flags"],
                     "payout_per_ha": ev["payout_per_ha"], "payout": ev["payout"],
                     "outcome": "PAY" if ev["payout"] > 0 else "NONE",
                     "phases_paid": sum(1 for x in ev["phases"] if x["payout_per_ha"] > 0)})
    rows.sort(key=lambda r: (-r["payout"], -r["peak_two_day_mm"]))
    insured = TOTAL_LIMIT_PER_HA * hectares * len(rows)
    return {
        "scheme": SCHEME, "source": SOURCE, "hectares": hectares, "phases": PHASES,
        "districts": len(rows), "districts_paid": sum(1 for r in rows if r["payout"] > 0),
        "total_insured": insured, "total_payout": round(sum(r["payout"] for r in rows), 2), "results": rows,
        "basis_risk_summary": {
            "near_miss": sum(1 for r in rows if "NEAR_MISS" in r["flags"]),
            "heavy_week_low_payout": sum(1 for r in rows if "HEAVY_WEEK_LOW_PAYOUT" in r["flags"]),
            "note": "Proxies from rainfall only; no crop-loss data, so they do not measure actual loss.",
        },
        "data_note": "IMD data starts 19 Aug 2026, so the 15 Jul – 31 Aug phase is only partly observed (understates).",
    }


def district_detail(district: str, hectares: float = 1.0, path: pathlib.Path = FIXTURE) -> dict:
    daily = load_daily(path)
    key = district.upper()
    if key not in daily:
        raise KeyError(district)
    days = daily[key]
    ev = evaluate_district(days, hectares)
    return {"district": key, "scheme": SCHEME, "source": SOURCE, "hectares": hectares,
            "daily": [{"date": d, "mm": v} for d, v in sorted(days.items())],
            "two_day": [{"start": s, "end": e, "mm": mm} for s, e, mm in _two_day(days)],
            "basis_risk": basis_risk(days, ev), **ev}
