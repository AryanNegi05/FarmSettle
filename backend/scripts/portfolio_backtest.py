"""Portfolio backtest: run the claim engine over REAL IMD district rainfall.

One policy per district (same terms), one settlement per policy, evaluated on that
district's wettest rolling N-day window inside the coverage period.

Steps
  1. `prepare`  — trim the big IMD CSV to a small committed fixture (state only).
  2. `run`      — replay the fixture through calculate_claim and write a JSON report.

Usage (from backend/):
  python3 scripts/portfolio_backtest.py prepare /path/to/rainfall_districtwise_daily_imd.csv MAHARASHTRA
  python3 scripts/portfolio_backtest.py run [--trigger 75 --full 125 --sum 100000 --window 3]
"""
from __future__ import annotations

import argparse
import csv
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.services.backtest import FIXTURE, VAL, load_daily, run, worst_window  # noqa: E402,F401

REPORT = VAL / "portfolio_maharashtra_2026.json"


def prepare(src: str, state: str) -> None:
    VAL.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(src, newline="") as fh, open(FIXTURE, "w", newline="") as out:
        w = csv.writer(out)
        w.writerow(["district", "date", "mm"])
        for r in csv.DictReader(fh):
            if r["State"].strip().upper() != state.upper():
                continue
            try:
                mm = float(r["Daily Actual"])
            except ValueError:
                continue  # missing observation: never invent a value
            w.writerow([r["District"].strip().upper(), r["Date"], mm])
            n += 1
    print(f"wrote {FIXTURE} ({n} rows)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare"); p.add_argument("csv"); p.add_argument("state")
    r = sub.add_parser("run")
    r.add_argument("--trigger", type=float, default=75.0)
    r.add_argument("--full", type=float, default=125.0)
    r.add_argument("--sum", type=float, default=100000.0, dest="sum_insured")
    r.add_argument("--window", type=int, default=3)
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.csv, a.state)
    else:
        rep = run(a.trigger, a.full, a.sum_insured, a.window)
        REPORT.write_text(json.dumps(rep, indent=2) + "\n")
        print(f"{rep['districts_paid']}/{rep['districts']} districts paid; total payout "
              f"{rep['total_payout']:,.2f} of {rep['total_sum_insured']:,.0f} insured")
        for x in rep["results"][:10]:
            print(f"  {x['district']:<28}{x['window_start']}..{x['window_end']}  "
                  f"{x['rainfall_mm']:>7.1f} mm  {x['outcome']:<6}{x['payout']:>10,.2f}")
