"""Command Centre API (Stage 13): live, stateless evaluation for the insurer's land map.

POST /api/command/evaluate recomputes sensors → ML trust → farm rainfall → payouts for the
given scenario controls. Deterministic (seeded). Weather and sensors are simulated; the farms
are the ones farmers actually traced on the shared land.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.models.user import UserRole
from app.core.deps import require_role
from app.services import command_centre as cc
from app.services import sensor_forensics as forensics

router = APIRouter(prefix="/api/command", tags=["command-centre"])

READ_ROLES = (UserRole.insurer, UserRole.admin, UserRole.auditor)


class StormIn(BaseModel):
    peak_mm_hr: float = Field(ge=0, le=300)
    radius_m: float = Field(gt=0, le=2000)
    lat: float
    lng: float


class EvaluateIn(BaseModel):
    preset: Optional[str] = None
    district_mm_hr: Optional[float] = Field(default=None, ge=0, le=150)
    storm: Optional[StormIn] = None
    sensor_overrides: dict[str, float] = Field(default_factory=dict)
    faults: dict[str, str] = Field(default_factory=dict)   # sensor_id -> spike|stuck|dead|drift
    farm_adjust: dict[str, float] = Field(default_factory=dict)   # farm_id -> mm/hr added at that farm
    sensor_count: int = Field(default=18, ge=6, le=cc.MAX_SENSORS)
    seed: Optional[int] = None


class SeriesIn(EvaluateIn):
    farm_id: str
    steps: int = Field(default=24, ge=4, le=60)


def _controls(body: EvaluateIn) -> cc.Controls:
    base = next((p for p in cc.resolve_presets() if p["id"] == body.preset), {}) if body.preset else {}
    district = body.district_mm_hr if body.district_mm_hr is not None else base.get("district_mm_hr", 2.0)
    storm = body.storm.model_dump() if body.storm else base.get("storm")
    faults = {**base.get("faults", {}), **body.faults}
    return cc.Controls(
        district_mm_hr=district, storm=storm, sensor_overrides=body.sensor_overrides,
        faults={k: v for k, v in faults.items() if v in ("spike", "stuck", "dead", "drift")},
        farm_adjust={k: max(cc.ADJUST_MIN, min(cc.ADJUST_MAX, v)) for k, v in body.farm_adjust.items() if v},
        sensor_count=body.sensor_count, seed=body.seed)


@router.get("/presets")
def presets(current_user=Depends(require_role(*READ_ROLES))):
    """Scenario presets. Storm positions and sizes are derived from the land and the registered farms."""
    return cc.resolve_presets()


@router.post("/evaluate")
def evaluate(body: EvaluateIn, current_user=Depends(require_role(*READ_ROLES))):
    return cc.evaluate(_controls(body))


@router.post("/farm-series")
def farm_series(body: SeriesIn, current_user=Depends(require_role(*READ_ROLES))):
    """One farm's rainfall and payout across the storm life-cycle under the current controls."""
    farms = cc._collect_farms()
    if not any(f["farm_id"] == body.farm_id for f in farms):
        raise HTTPException(status_code=404, detail="Farm not found on the shared land")
    return cc.farm_series(_controls(body), body.farm_id, body.steps, farms=farms)


class ForensicsIn(EvaluateIn):
    sensor_id: str


@router.post("/sensor-forensics")
def sensor_forensics(body: ForensicsIn, current_user=Depends(require_role(*READ_ROLES))):
    """Explainable investigation of one simulated sensor under the current controls."""
    controls = _controls(body)
    farms = cc._collect_farms()
    evaluation = cc.evaluate(controls, farms=[dict(f) for f in farms])
    try:
        return forensics.investigate(controls, body.sensor_id, evaluation, farms=[dict(f) for f in farms])
    except KeyError:
        raise HTTPException(status_code=404, detail="Sensor not found for these controls")
