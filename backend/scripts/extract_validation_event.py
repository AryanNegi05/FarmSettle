"""Extract a real-storm validation fixture from the raw ERA5-Land NetCDF.

Reads backend/data/data_0.nc (ERA5-Land `tp`, hourly, metres, ACCUMULATED since 00 UTC;
the value stamped 00:00 UTC is the previous day's 24 h total) and writes the daily
rainfall at the grid cell nearest Nagpur to data/validation/vidarbha_2022_07.json.

Run from backend/:  python3 scripts/extract_validation_event.py
"""
from __future__ import annotations

import json
import pathlib

import xarray as xr

ROOT = pathlib.Path(__file__).resolve().parent.parent
NC = ROOT / "data" / "data_0.nc"
OUT = ROOT / "data" / "validation" / "vidarbha_2022_07.json"

NAGPUR = (21.1458, 79.0882)  # lat, lon


def main() -> None:
    ds = xr.open_dataset(NC)
    tp = ds["tp"] * 1000.0  # m -> mm
    cell = tp.sel(latitude=NAGPUR[0], longitude=NAGPUR[1], method="nearest")
    times = [str(t)[:13] for t in cell["valid_time"].values]

    def at(stamp: str) -> float:
        return round(float(cell.isel(valid_time=times.index(stamp)).values), 2)

    daily = [
        # value stamped 00 UTC on D+1 is the full 24 h total for day D
        {"date": "2022-07-12", "mm": at("2022-07-13T00"), "source_stamp": "2022-07-13T00Z (24 h total)"},
        {"date": "2022-07-13", "mm": at("2022-07-14T00"), "source_stamp": "2022-07-14T00Z (24 h total)"},
        # 15 Jul 00Z is outside the download: use accumulation to 23Z (00-23 UTC, 23 h)
        {"date": "2022-07-14", "mm": at("2022-07-14T23"), "source_stamp": "2022-07-14T23Z (23 h accumulation, partial)"},
    ]
    out = {
        "event": "Vidarbha heavy-rainfall spell, 12-14 July 2022",
        "source": "ERA5-Land reanalysis (Copernicus CDS), variable total_precipitation",
        "source_file": "backend/data/data_0.nc",
        "is_gauge_record": False,
        "note": "Reanalysis, not a rain-gauge record. Replace/augment with IMD or state station data when available.",
        "location": {"name": "Nagpur (nearest ERA5-Land cell)",
                     "lat": float(cell["latitude"]), "lon": float(cell["longitude"])},
        "daily_mm": daily,
        "prior_day": {"date": "2022-07-11", "mm": at("2022-07-12T00"),
                           "source_stamp": "2022-07-12T00Z (24 h total)"},
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
