"""Agent investigation API (Stage 7).

POST /api/agents/run takes the same scenario controls as the Command Centre (the sliders stand in
for real weather) and runs the four agents. Agents recommend; a human queues and approves claims.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.models.user import UserRole
from app.core.deps import require_role
from app.api.command import EvaluateIn, _controls
from app.services.agents import llm as llm_mod, run_investigation, queue_claims
from app.services.firestore_service import firestore_service as fs
from app.services import claims as claim_engine

router = APIRouter(prefix="/api/agents", tags=["agents"])

READ_ROLES = (UserRole.insurer, UserRole.admin, UserRole.auditor)
ACT_ROLES = (UserRole.insurer, UserRole.admin)


def _paid(policy_id: str) -> float:
    return sum(float(c.get("recommended_amount") or 0) for c in fs.list_claims_by_policy(policy_id)
               if claim_engine.is_committed(c))


@router.get("/status")
def status(current_user=Depends(require_role(*READ_ROLES))):
    return llm_mod.status()


@router.post("/run")
def run(body: EvaluateIn, current_user=Depends(require_role(*ACT_ROLES))):
    result = run_investigation(
        _controls(body), get_policy=fs.get_policy_by_id, paid_for_policy=_paid,
        claim_exists=lambda key: fs.get_claim(key) is not None)
    result["created_by"] = current_user.uid
    try:
        fs.save_agent_run(result)
        result["saved"] = True
    except Exception:  # noqa: BLE001  (a storage problem must not hide the investigation)
        result["saved"] = False
    return result


@router.get("/runs")
def runs(current_user=Depends(require_role(*READ_ROLES))):
    return fs.list_agent_runs()


@router.get("/runs/{run_id}")
def get_run(run_id: str, current_user=Depends(require_role(*READ_ROLES))):
    r = fs.get_agent_run(run_id)
    if not r:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return r


@router.post("/runs/{run_id}/queue-claims")
def queue(run_id: str, current_user=Depends(require_role(*ACT_ROLES))):
    """Human step: send the checked proposals to the claims queue. Still needs approval there."""
    r = fs.get_agent_run(run_id)
    if not r:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if r.get("approval_status") != "awaiting_human":
        raise HTTPException(status_code=409, detail=f"Run is '{r.get('approval_status')}', nothing to queue")
    made = queue_claims(r, current_user.uid, fs.create_claim_once)
    fs.db.collection("agent_runs").document(run_id).update({"queued_claim_ids": [m["claim_id"] for m in made]})
    return {"queued": made}
