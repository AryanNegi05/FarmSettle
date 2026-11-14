"""Farmer-facing endpoints: profile, farms, crops, bank account."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status

from app.models.user import UserRole
from app.schemas.stage2 import (
    FarmerProfileCreate, FarmerProfileUpdate, FarmerProfileOut,
    FarmCreate, FarmUpdate, FarmOut,
    CropCreate, CropOut,
    BankAccountCreate, BankAccountOut,
)
from app.core.deps import require_role
from app.services.firestore_service import firestore_service
from pydantic import BaseModel

router = APIRouter(prefix="/api/farmers", tags=["farmers"])


# ── Profile ───────────────────────────────────────────────────────────────────

@router.post("/profile", response_model=FarmerProfileOut, status_code=201)
async def upsert_profile(
    body: FarmerProfileCreate,
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Create or fully update the authenticated farmer's profile."""
    existing = firestore_service.get_farmer_profile_by_uid(current_user.uid)
    
    if existing:
        # Update existing profile
        update_data = body.model_dump(exclude_unset=True)
        profile = firestore_service.update_farmer_profile(existing["id"], update_data)
    else:
        # Create new profile
        profile = firestore_service.create_farmer_profile(
            current_user.uid,
            body.model_dump()
        )
    
    # Add empty farms list for response
    profile["farms"] = []
    return profile


@router.get("/profile", response_model=FarmerProfileOut)
async def get_profile(
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Get authenticated farmer's profile."""
    profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    
    # Add farms to profile
    profile["farms"] = firestore_service.list_farms_by_profile(profile["id"])
    return profile


# ── Farms ─────────────────────────────────────────────────────────────────────

@router.post("/farms", response_model=FarmOut, status_code=201)
async def register_farm(
    body: FarmCreate,
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Register a new farm for the authenticated farmer."""
    profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    
    farm = firestore_service.create_farm(profile["id"], body.model_dump())
    
    # Add empty crops list for response
    farm["crops"] = []
    return farm


@router.get("/farms", response_model=list[FarmOut])
async def list_farms(
    current_user=Depends(require_role(UserRole.farmer)),
):
    """List all farms for the authenticated farmer."""
    profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
    if not profile:
        return []
    
    farms = firestore_service.list_farms_by_profile(profile["id"])
    
    # Add crops to each farm
    for farm in farms:
        farm["crops"] = firestore_service.list_crops_by_farm(farm["id"])
    
    return farms


@router.get("/farms/{farm_id}", response_model=FarmOut)
async def get_farm(
    farm_id: str,
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Get a specific farm by ID."""
    profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    
    farm = firestore_service.get_farm_by_id(farm_id)
    if not farm or farm["farmer_profile_id"] != profile["id"]:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    # Add crops to farm
    farm["crops"] = firestore_service.list_crops_by_farm(farm["id"])
    return farm


def _own_farm_or_404(farm_id: str, uid: str) -> dict:
    profile = firestore_service.get_farmer_profile_by_uid(uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    farm = firestore_service.get_farm_by_id(farm_id)
    if not farm or farm["farmer_profile_id"] != profile["id"]:
        raise HTTPException(status_code=404, detail="Farm not found")
    return farm


@router.put("/farms/{farm_id}", response_model=FarmOut)
async def update_farm(
    farm_id: str,
    body: FarmUpdate,
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Edit a farm (name, area, centroid, traced boundary). Only the owner may edit."""
    _own_farm_or_404(farm_id, current_user.uid)
    changes = body.model_dump(exclude_unset=True)
    if changes:
        farm = firestore_service.update_farm(farm_id, changes)
    else:
        farm = firestore_service.get_farm_by_id(farm_id)
    farm["crops"] = firestore_service.list_crops_by_farm(farm_id)
    return farm


class FarmImageBody(BaseModel):
    image_data_url: str


@router.post("/farms/{farm_id}/image", response_model=FarmOut)
async def upload_farm_image(
    farm_id: str,
    body: FarmImageBody,
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Store the farm's traced-map snapshot on Cloudinary and save its URL on the farm."""
    _own_farm_or_404(farm_id, current_user.uid)
    data = body.image_data_url
    if not data.startswith("data:image/") or len(data) > 8_000_000:
        raise HTTPException(status_code=400, detail="Invalid or too large image")
    from app.services.cloudinary_service import upload_farm_snapshot
    try:
        url = upload_farm_snapshot(farm_id, data)
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger("uvicorn.error").exception("Cloudinary upload failed for farm %s", farm_id)
        raise HTTPException(status_code=502, detail=f"Image upload failed: {exc}")
    farm = firestore_service.update_farm(farm_id, {"map_image_url": url})
    farm["crops"] = firestore_service.list_crops_by_farm(farm_id)
    return farm


# ── Crops ─────────────────────────────────────────────────────────────────────

@router.post("/farms/{farm_id}/crops", response_model=CropOut, status_code=201)
async def add_crop(
    farm_id: str,
    body: CropCreate,
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Add a crop to a farm."""
    profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    
    farm = firestore_service.get_farm_by_id(farm_id)
    if not farm or farm["farmer_profile_id"] != profile["id"]:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    crop = firestore_service.create_crop(farm_id, body.model_dump())
    return crop


# ── Bank Account ──────────────────────────────────────────────────────────────

@router.post("/bank-account", response_model=BankAccountOut, status_code=201)
async def submit_bank_account(
    body: BankAccountCreate,
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Submit or update bank account details."""
    profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")

    # Mask: keep only last 4 digits
    raw = body.account_number.strip()
    masked = "****" + raw[-4:] if len(raw) >= 4 else "****"

    bank_data = {
        "account_holder_name": body.account_holder_name,
        "masked_account_number": masked,
        "bank_name": body.bank_name,
        "ifsc_code": body.ifsc_code,
        "verification_status": "verified",
    }
    
    bank = firestore_service.create_bank_account(profile["id"], bank_data)
    return bank


@router.get("/bank-account", response_model=BankAccountOut)
async def get_bank_account(
    current_user=Depends(require_role(UserRole.farmer)),
):
    """Get bank account details for the authenticated farmer."""
    profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    
    bank = firestore_service.get_bank_account_by_profile(profile["id"])
    if not bank:
        raise HTTPException(status_code=404, detail="No bank account on file")
    
    return bank

