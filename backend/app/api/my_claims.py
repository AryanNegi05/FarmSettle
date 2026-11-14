"""Farmer's own claims (Stage 10): list and a transparent "why this amount" view.

A farmer can only see claims on their own policies. Responses are plain-language and contain no
internal user ids or other farmers' data.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.models.user import UserRole
from app.core.deps import require_role
from app.services import disputes as disp
from app.services.agents import llm
from app.services import farmer_view as view
from app.services.firestore_service import firestore_service as fs

router = APIRouter(prefix="/api/my", tags=["farmer-claims"])


def _profile(user) -> dict:
    p = fs.get_farmer_profile_by_uid(user.uid)
    if not p:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    return p


def _my_claims(profile: dict) -> tuple[list[dict], dict[str, dict]]:
    policies = {p["id"]: p for p in fs.list_policies_by_profile(profile["id"])}
    claims = [c for pid in policies for c in fs.list_claims_by_policy(pid)]
    claims.sort(key=lambda c: c.get("created_at", ""), reverse=True)
    return claims, policies


@router.get("/claims")
def my_claims(current_user=Depends(require_role(UserRole.farmer))):
    profile = _profile(current_user)
    claims, policies = _my_claims(profile)
    farms: dict[str, dict] = {}
    out = []
    for c in claims:
        fid = c.get("farm_id")
        if fid not in farms:
            farms[fid] = fs.get_farm_by_id(fid) or {}
        out.append(view.list_item(c, farms[fid].get("name"), (policies.get(c.get("policy_id")) or {}).get("policy_number")))
    return out


def _translated(detail: dict, lang: str) -> dict:
    """Add machine translations of the free-text fields (the AI summary, the insurer's notes). Wording of the
    amount explanation is NOT translated here: the frontend renders it from keys and the engine's numbers."""
    if lang not in llm.LANGS:
        return detail
    tr = {}
    if detail.get("ai_summary"):
        tr["ai_summary"] = llm.translate(detail["ai_summary"], lang)
    if (detail.get("decision") or {}).get("reason"):
        tr["decision_reason"] = llm.translate(detail["decision"]["reason"], lang)
    for it in detail["dispute"]["items"]:
        if it.get("response"):
            tr[f"response_{it['id']}"] = llm.translate(it["response"], lang)
    detail["translations"] = {k: v for k, v in tr.items() if v}
    detail["translation_lang"] = lang
    return detail


def _detail(claim: dict, policies: dict, lang: str = "en") -> dict:
    run = fs.get_agent_run(claim["agent_run_id"]) if claim.get("agent_run_id") else None
    payment = fs.get_payment(claim_id) if claim.get("status") == "PAID" else None
    return _translated(view.explain(claim, farm=fs.get_farm_by_id(claim.get("farm_id")),
                                    policy=policies.get(claim.get("policy_id")), run=run, payment=payment), lang)


def _own_claim(claim_id: str, user):
    claims, policies = _my_claims(_profile(user))
    claim = next((c for c in claims if c["id"] == claim_id), None)
    if not claim:                                   # not theirs and not found look identical
        raise HTTPException(status_code=404, detail="Claim not found")
    return claim, policies


@router.get("/claims/{claim_id}")
def my_claim(claim_id: str, lang: str = "en", current_user=Depends(require_role(UserRole.farmer))):
    claim, policies = _own_claim(claim_id, current_user)
    return _detail(claim, policies, lang)


class ChallengeIn(BaseModel):
    category: Literal["amount_too_low", "rejected_wrongly", "wrong_rain_data", "other"]
    reason: str = Field(min_length=10, max_length=1000)


@router.post("/claims/{claim_id}/challenge")
def challenge(claim_id: str, body: ChallengeIn, lang: str = "en", current_user=Depends(require_role(UserRole.farmer))):
    """The farmer asks for a decision to be reviewed. A person at the insurer answers it."""
    claim, policies = _own_claim(claim_id, current_user)
    problem = disp.challenge_problem(claim)
    if problem:
        raise HTTPException(status_code=409, detail=problem)
    update = disp.apply_challenge(claim, body.category, body.reason, current_user.uid)
    claim = {**claim, **fs.update_claim(claim_id, update)}
    claim["id"] = claim_id
    return _detail(claim, policies, lang)


# ── Crop-loss reports from the farmer (an input to the insurer's Basis Risk Monitor) ─────────────────

from app.api.basis_risk import LossReportIn, build_report   # noqa: E402


@router.post("/loss-reports", status_code=201)
def report_loss(body: LossReportIn, current_user=Depends(require_role(UserRole.farmer))):
    """The farmer reports crop damage on one of their own farms. It does not create or change a claim."""
    profile = _profile(current_user)
    farm = next((f for f in fs.list_farms_by_profile(profile["id"]) if f["id"] == body.farm_id), None)
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    r = fs.create_loss_report(build_report(body, farm=farm, source="farmer", uid=current_user.uid))
    return {k: r[k] for k in ("id", "farm_id", "loss_pct", "cause", "observed_on", "note", "source", "created_at")}


@router.get("/loss-reports")
def my_loss_reports(current_user=Depends(require_role(UserRole.farmer))):
    profile = _profile(current_user)
    own = {f["id"] for f in fs.list_farms_by_profile(profile["id"])}
    return [{k: r.get(k) for k in ("id", "farm_id", "loss_pct", "cause", "observed_on", "note", "source", "created_at")}
            for r in fs.list_loss_reports() if r.get("farm_id") in own]
