# ParaTrust Data Layer

## Quick Start (run once before hackathon)

```bash
cd ParaSF/backend

# Option A — simple
bash scripts/setup_data.sh

# Option B — manual
pip install cdsapi xarray scipy netCDF4
python3 scripts/fetch_era5_rainfall.py
```

## What gets generated

| File | What |
|------|------|
| `data/era5_rainfall.nc` | Raw ERA5 NetCDF (kept for audit) |
| `data/era5_rainfall.json` | Per-tick rainfall signal used by simulation |

## ERA5 Event

**Jul 12–14, 2022 — Vidarbha (Nagpur/Wardha) excess rainfall event**
- Bounding box: 78.95–79.23 E, 21.02–21.27 N
- Variable: `total_precipitation` (ERA5-Land, hourly)
- ERA5-Land `tp` is *accumulated since 00 UTC*; `fetch_era5_rainfall.py` converts it
  to hourly mm. The 00 UTC stamp holds the previous day's 24 h total, so tick 0 (no
  earlier data) is set to 0.
- 72 ticks (3 days × 24 hours)
- Real-storm claim validation: `data/validation/` and `tests/test_real_storm_backtest.py`

## Fallback

If ERA5 data is not fetched, the simulation automatically falls back to a
synthetic Gaussian storm pulse. The app works either way — ERA5 just makes
the base signal physically realistic.

## Sensor fault classifier

The LightGBM model trains on startup (cached). Two new features added:

- `satellite_wet_flag` — 1 when satellite shows wet pixel (genuine cell only)
- `storm_proximity` — 1 when storm track passes near (genuine cell only)

These are what separate `genuine_localised_cell` from `spike` at inference time.
Pass them via `satellite_wet_ids` and `storm_cell_ids` to `classify_readings()`.

## CDS Credentials

Set your key in the environment (get it from your CDS profile page); it is never stored in the repo:

```
export CDS_API_KEY="<your key>"
```

The script writes `~/.cdsapirc` from it on first run. Not needed if the `.nc` file is already present.

## Real-data validation

- `data/validation/imd_gadchiroli_2026_08.json`, `imd_nagpur_2026_09.json` — IMD district daily rainfall
- `data/validation/vidarbha_2022_07.json` — ERA5-Land reanalysis (not gauge data)
- Tests: `tests/test_imd_backtest.py`, `tests/test_real_storm_backtest.py`
