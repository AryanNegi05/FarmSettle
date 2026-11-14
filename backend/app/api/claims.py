"""Claim endpoints (Stage 8): deterministic calculation, idempotent creation, human decisions.

All amounts are simulations. No money moves here; payment is Stage 9.
"""
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.models.user import UserRole
from app.core.deps import require_role
from app.services import claims as engine
from app.services import payments as pay
from app.services.firestore_service import firestore_service

router = APIRouter(prefix="/api/claims", tags=["claims"])

READ_ROLES = (UserRole.insurer, UserRole.admin, UserRole.auditor)
DECIDE_ROLES = (UserRole.insurer, UserRole.admin)

# Statuses whose recommended amount counts as already committed against the policy cap.
COMMITTED = {"APPROVED", "PAYMENT_PENDING", "PAID"}


class ClaimRequest(BaseModel):
    policy_id: str
    event_id: str = Field(min_length=1)
    event_date: Optional[date] = None
    estimated_rainfall_mm: float
    rainfall_sigma_mm: float = 0.0
    sensor_trust: Optional[float] = Field(default=None, ge=0, le=1)
    water_level: Optional[float] = None
    dry_run: bool = True   # calculate only; set false to create the claim record


class DecisionRequest(BaseModel):
    action: Literal["approve", "hold", "reject", "investigate"]
    reason: str = Field(min_length=3, max_length=500)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/calculate")
async def calculate(body: ClaimRequest, current_user=Depends(require_role(*DECIDE_ROLES))):
    """Calculate (and optionally record) a claim. Deterministic and idempotent."""
    policy = firestore_service.get_policy_by_id(body.policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    paid = sum(
        float(c.get("recommended_amount") or 0)
        for c in firestore_service.list_claims_by_policy(policy["id"])
        if c.get("status") in COMMITTED
    )
    calc = engine.calculate_claim(
        policy,
        event_id=body.event_id,
        event_date=body.event_date or date.today(),
        estimated_rainfall_mm=body.estimated_rainfall_mm,
        rainfall_sigma_mm=body.rainfall_sigma_mm,
        sensor_trust=body.sensor_trust,
        water_level=body.water_level,
        already_paid=paid,
    )
    result: dict = {"calculation": calc.to_dict(), "claim": None, "created": False}
    if body.dry_run or calc.outcome == "NONE":
        return result

    status = engine.initial_status(calc)
    record = {
        "policy_id": calc.policy_id,
        "farm_id": calc.farm_id,
        "farmer_profile_id": policy.get("farmer_profile_id"),
        "event_id": body.event_id,
        "status": status,
        "outcome": calc.outcome,
        "recommended_amount": calc.recommended_amount,
        "calculation": calc.to_dict(),
        "decision_reason": None,
        "history": [{"at": _now(), "by": current_user.uid, "from": None, "to": status,
                     "reason": "Claim created by deterministic engine"}],
        "created_at": _now(),
        "created_by": current_user.uid,
    }
    claim, created = firestore_service.create_claim_once(calc.idempotency_key, record)
    result.update(claim=claim, created=created)
    return result


@router.get("")
async def list_claims(status: Optional[str] = None, current_user=Depends(require_role(*READ_ROLES))):
    return firestore_service.list_claims(status)


@router.get("/stats/summary")
async def stats(current_user=Depends(require_role(*READ_ROLES))):
    """Dashboard counters and amounts."""
    return pay.portfolio_stats(firestore_service.list_claims(), firestore_service.list_payments())


@router.get("/payments/all")
async def list_payments(current_user=Depends(require_role(*READ_ROLES))):
    return firestore_service.list_payments()


@router.get("/reconciliation/report")
async def reconciliation(current_user=Depends(require_role(*READ_ROLES))):
    """Check that paid claims and payment records agree."""
    return pay.reconcile(firestore_service.list_claims(), firestore_service.list_payments())


@router.post("/{claim_id}/pay")
async def pay_claim(claim_id: str, current_user=Depends(require_role(*DECIDE_ROLES))):
    """Simulate paying an APPROVED claim to the farmer's registered account (once only)."""
    claim = firestore_service.get_claim(claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    if claim["status"] == "PAID":   # idempotent replay: return the original payment
        return {"claim": claim, "payment": firestore_service.get_payment(claim_id), "created": False}

    bank = firestore_service.get_bank_account_by_profile(claim.get("farmer_profile_id") or "")
    problems = pay.validate_payable(claim, bank)
    if problems:
        raise HTTPException(status_code=409, detail=" ".join(problems))

    record = pay.build_payment_record(claim, bank, current_user.uid)
    payment, created = firestore_service.create_payment_once(claim_id, record)
    if not created:
        raise HTTPException(status_code=409, detail="A payment already exists for this claim.")

    history = list(claim.get("history", []))
    now = _now()
    history.append({"at": now, "by": current_user.uid, "from": "APPROVED", "to": "PAYMENT_PENDING",
                    "reason": "Payment instruction created (simulated)"})
    history.append({"at": now, "by": current_user.uid, "from": "PAYMENT_PENDING", "to": "PAID",
                    "reason": f"Simulated transaction {payment['transaction_ref']} succeeded"})
    updated = firestore_service.update_claim(claim_id, {
        "status": "PAID", "history": history, "transaction_ref": payment["transaction_ref"], "paid_at": now,
    })
    return {"claim": updated, "payment": payment, "created": True}


@router.get("/{claim_id}")
async def get_claim(claim_id: str, current_user=Depends(require_role(*READ_ROLES))):
    claim = firestore_service.get_claim(claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    return claim


_ACTION_TO_STATUS = {
    "approve": "APPROVED", "hold": "ON_HOLD", "reject": "REJECTED", "investigate": "UNDER_INVESTIGATION",
}


@router.post("/{claim_id}/decision")
async def decide(claim_id: str, body: DecisionRequest, current_user=Depends(require_role(*DECIDE_ROLES))):
    """A human reviewer approves, holds, rejects or sends a claim for investigation."""
    claim = firestore_service.get_claim(claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    new_status = _ACTION_TO_STATUS[body.action]
    current = claim["status"]
    if not engine.can_transition(current, new_status):
        raise HTTPException(status_code=409, detail=f"Cannot move claim from {current} to {new_status}")
    if body.action == "approve" and float(claim.get("recommended_amount") or 0) <= 0:
        raise HTTPException(status_code=409, detail="Nothing to approve: recommended amount is zero")

    history = list(claim.get("history", []))
    history.append({"at": _now(), "by": current_user.uid, "from": current, "to": new_status, "reason": body.reason})
    return firestore_service.update_claim(claim_id, {
        "status": new_status, "decision_reason": body.reason, "history": history,
        "decided_by": current_user.uid, "decided_at": _now(),
    })
