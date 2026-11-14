"""Real-data replay endpoints: IMD district rainfall through the RWBCIS excess-rainfall term sheet.

Read-only and simulation-only. No claims are created and no money moves.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import require_role
from app.models.user import UserRole
from app.services import rwbcis_backtest as rw

router = APIRouter(prefix="/api/backtest", tags=["backtest"])

READ_ROLES = (UserRole.insurer, UserRole.admin, UserRole.auditor)


@router.get("/scheme-example")
def scheme_example(_user=Depends(require_role(*READ_ROLES))):
    """The guideline's published worked example vs what our engine computes."""
    return {"scheme": rw.SCHEME, "terms": rw.GUIDELINE_EXAMPLE["terms"], "cases": rw.guideline_example()}


@router.get("/portfolio")
def portfolio(hectares: float = Query(1.0, gt=0, le=1000), _user=Depends(require_role(*READ_ROLES))):
    return rw.run(hectares)


@router.get("/districts/{district}")
def district(district: str, hectares: float = Query(1.0, gt=0, le=1000),
             _user=Depends(require_role(*READ_ROLES))):
    try:
        return rw.district_detail(district, hectares)
    except KeyError:
        raise HTTPException(404, f"No IMD data for district '{district}'.")
