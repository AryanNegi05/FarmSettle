"""Stage 4 simulation endpoints.

REST surface:
  GET  /api/simulation/scenarios          — list available scenario presets
  GET  /api/simulation/runs               — list all simulation runs
  POST /api/simulation/runs               — create a new run (insurer/admin)
  GET  /api/simulation/runs/{id}          — get run metadata
  POST /api/simulation/runs/{id}/control  — start | pause | reset | step
  GET  /api/simulation/runs/{id}/snapshot — full snapshot at current tick
  GET  /api/simulation/runs/{id}/stream   — SSE: tick-by-tick snapshots (auto-advance)

All persistence is via Firestore — no SQLite / SQLAlchemy.
"""
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.models.user import UserRole
from app.core.deps import require_role
from app.core.firebase_auth import get_current_user
from app.core.config import settings
from app.services.firestore_service import firestore_service
from app.schemas.simulation import (
    ScenarioInfo, SimulationRunOut, SimulationRunCreate,
    TickControl, SnapshotOut, GaugeReadingOut, StormCellOut,
)
from app.services.simulation import (
    ScenarioPreset, SCENARIO_META, WeatherSimulator,
    rainfall_intensity_geojson, flood_area_geojson, water_levels_geojson,
)

router = APIRouter(prefix="/api/simulation", tags=["simulation"])

_TICK_INTERVAL_S = 1.5


# ── Scenario catalogue ───────────────────────────────────────────────────────

@router.get("/scenarios", response_model=list[ScenarioInfo])
def list_scenarios():
    """Return all available scenario presets with metadata."""
    return [
        ScenarioInfo(
            preset=preset.value,
            label=meta["label"],
            description=meta["description"],
            total_ticks=meta["total_ticks"],
        )
        for preset, meta in SCENARIO_META.items()
    ]


# ── Run management ────────────────────────────────────────────────────────────

@router.post("/runs", response_model=SimulationRunOut, status_code=201)
async def create_run(
    body: SimulationRunCreate,
    current_user=Depends(require_role(UserRole.insurer, UserRole.admin)),
):
    """Create a new simulation run. Only insurer / admin can create runs."""
    seed = body.seed if body.seed is not None else settings.simulation_seed
    meta = SCENARIO_META[body.scenario]
    run = firestore_service.create_simulation_run({
        "scenario": body.scenario.value,
        "seed": seed,
        "current_tick": 0,
        "total_ticks": meta["total_ticks"],
        "status": "paused",
        "created_by": current_user.uid,
    })
    return _run_to_out(run)


@router.get("/runs", response_model=list[SimulationRunOut])
async def list_runs(current_user=Depends(get_current_user)):
    runs = firestore_service.list_simulation_runs(limit=20)
    return [_run_to_out(r) for r in runs]


@router.get("/runs/{run_id}", response_model=SimulationRunOut)
async def get_run(run_id: str, current_user=Depends(get_current_user)):
    run = _run_or_404(run_id)
    return _run_to_out(run)


# ── Simulation controls ───────────────────────────────────────────────────────

@router.post("/runs/{run_id}/control", response_model=SimulationRunOut)
async def control_run(
    run_id: str,
    body: TickControl,
    current_user=Depends(require_role(UserRole.insurer, UserRole.admin)),
):
    """Control a simulation run: start | pause | reset | step."""
    run = _run_or_404(run_id)
    action = body.action.lower()
    updates: dict = {}

    if action == "start":
        if run["status"] != "complete":
            updates["status"] = "running"
    elif action == "pause":
        updates["status"] = "paused"
    elif action == "reset":
        updates["current_tick"] = 0
        updates["status"] = "paused"
    elif action == "step":
        new_tick = run["current_tick"]
        if new_tick < run["total_ticks"] - 1:
            new_tick += 1
        updates["current_tick"] = new_tick
        updates["status"] = "complete" if new_tick >= run["total_ticks"] - 1 else "paused"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action '{action}'. Use: start | pause | reset | step")

    if updates:
        run = firestore_service.update_simulation_run(run_id, updates)
    return _run_to_out(run)


# ── Snapshot ──────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/snapshot", response_model=SnapshotOut)
async def get_snapshot(run_id: str, current_user=Depends(get_current_user)):
    """Return the full simulation state at the run's current tick."""
    run = _run_or_404(run_id)
    return _build_snapshot(run)


# ── SSE stream ────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/stream")
async def stream_run(
    run_id: str,
    request: Request,
    token: str | None = None,
):
    """Server-Sent Events stream.

    Accepts the Firebase ID token as either an Authorization: Bearer header or
    a ``token`` query parameter (necessary because EventSource doesn't support
    custom headers in browsers).
    """
    from firebase_admin import auth as firebase_auth_sdk

    auth_header = request.headers.get("authorization", "")
    raw_token = token
    if not raw_token and auth_header.lower().startswith("bearer "):
        raw_token = auth_header[7:]
    if not raw_token:
        from fastapi.responses import Response
        return Response(status_code=401, content="Missing authentication token")
    try:
        firebase_auth_sdk.verify_id_token(raw_token)
    except Exception:
        from fastapi.responses import Response
        return Response(status_code=401, content="Invalid token")

    run = _run_or_404(run_id)

    async def event_generator():
        current_run = run
        while True:
            if await request.is_disconnected():
                break

            # Reload run from Firestore on each iteration to pick up control changes.
            fresh = firestore_service.get_simulation_run(run_id)
            if not fresh:
                break
            current_run = fresh

            if current_run["status"] == "running":
                snap_data = _build_snapshot(current_run)
                yield f"event: snapshot\ndata: {json.dumps(snap_data.model_dump(mode='json'))}\n\n"

                # Advance tick
                new_tick = current_run["current_tick"]
                if new_tick < current_run["total_ticks"] - 1:
                    new_tick += 1
                    updates = {"current_tick": new_tick}
                else:
                    updates = {"status": "complete"}
                firestore_service.update_simulation_run(run_id, updates)

                await asyncio.sleep(_TICK_INTERVAL_S)
            else:
                heartbeat = {
                    "run_id": current_run["id"],
                    "status": current_run["status"],
                    "tick": current_run["current_tick"],
                    "total_ticks": current_run["total_ticks"],
                }
                yield f"event: heartbeat\ndata: {json.dumps(heartbeat)}\n\n"
                await asyncio.sleep(2.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run_or_404(run_id: str) -> dict:
    run = firestore_service.get_simulation_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Simulation run not found")
    return run


def _run_to_out(run: dict) -> SimulationRunOut:
    return SimulationRunOut(
        id=run["id"],
        scenario=run["scenario"],
        seed=run["seed"],
        current_tick=run["current_tick"],
        total_ticks=run["total_ticks"],
        status=run["status"],
        created_by=run.get("created_by"),
    )


def _build_snapshot(run: dict) -> SnapshotOut:
    preset = ScenarioPreset(run["scenario"])
    sim = WeatherSimulator(preset, base_seed=run["seed"])
    snap = sim.snapshot(run["current_tick"])

    gauge_out = [
        GaugeReadingOut(
            sensor_id=r.sensor_id, sensor_type=r.sensor_type,
            lat=r.lat, lng=r.lng, value=r.value, unit=r.unit,
            tick=r.tick, simulated=r.simulated,
            is_faulty=r.is_faulty, fault_type=r.fault_type,
        )
        for r in snap.gauge_readings
    ]
    storm_out = [
        StormCellOut(lat=c.lat, lng=c.lng, peak_mm_hr=c.peak_mm_hr, radius_deg=c.radius_deg)
        for c in snap.storm_cells
    ]

    return SnapshotOut(
        run_id=run["id"],
        scenario=run["scenario"],
        tick=snap.tick,
        total_ticks=snap.total_ticks,
        simulated_hour=snap.simulated_hour,
        status=run["status"],
        gauge_readings=gauge_out,
        storm_cells=storm_out,
        flood_active=snap.flood_active,
        flood_intensity=snap.flood_intensity,
        rainfall_geojson=rainfall_intensity_geojson(snap),
        flood_geojson=flood_area_geojson(snap),
        water_geojson=water_levels_geojson(snap),
    )
