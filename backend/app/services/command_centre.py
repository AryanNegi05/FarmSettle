"""Stage 13 — Command Centre evaluator, on the shared land patch.

Stateless and deterministic: the same controls + seed always give the same output, so the
insurer's sliders can recompute everything instantly without a stored simulation run.

The "district" is the one geo-referenced land image every farmer registers on (see `land.py`).
Only farms farmers actually registered on that land are evaluated. Sensors are placed
(seeded, well spread) across the land; storm centres come from the land or the farms' own
positions. Nothing is tied to a fixed place.

Pipeline for one evaluation
    controls → rainfall field → sensor readings (+ injected faults) → LightGBM sensor
    classification & trust → trust-weighted Gaussian Process estimate per farm (with
    uncertainty) → deterministic claim engine per farm policy → portfolio summary.

Weather and sensors are SIMULATED. Rainfall is in mm/hr; policy triggers are compared in the
same unit (prototype assumption).
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

import numpy as np

from app.core.config import settings
from app.services import claims as claim_engine
from app.services import land
from app.services.fault_detection import classify_readings
from app.services.geo import farm_geometry
from app.services.risk import _build_noise_alpha, _fit_gp, categorise_risk, derive_flood_risk
from app.services.simulation import GaugeReading
from app.services.zones import area_hectares, distance_m, fitted_circle

MAX_SENSORS = 40
WATER_GAUGES = 6
CONTRIBUTORS_PER_FARM = 4
EVENT_ID = "command-centre-sim"
ADJUST_MIN, ADJUST_MAX = -50.0, 150.0     # mm/hr added at one farm only
FARM_CELL_MIN_RADIUS_M = 60.0


@dataclass
class Sensor:
    id: str
    sensor_type: str          # rainfall | water_level
    latitude: float
    longitude: float


@dataclass
class Controls:
    district_mm_hr: float = 2.0
    storm: Optional[dict[str, float]] = None              # {peak_mm_hr, radius_m, lat, lng}
    sensor_overrides: dict[str, float] = field(default_factory=dict)
    faults: dict[str, str] = field(default_factory=dict)   # sensor_id -> spike|stuck|dead|drift
    farm_adjust: dict[str, float] = field(default_factory=dict)   # farm_id -> mm/hr added at that farm
    sensor_count: int = 18
    seed: Optional[int] = None


# ─── Presets (positions and sizes derive from the land and the farms) ────────

def farms_centroid(farms: list[dict[str, Any]]) -> tuple[float, float]:
    """(lng, lat) mean of the farms' own centres, or the land centre when there are no farms."""
    cs = []
    for f in farms:
        c = fitted_circle(f["ring"])["centre"]
        cs.append(c)
    if not cs:
        return land.centre()
    return sum(c[0] for c in cs) / len(cs), sum(c[1] for c in cs) / len(cs)


def resolve_presets(farms: Optional[list[dict[str, Any]]] = None, sensors: Optional[list[Sensor]] = None) -> list[dict]:
    farms = farms if farms is not None else _collect_farms()
    sensors = sensors if sensors is not None else build_sensors(18, None)
    span = land.span_m()
    clng, clat = land.centre()
    flng, flat = farms_centroid(farms)
    rain_ids = [s.id for s in sensors if s.sensor_type == "rainfall"]

    def pick(idx: int) -> Optional[str]:
        return rain_ids[idx % len(rain_ids)] if rain_ids else None

    faulty = {pick(2): "spike", pick(7): "dead"} if rain_ids else {}
    return [
        {"id": "normal", "label": "Normal Weather", "district_mm_hr": 2.0, "storm": None, "faults": {}},
        {"id": "moderate", "label": "Moderate Rainfall", "district_mm_hr": 14.0, "storm": None, "faults": {}},
        {"id": "severe_flood", "label": "Severe Flood", "district_mm_hr": 22.0, "faults": {},
         "storm": {"peak_mm_hr": 80.0, "radius_m": round(span * 0.35), "lat": clat, "lng": clng}},
        {"id": "cloudburst", "label": "Localised Cloudburst", "district_mm_hr": 3.0, "faults": {},
         "storm": {"peak_mm_hr": 130.0, "radius_m": round(span * 0.12), "lat": flat, "lng": flng}},
        {"id": "faulty_gauge", "label": "Faulty Rain Gauge", "district_mm_hr": 16.0, "storm": None,
         "faults": {k: v for k, v in faulty.items() if k}},
        {"id": "broad", "label": "Broad District-Wide Rainfall", "district_mm_hr": 38.0, "storm": None, "faults": {}},
    ]


# ─── Sensors: seeded, well spread across the land ───────────────────────────

def build_sensors(count: int, seed: Optional[int]) -> list[Sensor]:
    """Rainfall gauges + water-level gauges spread over the land (Halton + seeded rotation).

    Changing the count keeps earlier sensors where they were.
    """
    count = max(6, min(MAX_SENSORS, count))
    water_n = min(WATER_GAUGES, max(2, count // 3))
    rain_n = count - water_n
    base_seed = (seed if seed is not None else settings.simulation_seed)
    rain = land.spread_points(rain_n, base_seed + 11, bases=(2, 3))
    water = land.spread_points(water_n, base_seed + 29, bases=(5, 7), start=3)
    out = [Sensor(f"RG-{i + 1:02d}", "rainfall", round(lat, 6), round(lng, 6)) for i, (lng, lat) in enumerate(rain)]
    out += [Sensor(f"WG-{i + 1:02d}", "water_level", round(lat, 6), round(lng, 6)) for i, (lng, lat) in enumerate(water)]
    return out


# ─── Rainfall field ──────────────────────────────────────────────────────────

class RainField:
    """District baseline + optional Gaussian storm + small local cells at adjusted farms."""

    def __init__(self, c: Controls, farm_cells: list[tuple[float, float, float, float]]):
        self.c = c
        self.cells = farm_cells        # (lng, lat, mm_hr_added, radius_m)

    def at(self, lat: float, lng: float) -> float:
        v = self.c.district_mm_hr
        if self.c.storm:
            d = distance_m(lng, lat, self.c.storm["lng"], self.c.storm["lat"])
            sigma = max(5.0, self.c.storm["radius_m"])
            v += self.c.storm["peak_mm_hr"] * math.exp(-(d ** 2) / (2 * sigma ** 2))
        for clng, clat, add, rad in self.cells:
            d = distance_m(lng, lat, clng, clat)
            v += add * math.exp(-(d ** 2) / (2 * rad ** 2))
        return max(0.0, v)


def _noise(seed: Optional[int], key: str, i: int) -> float:
    return random.Random(f"{seed}-{key}-{i}").gauss(0, 1)


def _sensor_window(s: Sensor, field_now: float, c: Controls) -> tuple[list[float], Optional[str]]:
    """The 6 samples of one rainfall gauge (5 previous + current), with any injected fault and override applied."""
    # 6 samples around the field value with sensor noise (like the model's training data):
    # 5 previous readings + the current one. The history must NOT include the current value.
    noise_std = 0.3 + 0.05 * field_now
    vals = [max(0.0, field_now + noise_std * _noise(c.seed, s.id, i + 1)) for i in range(6)]
    fault = c.faults.get(s.id)
    if fault == "spike":
        vals[5] = max(field_now, 1.0) * 6 + 25
    elif fault == "stuck":
        vals = [vals[0]] * 6
    elif fault == "dead":
        vals = [0.0] * 6
    elif fault == "drift":
        vals = [v + 3.0 * i for i, v in enumerate(vals)]
        vals[5] += 12.0
    if s.id in c.sensor_overrides:
        vals[5] = max(0.0, c.sensor_overrides[s.id])
    return vals, fault


def _readings_and_history(sensors: list[Sensor], fld: RainField, c: Controls):
    """Current GaugeReadings plus 5 previous readings per rainfall gauge, with injected faults."""
    readings: list[GaugeReading] = []
    history: dict[str, list[float]] = {}
    for s in sensors:
        field_now = fld.at(s.latitude, s.longitude)
        if s.sensor_type == "water_level":
            level = 150.0 + 7.0 * c.district_mm_hr + 3.0 * (field_now - c.district_mm_hr) + 4 * _noise(c.seed, s.id, 0)
            level = c.sensor_overrides.get(s.id, level)
            readings.append(GaugeReading(s.id, "water_level", s.latitude, s.longitude, round(max(0.0, level), 1), "cm", 0))
            continue
        vals, fault = _sensor_window(s, field_now, c)
        readings.append(GaugeReading(s.id, "rainfall", s.latitude, s.longitude, round(vals[5], 2), "mm/hr", 4,
                                     is_faulty=bool(fault), fault_type=fault))
        history[s.id] = [round(v, 3) for v in vals[:5]]
    return readings, history


def make_field(controls: Controls, all_farms: list[dict[str, Any]]):
    """The rain field for these controls (local per-farm adjustments become small Gaussian cells)."""
    circles = {f["farm_id"]: fitted_circle(f["ring"]) for f in all_farms}
    cells = []
    for f in all_farms:
        add = controls.farm_adjust.get(f["farm_id"])
        if add:
            circ = circles[f["farm_id"]]
            cells.append((circ["centre"][0], circ["centre"][1],
                          max(ADJUST_MIN, min(ADJUST_MAX, float(add))), max(FARM_CELL_MIN_RADIUS_M, 1.5 * circ["radius_m"])))
    return RainField(controls, cells), circles


def sensor_context(controls: Controls, fld: "RainField") -> dict[str, Any]:
    """Sensors, current readings, histories and the LightGBM classification of every sensor."""
    sensors = build_sensors(controls.sensor_count, controls.seed)
    readings, history = _readings_and_history(sensors, fld, controls)

    # Supporting weather evidence proxy (simulated): where an intense local cell really is wet, and
    # where the storm track is close. These separate a genuine localised cell from a spike.
    def local_excess(r: GaugeReading) -> float:
        return fld.at(r.lat, r.lng) - controls.district_mm_hr

    wet_ids = {r.sensor_id for r in readings if r.sensor_type == "rainfall" and local_excess(r) >= 20.0}
    storm_ids: set[str] = set()
    if controls.storm:
        for r in readings:
            # within 3 sigma: beyond that the storm's rain is negligible
            if distance_m(r.lng, r.lat, controls.storm["lng"], controls.storm["lat"]) <= 3 * controls.storm["radius_m"]:
                storm_ids.add(r.sensor_id)

    cls = {c.sensor_id: c for c in classify_readings(readings, history, wet_ids, storm_ids)}
    return {"sensors": sensors, "readings": readings, "history": history, "wet_ids": wet_ids,
            "storm_ids": storm_ids, "cls": cls}


# ─── Farms: only those registered on the shared land ─────────────────────────

_REAL_CACHE: dict[str, Any] = {"at": 0.0, "farms": []}
_REAL_TTL_S = 30.0


def _load_real_farms() -> list[dict[str, Any]]:
    """Registered farms + their policy, crop and farmer name (cached 30 s; failures degrade to none)."""
    now = time.time()
    if now - _REAL_CACHE["at"] < _REAL_TTL_S:
        return _REAL_CACHE["farms"]
    out: list[dict[str, Any]] = []
    try:
        from app.services.firestore_service import firestore_service as fs
        policies: dict[str, dict] = {}
        for p in fs.list_all_policies():
            fid = p.get("farm_id")
            if fid and (fid not in policies or p.get("status") == "active"):
                policies[fid] = p
        names: dict[str, str] = {}
        for f in fs.list_all_farms():
            uid = f.get("farmer_id") or f.get("farmer_uid")
            if uid and uid not in names:
                u = fs.db.collection("users").document(str(uid)).get()
                d = (u.to_dict() or {}) if u.exists else {}
                names[uid] = d.get("full_name") or (d.get("email") or "").split("@")[0] or "Farmer"
            crops = fs.list_crops_by_farm(f["id"])
            crop = None
            if crops:
                crop = sorted(crops, key=lambda c: c.get("area_hectares") or 0, reverse=True)[0].get("crop_type")
            pol = policies.get(f["id"])
            # Amounts already approved/paid on this policy count against its cap, exactly as the claim
            # engine and the agents treat them, so the map's liability equals what is still payable.
            paid = 0.0
            if pol:
                paid = sum(float(c.get("recommended_amount") or 0) for c in fs.list_claims_by_policy(pol["id"])
                           if claim_engine.is_committed(c))
            out.append({**f, "_policy": pol, "_crop": crop, "_farmer_name": names.get(uid), "_paid": paid})
    except Exception:  # noqa: BLE001
        pass
    _REAL_CACHE.update(at=now, farms=out)
    return out


def invalidate_real_farm_cache() -> None:
    _REAL_CACHE["at"] = 0.0


def _collect_farms() -> list[dict[str, Any]]:
    """Farms that were traced on the shared land (ring inside the patch), with their data."""
    out: list[dict[str, Any]] = []
    for f in _load_real_farms():
        geom = farm_geometry(f.get("latitude"), f.get("longitude"), f.get("area_hectares"), f.get("boundary_geojson"))
        if not geom or geom.get("type") != "Polygon":
            continue
        ring = geom["coordinates"][0]
        c = fitted_circle(ring)["centre"]
        if not land.contains(c[0], c[1], margin_frac=0.05):
            continue
        out.append({
            "farm_id": f["id"], "name": f.get("name") or "Farm", "farmer_id": f.get("farmer_id") or f.get("farmer_profile_id"),
            "farmer_profile_id": f.get("farmer_profile_id"),
            "farmer_label": f.get("_farmer_name") or "Farmer", "crop": f.get("_crop"), "ring": ring,
            "area_ha": f.get("area_hectares") or round(area_hectares(ring), 2),
            "policy": f.get("_policy"), "paid": f.get("_paid", 0.0), "image_url": f.get("image_url") or f.get("map_image_url"),
        })
    return out


# ─── Evaluation ──────────────────────────────────────────────────────────────

def _sev_payable(policy: dict, rain: float) -> float:
    trig = policy.get("rainfall_trigger_mm")
    if trig is None:
        return 0.0
    full = policy.get("rainfall_max_payout_mm")
    full = float(full) if full and float(full) > float(trig) else float(trig) * 1.5
    return float(policy.get("sum_insured") or 0) * claim_engine.severity(rain, float(trig), full)


def evaluate(controls: Controls, farms: Optional[list[dict[str, Any]]] = None,
             only_farm_ids: Optional[set[str]] = None) -> dict[str, Any]:
    t0 = time.time()
    all_farms = farms if farms is not None else _collect_farms()

    fld, circles = make_field(controls, all_farms)
    ctx = sensor_context(controls, fld)
    sensors, readings, history, cls = ctx["sensors"], ctx["readings"], ctx["history"], ctx["cls"]

    rain_r = [r for r in readings if r.sensor_type == "rainfall"]
    water_r = [r for r in readings if r.sensor_type == "water_level"]
    flood_district = derive_flood_risk(water_r) or 0.0

    sensor_out = []
    for r in readings:
        c = cls[r.sensor_id]
        status = "faulty" if c.is_flagged else ("suspicious" if c.trust_score < 0.6 else "healthy")
        sensor_out.append({
            "id": r.sensor_id, "type": r.sensor_type, "lat": r.lat, "lng": r.lng, "value": r.value,
            "unit": r.unit, "status": status, "classification": c.predicted_class,
            "confidence": c.confidence, "trust": c.trust_score, "note": c.investigation_note,
            "injected_fault": r.fault_type,
        })

    # Trust-weighted GP over rainfall gauges (same method as Stage 6), in land-scaled coordinates.
    locs, vals, trusts, ids = [], [], [], []
    for r in rain_r:
        t = cls[r.sensor_id].trust_score
        if t < 0.05:
            continue
        locs.append(list(land.to_unit(r.lng, r.lat)[::-1])); vals.append(r.value); trusts.append(t); ids.append(r.sensor_id)
    gp = None
    if len(ids) >= 2:
        try:
            gp = _fit_gp(np.array(locs), np.array(vals), _build_noise_alpha(trusts))
        except Exception:  # noqa: BLE001
            gp = None

    targets = [f for f in all_farms if only_farm_ids is None or f["farm_id"] in only_farm_ids]
    if gp is not None and targets:
        pts = np.array([list(land.to_unit(*circles[f["farm_id"]]["centre"])[::-1]) for f in targets])
        means, stds = gp.predict(pts, return_std=True)
    else:
        means = stds = None

    sensor_scale_m = 0.45 * land.span_m()      # distance at which a sensor's weight has faded
    farm_out: list[dict[str, Any]] = []
    naive_total = engine_total = prevented_amount = 0.0
    prevented_count = 0
    for k, f in enumerate(targets):
        circ = circles[f["farm_id"]]
        clng, clat = circ["centre"]
        dists = sorted(((distance_m(clng, clat, r.lng, r.lat), r) for r in rain_r), key=lambda t: t[0])
        naive_val = dists[0][1].value if dists else 0.0
        true_rain = fld.at(clat, clng)
        est = float(max(0.0, means[k])) if means is not None else None
        sigma = float(stds[k]) if stds is not None else None

        contributors, excluded, weights = [], [], []
        for d, r in dists[:6]:
            c = cls[r.sensor_id]
            usable = (not c.is_flagged) and c.trust_score >= 0.3
            w = c.trust_score * math.exp(-((d / sensor_scale_m) ** 2)) if usable else 0.0
            if usable and len(contributors) < CONTRIBUTORS_PER_FARM:
                contributors.append({"sensor_id": r.sensor_id, "distance_m": round(d), "reading": r.value,
                                     "trust": c.trust_score, "weight": w})
                weights.append(w)
            elif not usable:
                excluded.append({"sensor_id": r.sensor_id, "distance_m": round(d), "reading": r.value, "trust": c.trust_score,
                                 "reason": f"Classified {c.predicted_class} ({c.confidence:.0%}); excluded from the estimate"
                                           if c.is_flagged else f"Low trust ({c.trust_score:.2f}); down-weighted"})
        tw = sum(weights) or 1.0
        for c_ in contributors:
            c_["weight"] = round(c_["weight"] / tw, 3)
        mean_trust = (sum(c_["trust"] for c_ in contributors) / len(contributors)) if contributors else None

        policy = f["policy"]
        calc = None
        if policy and est is not None:
            # Use exactly the rounded numbers shown to the insurer (and later sent back when a claim record
            # is created), so the amount on the map always equals the amount in the saved claim.
            calc = claim_engine.calculate_claim(
                policy, event_id=EVENT_ID, event_date=date.today(), estimated_rainfall_mm=round(est, 2),
                rainfall_sigma_mm=round(sigma or 0.0, 2),
                sensor_trust=None if mean_trust is None else round(mean_trust, 3),
                already_paid=float(f.get("paid") or 0.0))
            naive_pay = _sev_payable(policy, naive_val)
            naive_total += naive_pay
            engine_total += calc.recommended_amount
            # A false payout is "prevented" when the nearest gauge a naive system would use is flagged
            # faulty and would have paid more than the evidence-based engine does.
            if dists and cls[dists[0][1].sensor_id].is_flagged and naive_pay > calc.recommended_amount:
                prevented_count += 1
                prevented_amount += naive_pay - calc.recommended_amount

        risk = categorise_risk(est, sigma)
        flood_prob = None
        if est is not None:
            flood_prob = round(min(1.0, max(0.0, 0.6 * flood_district + 0.4 * min(est / 60.0, 1.0))), 3)

        farm_out.append({
            "farm_id": f["farm_id"], "name": f["name"], "farmer_id": f["farmer_id"],
            "farmer_profile_id": f.get("farmer_profile_id"), "farmer_label": f["farmer_label"],
            "crop": f["crop"], "area_ha": f["area_ha"], "ring": f["ring"], "centre": circ["centre"],
            "circle_radius_m": circ["radius_m"], "circle": circ["polygon"], "image_url": f.get("image_url"),
            "estimated_rainfall": None if est is None else round(est, 2),
            "uncertainty": None if sigma is None else round(sigma, 2),
            "lower": None if est is None else round(max(0.0, est - 1.2816 * (sigma or 0)), 2),
            "upper": None if est is None else round(est + 1.2816 * (sigma or 0), 2),
            "true_rainfall": round(true_rain, 2),
            "adjust": controls.farm_adjust.get(f["farm_id"], 0.0),
            "risk": risk, "flood_probability": flood_prob,
            "policy": None if not policy else {
                "id": policy.get("id"), "number": policy.get("policy_number"), "status": policy.get("status"),
                "sum_insured": policy.get("sum_insured"), "trigger": policy.get("rainfall_trigger_mm"),
                "full": policy.get("rainfall_max_payout_mm"), "payout_limit": policy.get("payout_limit")},
            "claim": None if not calc else {
                "already_paid": float(f.get("paid") or 0.0),
                "outcome": calc.outcome, "recommended_amount": calc.recommended_amount,
                "entitlement": calc.entitlement, "trigger_crossed": calc.trigger_crossed,
                "eligible": calc.eligible, "needs_investigation": calc.needs_investigation,
                "requires_human_review": calc.requires_human_approval, "reasons": calc.reasons},
            "sensor_confidence": None if mean_trust is None else round(mean_trust, 3),
            "contributors": contributors, "excluded": excluded,
        })

    affected = [f for f in farm_out if f["claim"] and f["claim"]["trigger_crossed"]]
    eligible = [f for f in farm_out if f["claim"] and f["claim"]["outcome"] in ("PAY", "ADVANCE")]
    liability = round(sum(f["claim"]["recommended_amount"] for f in farm_out if f["claim"]), 2)
    occupied = round(sum(float(f["area_ha"] or 0) for f in all_farms), 2)
    summary = {
        "farms": len(farm_out), "farms_without_policy": sum(1 for f in farm_out if not f["policy"]),
        "affected_farms": len(affected), "eligible_claims": len(eligible), "total_liability": liability,
        "avg_payout_per_affected": round(liability / len(affected), 2) if affected else 0.0,
        "claims_needing_investigation": sum(1 for f in farm_out if f["claim"] and f["claim"]["needs_investigation"]),
        "false_payouts_prevented_count": prevented_count,
        "false_payouts_prevented_amount": round(prevented_amount, 2),
        "naive_nearest_sensor_liability": round(naive_total, 2),
        "flagged_sensors": sum(1 for s in sensor_out if s["status"] == "faulty"),
        "suspicious_sensors": sum(1 for s in sensor_out if s["status"] == "suspicious"),
        "district_flood_score": flood_district,
        "land_area_ha": round(land.area_ha(), 2), "occupied_ha": occupied,
        "occupied_pct": round(100.0 * occupied / land.area_ha(), 1),
    }
    w, h = land.size_m()
    clng, clat = land.centre()
    return {
        "land": {"ring": land.ring(), "centre": [clng, clat], "width_m": round(w), "height_m": round(h),
                 "bounds": list(land.bounds())},
        "controls": {"district_mm_hr": controls.district_mm_hr, "storm": controls.storm, "faults": controls.faults,
                     "sensor_overrides": controls.sensor_overrides, "farm_adjust": controls.farm_adjust,
                     "sensor_count": len(sensors), "seed": controls.seed},
        "sensors": sensor_out, "farms": farm_out, "summary": summary,
        "notes": ["Weather and sensors are SIMULATED. The map is the shared example farmland: only farms farmers "
                  "traced on it are shown, with their real policies.",
                  "Rainfall is compared with policy triggers in mm/hr (prototype assumption).",
                  "Payout figures come from the deterministic claim engine; no money moves."],
        "elapsed_ms": round((time.time() - t0) * 1000),
    }


def farm_series(controls: Controls, farm_id: str, steps: int = 24,
                farms: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    """One farm's rainfall and payout across the storm life-cycle (build-up → peak → fade).

    District and storm intensity are scaled by sin(pi * t); local adjustments are left as set.
    """
    all_farms = farms if farms is not None else _collect_farms()
    steps = max(4, min(60, steps))
    points = []
    for k in range(steps):
        t = k / (steps - 1)
        m = max(0.0, math.sin(math.pi * t))
        c = Controls(
            district_mm_hr=controls.district_mm_hr * m,
            storm=None if not controls.storm else {**controls.storm, "peak_mm_hr": controls.storm["peak_mm_hr"] * m},
            sensor_overrides=controls.sensor_overrides, faults=controls.faults, farm_adjust=controls.farm_adjust,
            sensor_count=controls.sensor_count, seed=controls.seed)
        r = evaluate(c, farms=all_farms, only_farm_ids={farm_id})
        f = r["farms"][0] if r["farms"] else None
        points.append({
            "t": round(t, 4),
            "estimated": None if not f else f["estimated_rainfall"],
            "truth": None if not f else f["true_rainfall"],
            "payout": 0.0 if not f or not f["claim"] else f["claim"]["recommended_amount"],
        })
    return {"farm_id": farm_id, "points": points}
