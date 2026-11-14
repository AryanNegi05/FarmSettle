"""Extract a real IMD district-rainfall validation fixture.

Input : IMD district-wise daily rainfall CSV (columns State, District, Date, Daily Actual, ...).
Output: data/validation/imd_<district>_<start>.json  (daily mm for a window + provenance)

Usage (from backend/):
  python3 scripts/extract_imd_event.py /path/to/rainfall_districtwise_daily_imd.csv \
      GADCHIROLI 2026-08-23 3
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import pathlib
import sys

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "validation"


def main(csv_path: str, district: str, start: str, days: int) -> None:
    want = [(dt.date.fromisoformat(start) + dt.timedelta(d)).isoformat() for d in range(days)]
    rows = {}
    state = None
    with open(csv_path, newline="") as fh:
        for r in csv.DictReader(fh):
            if r["District"].strip().upper() == district.upper() and r["Date"] in want:
                rows[r["Date"]] = float(r["Daily Actual"])
                state = r["State"]
    missing = [d for d in want if d not in rows]
    if missing:
        sys.exit(f"missing dates for {district}: {missing}")
    out = {
        "event": f"{district.title()} heavy-rain spell, {want[0]} to {want[-1]}",
        "source": "IMD district-wise daily rainfall (gauge-based district averages)",
        "source_file": pathlib.Path(csv_path).name,
        "is_gauge_record": True,
        "state": state,
        "district": district.upper(),
        "daily_mm": [{"date": d, "mm": rows[d]} for d in want],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"imd_{district.lower()}_{start[:7].replace('-', '_')}.json"
    path.write_text(json.dumps(out, indent=2) + "\n")
    print(path); print(json.dumps(out["daily_mm"]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))
