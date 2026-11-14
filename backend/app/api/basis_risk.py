"""Basis Risk Monitor API.

POST /api/basis-risk/assess  runs the Command Centre simulation for the given controls and assesses every farm.
GET/POST /api/basis-risk/reports  loss reports (insurer/admin record field observations; farmers report their own via /api/my).
"""
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.command import EvaluateIn, _controls
from app.core.deps import require_role
from app.models.user import UserRole
from app.services import basis_risk as br
from app.services import command_centre as cc
from app.services.firestore_service import firestore_service as fs

router = APIRouter(prefix="/api/basis-risk", tags=["basis-risk"])

READ_ROLES = (UserRole.insurer, UserRole.admin, UserRole.auditor)
ACT_ROLES = (UserRole.insurer, UserRole.admin)


class LossReportIn(BaseModel):
    farm_id: str
    loss_pct: float = Field(ge=0, le=100)
    cause: Literal["excess_rain", "flood", "waterlogging", "drought", "pest_disease", "other"] = "excess_rain"
    observed_on: Optional[date] = None
    note: str = Field(default="", max_length=500)


def build_report(body: LossReportIn, *, farm: dict, source: str, uid: str) -> dict:
    return {"farm_id": body.farm_id, "farmer_profile_id": farm.get("farmer_profile_id"), "loss_pct": round(body.loss_pct, 1),
            "cause": body.cause, "observed_on": (body.observed_on or date.today()).isoformat(), "note": body.note.strip(),
            "source": source, "created_by": uid, "created_at": datetime.now(timezone.utc).isoformat()}


@router.post("/assess")
def assess(body: EvaluateIn, current_user=Depends(require_role(*READ_ROLES))):
    evaluation = cc.evaluate(_controls(body))
    out = br.assess_all(evaluation, fs.list_loss_reports())
    out["controls"] = evaluation["controls"]
    out["evaluation_summary"] = evaluation["summary"]
    out["land"] = {"centre": evaluation["land"]["centre"], "bounds": evaluation["land"]["bounds"]}
    return out


@router.get("/reports")
def reports(farm_id: Optional[str] = None, current_user=Depends(require_role(*READ_ROLES))):
    return fs.list_loss_reports(farm_id)


@router.post("/reports", status_code=201)
def add_report(body: LossReportIn, current_user=Depends(require_role(*ACT_ROLES))):
    """Insurer/admin records a field observation. It is an indicator input, not an automatic claim."""
    farm = fs.get_farm_by_id(body.farm_id)
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    return fs.create_loss_report(build_report(body, farm=farm, source="insurer_field", uid=current_user.uid))
