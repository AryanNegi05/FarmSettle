"""Pydantic v2 schemas for Stage 2: Farmer, Farm, Crop, Policy, PolicyRule, BankAccount."""
from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel


# ── Crop ─────────────────────────────────────────────────────────────────────

class CropCreate(BaseModel):
    crop_type: str
    season: Optional[str] = None
    area_hectares: Optional[float] = None


class CropOut(BaseModel):
    id: str
    farm_id: str
    crop_type: str
    season: Optional[str] = None
    area_hectares: Optional[float] = None

    model_config = {"from_attributes": True}


# ── Farm ──────────────────────────────────────────────────────────────────────

class FarmCreate(BaseModel):
    name: str
    area_hectares: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    boundary_geojson: Optional[str] = None
    map_image_url: Optional[str] = None


class FarmUpdate(BaseModel):
    name: Optional[str] = None
    area_hectares: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    boundary_geojson: Optional[str] = None
    map_image_url: Optional[str] = None


class FarmOut(BaseModel):
    id: str
    farmer_profile_id: str
    name: str
    area_hectares: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    boundary_geojson: Optional[str] = None
    map_image_url: Optional[str] = None
    created_at: datetime
    crops: List[CropOut] = []

    model_config = {"from_attributes": True}


# ── FarmerProfile ─────────────────────────────────────────────────────────────

class FarmerProfileCreate(BaseModel):
    phone: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None


class FarmerProfileUpdate(BaseModel):
    phone: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None


class FarmerProfileOut(BaseModel):
    id: str
    firebase_uid: str
    phone: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    created_at: datetime
    farms: List[FarmOut] = []

    model_config = {"from_attributes": True}


# ── PolicyRule ────────────────────────────────────────────────────────────────

class PolicyRuleCreate(BaseModel):
    rule_name: str
    rule_value: str
    description: Optional[str] = None


class PolicyRuleOut(BaseModel):
    id: str
    policy_id: str
    rule_name: str
    rule_value: str
    description: Optional[str] = None

    model_config = {"from_attributes": True}


# ── InsurancePolicy ───────────────────────────────────────────────────────────

class PolicyCreate(BaseModel):
    policy_number: str
    farm_id: str
    farmer_profile_id: str
    coverage_start: date
    coverage_end: date
    sum_insured: float
    rainfall_trigger_mm: Optional[float] = None
    rainfall_max_payout_mm: Optional[float] = None
    flood_trigger_level: Optional[float] = None
    payout_limit: Optional[float] = None
    status: str = "active"


class PolicyUpdate(BaseModel):
    coverage_start: Optional[date] = None
    coverage_end: Optional[date] = None
    sum_insured: Optional[float] = None
    rainfall_trigger_mm: Optional[float] = None
    rainfall_max_payout_mm: Optional[float] = None
    flood_trigger_level: Optional[float] = None
    payout_limit: Optional[float] = None
    status: Optional[str] = None


class PolicyOut(BaseModel):
    id: str
    policy_number: str
    farm_id: str
    farmer_profile_id: str
    insurer_firebase_uid: str
    coverage_start: date
    coverage_end: date
    sum_insured: float
    rainfall_trigger_mm: Optional[float] = None
    rainfall_max_payout_mm: Optional[float] = None
    flood_trigger_level: Optional[float] = None
    payout_limit: Optional[float] = None
    status: str
    created_at: datetime
    rules: List[PolicyRuleOut] = []

    model_config = {"from_attributes": True}


# ── BankAccountReference ──────────────────────────────────────────────────────

class BankAccountCreate(BaseModel):
    account_holder_name: str
    account_number: str          # Full number received; only last-4 stored
    bank_name: Optional[str] = None
    ifsc_code: Optional[str] = None


class BankAccountOut(BaseModel):
    id: str
    farmer_profile_id: str
    account_holder_name: str
    masked_account_number: str   # "****1234" only
    bank_name: Optional[str] = None
    ifsc_code: Optional[str] = None
    verification_status: str
    verified_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Farmer Summary & Detail for Insurer/Admin Views ───────────────────────────

class FarmerSummary(BaseModel):
    id: str
    firebase_uid: str
    full_name: str
    email: str
    phone: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    farm_count: int = 0
    policy_count: int = 0

    model_config = {"from_attributes": True}


class FarmerDetail(FarmerSummary):
    farms: List[FarmOut] = []
    policies: List[PolicyOut] = []

    model_config = {"from_attributes": True}
