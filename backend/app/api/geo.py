"""Stage 3 geographic endpoints: demo district, sensors, water, farm map layers.

All data is now fetched from Firestore — no SQLite / SQLAlchemy.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.models.user import UserRole
from app.core.deps import require_role
from app.core.firebase_auth import get_current_user, get_firestore_db
from app.services import geo
from app.services.geo import generate_farms as _generate_sim_farms
from app.services.firestore_service import firestore_service
from app.schemas.geo import FarmMapDetail, CropBrief, PolicyBrief

router = APIRouter(prefix="/api/geo", tags=["geo"])


# ── Static / simulated geographic context ────────────────────────────────────

@router.get("/district")
def get_district():
    """Demo district boundary as a single GeoJSON Feature."""
    return geo.district_feature()


@router.get("/sensors")
def get_sensors():
    """Rainfall + water-level gauge locations as a GeoJSON FeatureCollection."""
    return geo.sensors_feature_collection()


@router.get("/water")
def get_water():
    """Rivers and water bodies as a GeoJSON FeatureCollection."""
    return geo.water_feature_collection()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _privacy_safe_label(full_name: str | None, email: str | None, is_owner: bool = False) -> str:
    if is_owner:
        return "Your farm"
    name = (full_name or "").strip()
    if name:
        parts = name.split()
        if len(parts) == 1:
            return parts[0]
        return f"{parts[0]} {parts[-1][0]}."
    em = email or ""
    if "@" in em:
        local, domain = em.split("@", 1)
        local = local[:2] + "***" if len(local) > 2 else local[:1] + "***"
        return f"{local}@{domain}"
    return "Farmer"


def _primary_crop(crops: list[dict]) -> str | None:
    if not crops:
        return None
    ordered = sorted(crops, key=lambda c: (c.get("area_hectares") or 0), reverse=True)
    return ordered[0].get("crop_type") if ordered else None


def _farm_feature(farm: dict, farmer_label: str, policy: dict | None,
                  is_owner: bool = False) -> dict | None:
    lat = farm.get("latitude")
    lng = farm.get("longitude")
    area = farm.get("area_hectares")
    boundary = farm.get("boundary_geojson")
    geometry = geo.farm_geometry(lat, lng, area, boundary)
    if geometry is None:
        return None  # no usable location → omit from the map
    crops = farm.get("_crops", [])
    primary_crop = _primary_crop(crops)
    props = {
        "farm_id": farm["id"],
        "name": farm.get("name"),
        "area_hectares": area,
        "farmer_label": farmer_label,
        "primary_crop": primary_crop,
        "policy_status": policy["status"] if policy else "none",
        "sum_insured": policy["sum_insured"] if policy else None,
        "is_own": is_owner,
        "estimated_rainfall_mm": None,
        "risk_category": None,
        "claim_status": None,
        "map_image_url": farm.get("map_image_url"),
        "simulated": False,
    }
    return {"type": "Feature", "geometry": geometry, "properties": props}


def _first_active_policy_for_farm(policies: list[dict], farm_id: str) -> dict | None:
    """Filter policies for a specific farm and return active one (or newest)."""
    farm_policies = [p for p in policies if p.get("farm_id") == farm_id]
    if not farm_policies:
        return None
    active = [p for p in farm_policies if p.get("status") == "active"]
    return active[0] if active else farm_policies[0]


def _get_user_info(uid: str) -> tuple[str | None, str | None]:
    """Return (full_name, email) from Firestore users collection."""
    try:
        user_doc = get_firestore_db().collection("users").document(uid).get()
        if user_doc.exists:
            d = user_doc.to_dict()
            return d.get("full_name"), d.get("email")
    except Exception:
        pass
    return None, None


# ── Farm map layers ───────────────────────────────────────────────────────────

@router.get("/farms")
async def get_farms(current_user=Depends(get_current_user)):
    """Farm boundaries as a GeoJSON FeatureCollection.

    Role aware:
      - Farmer: only their own farms (centred-view), labelled "Your farm".
      - Insurer / auditor / admin: all farms within the demo district bbox,
        with privacy-safe farmer labels.
    """
    features: list[dict] = []

    if current_user.role == UserRole.farmer:
        profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
        if not profile:
            return {"type": "FeatureCollection", "features": []}
        farms = firestore_service.list_farms_by_profile(profile["id"])
        # Fetch all policies for this profile once
        policies = firestore_service.list_policies_by_profile(profile["id"])
        for farm in farms:
            # Attach crops
            farm["_crops"] = firestore_service.list_crops_by_farm(farm["id"])
            policy = _first_active_policy_for_farm(policies, farm["id"])
            feat = _farm_feature(farm, "Your farm", policy, is_owner=True)
            if feat:
                feat["properties"]["in_demo_district"] = geo.in_district(
                    farm.get("latitude"), farm.get("longitude")
                )
                features.append(feat)
        return {"type": "FeatureCollection", "features": features}

    # Insurer / auditor / admin — district view.
    all_farms = firestore_service.list_all_farms()
    for farm in all_farms:
        lat, lng = farm.get("latitude"), farm.get("longitude")
        if not geo.in_district(lat, lng):
            continue
        farm["_crops"] = firestore_service.list_crops_by_farm(farm["id"])
        # Get the farmer profile to find the owner's uid
        profile_id = farm.get("farmer_profile_id")
        label = "Farmer"
        if profile_id:
            profile = firestore_service.get_farmer_profile_by_id(profile_id)
            if profile:
                uid = profile.get("firebase_uid")
                if uid:
                    full_name, email = _get_user_info(uid)
                    label = _privacy_safe_label(full_name, email, is_owner=False)
        # Policies for this farm (search all policies by farm_id)
        policy = _get_policy_for_farm(farm["id"])
        feat = _farm_feature(farm, label, policy, is_owner=False)
        if feat:
            feat["properties"]["in_demo_district"] = True
            features.append(feat)
    return {"type": "FeatureCollection", "features": features}


def _get_policy_for_farm(farm_id: str) -> dict | None:
    """Return the most relevant policy for a farm from Firestore."""
    try:
        from google.cloud.firestore_v1 import FieldFilter
        db = get_firestore_db()
        docs = db.collection("policies").where(
            filter=FieldFilter("farm_id", "==", farm_id)
        ).stream()
        policies = []
        for doc in docs:
            p = doc.to_dict()
            p["id"] = doc.id
            policies.append(p)
        if not policies:
            return None
        active = [p for p in policies if p.get("status") == "active"]
        return active[0] if active else policies[0]
    except Exception:
        return None


# ── Farm detail panel ─────────────────────────────────────────────────────────

def _nearest_sim_farm_id(lat: float | None, lng: float | None) -> str | None:
    if lat is None or lng is None:
        return None
    sim_farms = _generate_sim_farms()
    best_id: str | None = None
    best_dist = float("inf")
    for sf in sim_farms:
        dist = (sf.latitude - lat) ** 2 + (sf.longitude - lng) ** 2
        if dist < best_dist:
            best_dist = dist
            best_id = sf.id
    return best_id


def _get_latest_risk_estimate(farm_id: str) -> dict | None:
    """Return the most recent risk estimate for a farm from Firestore."""
    try:
        from google.cloud.firestore_v1 import FieldFilter
        db = get_firestore_db()
        docs = (
            db.collection("farm_risk_estimates")
            .where(filter=FieldFilter("farm_id", "==", farm_id))
            .order_by("tick", direction="DESCENDING")
            .limit(1)
            .stream()
        )
        for doc in docs:
            r = doc.to_dict()
            r["id"] = doc.id
            return r
    except Exception:
        pass
    return None


@router.get("/farms/{farm_id}", response_model=FarmMapDetail)
async def get_farm_detail(
    farm_id: str,
    current_user=Depends(get_current_user),
):
    """Rich farm record for the map detail panel."""
    farm = firestore_service.get_farm_by_id(farm_id)
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    # Permission: farmers may only view their own farms.
    if current_user.role == UserRole.farmer:
        profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
        if not profile or farm.get("farmer_profile_id") != profile["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
        profile_obj = profile
    else:
        profile_id = farm.get("farmer_profile_id")
        profile_obj = firestore_service.get_farmer_profile_by_id(profile_id) if profile_id else None

    is_owner = current_user.role == UserRole.farmer

    # Get farmer label
    if is_owner:
        farmer_label = "Your farm"
    elif profile_obj:
        uid = profile_obj.get("firebase_uid")
        full_name, email = _get_user_info(uid) if uid else (None, None)
        farmer_label = _privacy_safe_label(full_name, email, is_owner=False)
    else:
        farmer_label = "Farmer"

    # Policy
    policy = _get_policy_for_farm(farm_id)
    policy_brief = None
    sum_insured = None
    policy_status = "none"
    if policy:
        policy_brief = PolicyBrief(
            id=policy["id"],
            policy_number=policy.get("policy_number", ""),
            status=policy.get("status", "unknown"),
            sum_insured=policy.get("sum_insured"),
            coverage_start=str(policy.get("coverage_start", "")),
            coverage_end=str(policy.get("coverage_end", "")),
        )
        sum_insured = policy.get("sum_insured")
        policy_status = policy.get("status", "none")

    # Crops
    raw_crops = firestore_service.list_crops_by_farm(farm_id)
    crops = [
        CropBrief(
            crop_type=c.get("crop_type", ""),
            season=c.get("season"),
            area_hectares=c.get("area_hectares"),
        )
        for c in raw_crops
    ]

    # Risk estimate — try nearest simulated farm first, then direct Firestore lookup
    lat = farm.get("latitude")
    lng = farm.get("longitude")
    sim_farm_id = _nearest_sim_farm_id(lat, lng)
    risk_est = _get_latest_risk_estimate(sim_farm_id or farm_id)

    estimated_rainfall_mm = risk_est.get("estimated_rainfall_mm") if risk_est else None
    risk_category = risk_est.get("risk_category") if risk_est else None

    stage_notes: list[str] = []
    if not lat or not lng:
        stage_notes.append("No coordinates stored for this farm — not shown on the map.")
    if not risk_est:
        stage_notes.append("Risk assessment not yet available (Stage 6).")
    stage_notes.append("Claim tracking not yet available (Stage 8).")

    return FarmMapDetail(
        farm_id=farm["id"],
        name=farm.get("name", ""),
        area_hectares=farm.get("area_hectares"),
        latitude=lat,
        longitude=lng,
        farmer_label=farmer_label,
        district=profile_obj.get("district") if profile_obj else None,
        state=profile_obj.get("state") if profile_obj else None,
        crops=crops,
        primary_crop=_primary_crop(raw_crops),
        policy=policy_brief,
        policy_status=policy_status,
        sum_insured=sum_insured,
        estimated_rainfall_mm=estimated_rainfall_mm,
        risk_category=risk_category,
        stage_notes=stage_notes,
        in_demo_district=geo.in_district(lat, lng),
    )
