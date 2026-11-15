"""Claim requests: the farmer asks, the insurer assesses (rain scenario + formula + model explanation) and decides.

Flow:  farmer POST /api/my/claim-requests  →  insurer opens the request on the 3D map, sets the simulated rainfall,
POST /api/claim-requests/{id}/assess (amount from the claim engine; the model only explains)  →
POST /api/claim-requests/{id}/decide  approve | reject | hold.  Approve/reject creates the claim record at that
moment; hold keeps the request open. Nothing here moves money: payment stays in Claims Review.
"""
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.command import EvaluateIn, _controls
from app.api.my_claims import _profile
from app.core.deps import require_role
from app.models.user import UserRole
from app.services import claim_assessment as ca
from app.services import claims as engine
from app.services import command_centre as cc
from app.services.firestore_service import firestore_service as fs

farmer_router = APIRouter(prefix="/api/my/claim-requests", tags=["claim-requests"])
router = APIRouter(prefix="/api/claim-requests", tags=["claim-requests"])

READ_ROLES = (UserRole.insurer, UserRole.admin, UserRole.auditor)
DECIDE_ROLES = (UserRole.insurer, UserRole.admin)
OPEN = ("pending", "assessed", "on_hold")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(r: dict) -> dict:
    a = r.get("assessment") or {}
    return {k: r.get(k) for k in ("id", "farm_id", "farm_name", "farmer_label", "policy_id", "note", "status", "created_at",
                                  "claim_id", "decision_reason", "decided_at")} | {
        "assessment": None if not a else {k: a.get(k) for k in ("assessed_at", "outcome", "amount", "estimated_rainfall_mm")}}


# ── Farmer ───────────────────────────────────────────────────────────────────

class ClaimRequestIn(BaseModel):
    farm_id: str
    note: Optional[str] = Field(default=None, max_length=500)


@farmer_router.post("", status_code=201)
def create_request(body: ClaimRequestIn, current_user=Depends(require_role(UserRole.farmer))):
    profile = _profile(current_user)
    farm = next((f for f in fs.list_farms_by_profile(profile["id"]) if f["id"] == body.farm_id), None)
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    policies = [p for p in fs.list_policies_by_profile(profile["id"]) if p.get("farm_id") == farm["id"]]
    policy = next((p for p in policies if p.get("status") == "active"), None)
    if not policy:
        raise HTTPException(status_code=409, detail="This farm has no active insurance policy, so a claim cannot be requested.")
    if any(r.get("farm_id") == farm["id"] and r.get("status") in OPEN for r in fs.list_claim_requests(profile["id"])):
        raise HTTPException(status_code=409, detail="You already have an open claim request for this farm.")
    r = fs.create_claim_request({
        "farm_id": farm["id"], "farm_name": farm.get("name") or "Farm", "farmer_profile_id": profile["id"],
        "farmer_uid": current_user.uid, "farmer_label": profile.get("full_name") or profile.get("name") or "Farmer",
        "policy_id": policy["id"], "note": (body.note or "").strip() or None, "status": "pending",
        "created_at": _now(), "history": [{"at": _now(), "to": "pending", "reason": "Requested by the farmer"}],
    })
    return _public(r)


@farmer_router.get("")
def my_requests(current_user=Depends(require_role(UserRole.farmer))):
    return [_public(r) for r in fs.list_claim_requests(_profile(current_user)["id"])]


# ── Insurer ──────────────────────────────────────────────────────────────────

@router.get("")
def list_requests(status: Optional[str] = None, current_user=Depends(require_role(*READ_ROLES))):
    return [_public(r) for r in fs.list_claim_requests() if not status or r.get("status") == status]


class PreviewIn(EvaluateIn):
    farm_id: str


def _committed(farm_id: str) -> list[dict]:
    """Earlier approved/paid claims that already count against this farm's policy cap."""
    farm = next((f for f in cc._collect_farms() if f["farm_id"] == farm_id), None)
    pol = (farm or {}).get("policy")
    if not pol:
        return []
    return [{"status": c.get("status"), "amount": c.get("recommended_amount"), "date": str(c.get("created_at") or "")[:10]}
            for c in fs.list_claims_by_policy(pol["id"]) if engine.is_committed(c)]


def _assess_dict(res: dict) -> dict:
    return {k: res[k] for k in ("evidence", "ai", "recommendation", "problem", "llm", "cap_exhausted") if k in res} | {
        "farm_id": res["farm"]["farm_id"],
        "claim": res["farm"].get("claim"), "estimated_rainfall": res["farm"].get("estimated_rainfall"),
        "uncertainty": res["farm"].get("uncertainty"), "sensor_confidence": res["farm"].get("sensor_confidence")}


@router.post("/preview")
def preview(body: PreviewIn, current_user=Depends(require_role(*DECIDE_ROLES))):
    """Assess a farm under the current scenario without a request (nothing is saved)."""
    try:
        return _assess_dict(ca.assess(_controls(body), body.farm_id, None, committed=_committed(body.farm_id)))
    except KeyError:
        raise HTTPException(status_code=404, detail="Farm not found on the shared land")


@router.post("/{request_id}/assess")
def assess(request_id: str, body: EvaluateIn, current_user=Depends(require_role(*DECIDE_ROLES))):
    r = fs.get_claim_request(request_id)
    if not r:
        raise HTTPException(status_code=404, detail="Claim request not found")
    if r["status"] not in OPEN:
        raise HTTPException(status_code=409, detail=f"This request is already {r['status']}.")
    controls = _controls(body)
    try:
        res = ca.assess(controls, r["farm_id"], r.get("note"), committed=_committed(r["farm_id"]))
    except KeyError:
        raise HTTPException(status_code=404, detail="Farm is not on the shared land map")
    out = _assess_dict(res)
    if res["problem"]:
        return out
    farm = res["farm"]
    snapshot = {
        "assessed_at": _now(), "controls": res_controls(farm_id=r["farm_id"], controls=controls, body=body),
        "estimated_rainfall_mm": farm["estimated_rainfall"], "rainfall_sigma_mm": farm["uncertainty"] or 0.0,
        "sensor_trust": farm["sensor_confidence"], "outcome": farm["claim"]["outcome"],
        "amount": farm["claim"]["recommended_amount"], "ai_summary": res["ai"]["summary"], "ai_source": res["ai"]["source"],
        "evidence": res["evidence"],
    }
    fs.update_claim_request(request_id, {"assessment": snapshot, "status": "assessed" if r["status"] == "pending" else r["status"]})
    return out


def res_controls(farm_id: str, controls: cc.Controls, body: EvaluateIn) -> dict:
    """The simulated rainfall scenario, kept with the request so the decision can be reproduced."""
    return {"district_mm_hr": controls.district_mm_hr, "storm": controls.storm, "faults": controls.faults,
            "sensor_overrides": controls.sensor_overrides, "farm_adjust": controls.farm_adjust,
            "sensor_count": controls.sensor_count, "seed": controls.seed}


class DecideIn(BaseModel):
    action: Literal["approve", "reject", "hold"]
    reason: str = Field(min_length=3, max_length=500)


@router.post("/{request_id}/decide")
def decide(request_id: str, body: DecideIn, current_user=Depends(require_role(*DECIDE_ROLES))):
    r = fs.get_claim_request(request_id)
    if not r:
        raise HTTPException(status_code=404, detail="Claim request not found")
    if r["status"] not in OPEN:
        raise HTTPException(status_code=409, detail=f"This request is already {r['status']}.")
    history = list(r.get("history", []))
    now = _now()

    if body.action == "hold":
        history.append({"at": now, "by": current_user.uid, "to": "on_hold", "reason": body.reason})
        return _public(fs.update_claim_request(request_id, {"status": "on_hold", "decision_reason": body.reason, "history": history}))

    a = r.get("assessment")
    if not a:
        raise HTTPException(status_code=409, detail="Assess the request first: the decision uses the saved rainfall assessment.")
    policy = fs.get_policy_by_id(r.get("policy_id") or "")
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    paid = sum(float(c.get("recommended_amount") or 0) for c in fs.list_claims_by_policy(policy["id"]) if engine.is_committed(c))
    calc = engine.calculate_claim(
        policy, event_id=f"request-{request_id}", event_date=date.today(),
        estimated_rainfall_mm=a["estimated_rainfall_mm"], rainfall_sigma_mm=a.get("rainfall_sigma_mm") or 0.0,
        sensor_trust=a.get("sensor_trust"), already_paid=paid)
    if body.action == "approve" and calc.recommended_amount <= 0:
        raise HTTPException(status_code=409, detail="Nothing can be approved: the engine outcome is "
                            f"{calc.outcome} with a zero amount. Reject it or put it on hold.")

    status = "APPROVED" if body.action == "approve" else "REJECTED"
    record = {
        "policy_id": calc.policy_id, "farm_id": calc.farm_id, "farmer_profile_id": r.get("farmer_profile_id"),
        "event_id": calc.event_id, "claim_request_id": request_id, "status": status, "outcome": calc.outcome,
        "recommended_amount": calc.recommended_amount, "calculation": calc.to_dict(),
        "ai_summary": a.get("ai_summary"), "scenario": a.get("controls"),
        "decision_reason": body.reason, "decided_by": current_user.uid, "decided_at": now,
        "history": [{"at": now, "by": current_user.uid, "from": None, "to": "AWAITING_APPROVAL",
                     "reason": "Claim created from the farmer's request"},
                    {"at": now, "by": current_user.uid, "from": "AWAITING_APPROVAL", "to": status, "reason": body.reason}],
        "created_at": now, "created_by": current_user.uid,
    }
    claim, _ = fs.create_claim_once(calc.idempotency_key, record)
    history.append({"at": now, "by": current_user.uid, "to": status.lower(), "reason": body.reason})
    updated = fs.update_claim_request(request_id, {
        "status": status.lower(), "claim_id": claim["id"], "decision_reason": body.reason, "decided_at": now, "history": history})
    cc.invalidate_real_farm_cache()   # the approved amount now counts against the policy on the map
    return {"request": _public(updated), "claim": claim}
