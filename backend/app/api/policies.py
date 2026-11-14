"""Policy endpoints (insurer/admin CRUD) and admin farmer-search endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status, Query

from app.models.user import UserRole
from app.schemas.stage2 import PolicyCreate, PolicyUpdate, PolicyOut, FarmerSummary, FarmerDetail
from app.core.deps import require_role
from app.core.firebase_auth import get_current_user, get_firestore_db
from app.services.firestore_service import firestore_service

# ── Policy router ─────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/policies", tags=["policies"])


@router.post("", response_model=PolicyOut, status_code=201)
@router.post("/", response_model=PolicyOut, status_code=201, include_in_schema=False)
async def create_policy(
    body: PolicyCreate,
    current_user=Depends(require_role(UserRole.insurer, UserRole.admin)),
):
    """Create a new insurance policy."""
    # Check if policy number already exists
    existing = firestore_service.get_policy_by_number(body.policy_number)
    if existing:
        raise HTTPException(status_code=400, detail="Policy number already exists")
    
    # Create policy with insurer's Firebase UID
    policy_data = body.model_dump()
    policy_data["insurer_firebase_uid"] = current_user.uid
    
    policy = firestore_service.create_policy(policy_data)
    
    # Add empty rules list for response
    policy["rules"] = []
    return policy


@router.get("", response_model=list[PolicyOut])
@router.get("/", response_model=list[PolicyOut], include_in_schema=False)
async def list_policies(
    farmer_id: str | None = Query(default=None),
    current_user=Depends(get_current_user),
):
    """List policies. Farmers see only their own; insurers/admins see all or filtered."""
    if current_user.role == UserRole.farmer.value or current_user.role == UserRole.farmer:
        profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
        if not profile:
            return []
        policies = firestore_service.list_policies_by_profile(profile["id"])
    elif farmer_id:
        policies = firestore_service.list_policies_by_profile(farmer_id)
    else:
        policies = firestore_service.list_all_policies()
    
    # Add rules to each policy
    for policy in policies:
        policy["rules"] = firestore_service.list_rules_by_policy(policy["id"])
    
    return policies


@router.get("/farmer/{farmer_profile_id}", response_model=list[PolicyOut])
async def list_policies_for_farmer(
    farmer_profile_id: str,
    current_user=Depends(get_current_user),
):
    """List all policies for a specific farmer profile."""
    # Insurer/admin/auditor can see any farmer; farmer can only see their own
    if current_user.role == UserRole.farmer.value or current_user.role == UserRole.farmer:
        profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
        if not profile or profile["id"] != farmer_profile_id:
            raise HTTPException(status_code=403, detail="Access denied")
    
    policies = firestore_service.list_policies_by_profile(farmer_profile_id)
    
    # Add rules to each policy
    for policy in policies:
        policy["rules"] = firestore_service.list_rules_by_policy(policy["id"])
    
    return policies


@router.get("/{policy_id}", response_model=PolicyOut)
async def get_policy(
    policy_id: str,
    current_user=Depends(get_current_user),
):
    """Get a specific policy by ID."""
    policy = firestore_service.get_policy_by_id(policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    
    # Check access for farmers
    if current_user.role == UserRole.farmer.value or current_user.role == UserRole.farmer:
        profile = firestore_service.get_farmer_profile_by_uid(current_user.uid)
        if not profile or policy["farmer_profile_id"] != profile["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    
    # Add rules to policy
    policy["rules"] = firestore_service.list_rules_by_policy(policy["id"])
    return policy


@router.patch("/{policy_id}", response_model=PolicyOut)
async def update_policy(
    policy_id: str,
    body: PolicyUpdate,
    current_user=Depends(require_role(UserRole.insurer, UserRole.admin)),
):
    """Update a policy."""
    policy = firestore_service.get_policy_by_id(policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    
    update_data = body.model_dump(exclude_unset=True)
    updated_policy = firestore_service.update_policy(policy_id, update_data)
    
    # Add rules to policy
    updated_policy["rules"] = firestore_service.list_rules_by_policy(policy_id)
    return updated_policy


# ── Admin farmer-search router ────────────────────────────────────────────────

admin_router = APIRouter(prefix="/api/admin/farmers", tags=["admin"])


@admin_router.get("", response_model=list[FarmerSummary])
@admin_router.get("/", response_model=list[FarmerSummary], include_in_schema=False)
async def search_farmers(
    search: str | None = Query(default=None),
    q: str | None = Query(default=None),
    current_user=Depends(require_role(UserRole.insurer, UserRole.admin, UserRole.auditor)),
):
    """Search and list all farmer profiles."""
    query_str = search or q
    
    # Get Firestore DB for user details
    firestore_db = get_firestore_db()
    
    profiles = firestore_service.list_all_farmer_profiles()
    results: list[FarmerSummary] = []
    
    for p in profiles:
        # Fetch user details from Firestore
        try:
            user_doc = firestore_db.collection("users").document(p["firebase_uid"]).get()
            if user_doc.exists:
                user_data = user_doc.to_dict()
                full_name = user_data.get("full_name", "Farmer")
                email = user_data.get("email", "")
            else:
                full_name = "Farmer"
                email = ""
        except Exception:
            full_name = "Farmer"
            email = ""
        
        # Apply search filter if provided
        if query_str:
            like = query_str.lower()
            if not (like in (full_name or "").lower() or 
                   like in (email or "").lower() or
                   like in (p.get("district") or "").lower()):
                continue
        
        # Get farm and policy counts
        farms = firestore_service.list_farms_by_profile(p["id"])
        policies = firestore_service.list_policies_by_profile(p["id"])
        
        results.append(
            FarmerSummary(
                id=p["id"],
                firebase_uid=p["firebase_uid"],
                full_name=full_name,
                email=email,
                phone=p.get("phone"),
                district=p.get("district"),
                state=p.get("state"),
                farm_count=len(farms),
                policy_count=len(policies),
            )
        )
    return results


@admin_router.get("/{farmer_profile_id}", response_model=FarmerDetail)
async def get_farmer_detail(
    farmer_profile_id: str,
    current_user=Depends(require_role(UserRole.insurer, UserRole.admin, UserRole.auditor)),
):
    """Get detailed information about a specific farmer."""
    profile = firestore_service.get_farmer_profile_by_id(farmer_profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    
    # Get Firestore DB for user details
    firestore_db = get_firestore_db()
    
    # Fetch user details from Firestore
    try:
        user_doc = firestore_db.collection("users").document(profile["firebase_uid"]).get()
        if user_doc.exists:
            user_data = user_doc.to_dict()
            full_name = user_data.get("full_name", "Farmer")
            email = user_data.get("email", "")
        else:
            full_name = "Farmer"
            email = ""
    except Exception:
        full_name = "Farmer"
        email = ""
    
    # Get farms with crops
    farms = firestore_service.list_farms_by_profile(profile["id"])
    for farm in farms:
        farm["crops"] = firestore_service.list_crops_by_farm(farm["id"])
    
    # Get policies with rules
    policies = firestore_service.list_policies_by_profile(profile["id"])
    for policy in policies:
        policy["rules"] = firestore_service.list_rules_by_policy(policy["id"])
    
    return FarmerDetail(
        id=profile["id"],
        firebase_uid=profile["firebase_uid"],
        full_name=full_name,
        email=email,
        phone=profile.get("phone"),
        district=profile.get("district"),
        state=profile.get("state"),
        farm_count=len(farms),
        policy_count=len(policies),
        farms=farms,
        policies=policies,
    )

