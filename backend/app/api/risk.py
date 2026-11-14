"""Stage 6 — Farm-level risk assessment endpoints.

POST /api/risk/assess                  — run GP estimation for a tick, persist results
GET  /api/risk/{run_id}                — latest risk layer for a run (all farms)
GET  /api/risk/{run_id}/{farm_id}      — single farm estimate history
GET  /api/risk/geojson/{run_id}        — GeoJSON FeatureCollection coloured by risk category

All persistence is via Firestore — no SQLite / SQLAlchemy.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException

from app.core.firebase_auth import get_current_user
from app.services.firestore_service import firestore_service
from app.schemas.risk import FarmRiskEstimateOut, RiskLayerOut, RiskAssessRequest
from app.services.risk import assess_farms, MODEL_VERSION
from app.services.simulation import ScenarioPreset, WeatherSimulator
from app.services.geo import generate_farms

router = APIRouter(prefix="/api/risk", tags=["risk"])

# ─── Risk colour mapping for GeoJSON ─────────────────────────────────────────

_RISK_COLOUR = {
    "low":                   "#22c55e",   # green-500
    "moderate":              "#eab308",   # yellow-500
    "high":                  "#f97316",   # orange-500
    "extreme":               "#ef4444",   # red-500
    "insufficient_evidence": "#64748b",   # slate-500
    "unknown":               "#64748b",
}


# ─── Assess / persist ─────────────────────────────────────────────────────────

@router.post("/assess", response_model=RiskLayerOut)
async def run_risk_assessment(
    body: RiskAssessRequest,
    current_user=Depends(get_current_user),
):
    """Run the GP spatial estimation for all farms at the given tick and persist.

    Idempotent: calling again for the same (run_id, tick) upserts each farm row.
    Requires that fault detection (Stage 5) has been run first to build trust scores.
    Falls back gracefully if no trust scores exist yet (all sensors get trust=0.5).
    """
    run = firestore_service.get_simulation_run(body.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Simulation run not found")

    tick = body.tick if body.tick is not None else run["current_tick"]
    tick = max(0, min(tick, run["total_ticks"] - 1))

    # Load all trust scores for this run (we use the latest per sensor).
    trust_rows = firestore_service.list_sensor_trust_scores(run["id"])

    sim = WeatherSimulator(ScenarioPreset(run["scenario"]), base_seed=run["seed"])
    farm_results = assess_farms(run["id"], tick, trust_rows, sim)

    # Persist / upsert each farm estimate.
    for fr in farm_results:
        sensor_json = json.dumps(fr.supporting_sensors)
        firestore_service.upsert_farm_risk_estimate(
            run_id=run["id"],
            farm_id=fr.farm_id,
            tick=tick,
            data={
                "estimated_rainfall_mm": fr.estimated_rainfall_mm,
                "uncertainty_mm":        fr.uncertainty_mm,
                "lower_ci":              fr.lower_ci,
                "upper_ci":              fr.upper_ci,
                "risk_category":         fr.risk_category,
                "flood_risk_score":      fr.flood_risk_score,
                "supporting_sensors":    sensor_json,
                "evidence_note":         fr.evidence_note,
                "model_version":         fr.model_version,
            },
        )

    return _build_layer(run["id"], tick, farm_results)


# ─── Risk GeoJSON ─────────────────────────────────────────────────────────────

@router.get("/geojson/{run_id}")
async def risk_geojson(
    run_id: str,
    current_user=Depends(get_current_user),
):
    """GeoJSON FeatureCollection of farm polygons coloured by risk category."""
    run = firestore_service.get_simulation_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Simulation run not found")

    rows = firestore_service.list_farm_risk_estimates(run_id)
    latest: dict[str, dict] = {}
    for r in rows:
        if r["farm_id"] not in latest:
            latest[r["farm_id"]] = r

    farms = generate_farms()
    features = []
    for farm in farms:
        est = latest.get(farm.id)
        risk_cat = est["risk_category"] if est else "insufficient_evidence"
        colour = _RISK_COLOUR.get(risk_cat, "#64748b")

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [farm.boundary],
            },
            "properties": {
                "farm_id": farm.id,
                "farmer_name": "Registered farmer",
                "risk_category": risk_cat,
                "colour": colour,
                "estimated_rainfall_mm": est["estimated_rainfall_mm"] if est else None,
                "uncertainty_mm": est["uncertainty_mm"] if est else None,
                "lower_ci": est["lower_ci"] if est else None,
                "upper_ci": est["upper_ci"] if est else None,
                "flood_risk_score": est["flood_risk_score"] if est else None,
                "simulated": True,
                "note": "Simulated estimate — not a confirmed physical flood boundary",
            },
        })

    return {"type": "FeatureCollection", "features": features}


# ─── Latest risk layer for a run ─────────────────────────────────────────────

@router.get("/{run_id}", response_model=RiskLayerOut)
async def get_risk_layer(
    run_id: str,
    current_user=Depends(get_current_user),
):
    """Return the most recently persisted risk layer (latest tick with data)."""
    run = firestore_service.get_simulation_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Simulation run not found")

    rows = firestore_service.list_farm_risk_estimates(run_id)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No risk estimates found — run POST /api/risk/assess first",
        )

    latest_tick = rows[0]["tick"]
    latest = [r for r in rows if r["tick"] == latest_tick]
    return _build_layer_from_db(run_id, latest_tick, latest)


# ─── Single farm estimate history ─────────────────────────────────────────────

@router.get("/{run_id}/{farm_id}", response_model=list[FarmRiskEstimateOut])
async def get_farm_risk_history(
    run_id: str,
    farm_id: str,
    current_user=Depends(get_current_user),
):
    """Return per-tick risk history for a single farm."""
    rows = firestore_service.get_farm_risk_history(run_id, farm_id)
    return [_row_to_out(r) for r in rows]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row_to_out(r: dict) -> FarmRiskEstimateOut:
    sensors_raw = r.get("supporting_sensors", "[]")
    if isinstance(sensors_raw, str):
        sensors = json.loads(sensors_raw)
    else:
        sensors = sensors_raw or []
    return FarmRiskEstimateOut(
        farm_id=r["farm_id"],
        tick=r["tick"],
        run_id=r["run_id"],
        estimated_rainfall_mm=r.get("estimated_rainfall_mm"),
        uncertainty_mm=r.get("uncertainty_mm"),
        lower_ci=r.get("lower_ci"),
        upper_ci=r.get("upper_ci"),
        risk_category=r.get("risk_category", "insufficient_evidence"),
        flood_risk_score=r.get("flood_risk_score"),
        supporting_sensors=sensors,
        evidence_note=r.get("evidence_note") or "",
        model_version=r.get("model_version") or MODEL_VERSION,
    )


def _build_layer(run_id: str, tick: int, farm_results) -> RiskLayerOut:
    out_farms = [
        FarmRiskEstimateOut(
            farm_id=fr.farm_id,
            tick=fr.tick,
            run_id=fr.run_id,
            estimated_rainfall_mm=fr.estimated_rainfall_mm,
            uncertainty_mm=fr.uncertainty_mm,
            lower_ci=fr.lower_ci,
            upper_ci=fr.upper_ci,
            risk_category=fr.risk_category,
            flood_risk_score=fr.flood_risk_score,
            supporting_sensors=fr.supporting_sensors,
            evidence_note=fr.evidence_note,
            model_version=fr.model_version,
        )
        for fr in farm_results
    ]
    return RiskLayerOut(
        run_id=run_id,
        tick=tick,
        farms=out_farms,
        summary=_summarise(out_farms),
    )


def _build_layer_from_db(run_id: str, tick: int, rows: list[dict]) -> RiskLayerOut:
    out_farms = [_row_to_out(r) for r in rows]
    return RiskLayerOut(
        run_id=run_id,
        tick=tick,
        farms=out_farms,
        summary=_summarise(out_farms),
    )


def _summarise(farms: list[FarmRiskEstimateOut]) -> dict:
    cats = [f.risk_category for f in farms]
    return {
        "total_farms": len(farms),
        "low":                    cats.count("low"),
        "moderate":               cats.count("moderate"),
        "high":                   cats.count("high"),
        "extreme":                cats.count("extreme"),
        "insufficient_evidence":  cats.count("insufficient_evidence"),
    }
