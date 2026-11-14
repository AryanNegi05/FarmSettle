"""Claim challenges (disputes): the farmer's right to ask for a decision to be reviewed.

Rules are deterministic and money-safe:
- Only decided claims can be challenged: REJECTED, APPROVED (not yet paid) or PAID.
- One open challenge at a time, at most MAX_DISPUTES per claim.
- The claim moves to DISPUTED but still counts as its previous status for caps and reconciliation.
- Upholding never pays twice: an unpaid claim goes back to AWAITING_APPROVAL (a person re-decides);
  a PAID claim stays paid and any extra amount becomes a separate supplementary claim that must be
  approved and paid like any other, within the policy cap.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.services import claims as engine

MAX_DISPUTES = 2
DISPUTABLE = {"REJECTED", "APPROVED", "PAID"}
CATEGORIES = {
    "amount_too_low": "The amount is lower than my loss",
    "rejected_wrongly": "My claim was rejected but I think it should be paid",
    "wrong_rain_data": "The rain measured for my farm looks wrong",
    "other": "Something else",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def open_dispute(claim: dict[str, Any]) -> Optional[dict[str, Any]]:
    return next((d for d in claim.get("disputes", []) if d.get("status") == "open"), None)


def challenge_problem(claim: dict[str, Any]) -> Optional[str]:
    """Why this claim can't be challenged right now, or None if it can."""
    if open_dispute(claim) or claim.get("status") == "DISPUTED":
        return "You already have a challenge under review for this claim."
    if len(claim.get("disputes", [])) >= MAX_DISPUTES:
        return f"A claim can be challenged at most {MAX_DISPUTES} times."
    if claim.get("status") not in DISPUTABLE:
        return "You can challenge a claim once your insurer has made a decision on it."
    return None


def apply_challenge(claim: dict[str, Any], category: str, reason: str, by_uid: str) -> dict[str, Any]:
    """Fields to write on the claim when the farmer challenges it."""
    now = _now()
    n = len(claim.get("disputes", [])) + 1
    dispute = {"id": n, "category": category, "reason": reason.strip(), "status": "open", "created_at": now,
               "resolved_at": None, "resolution_note": None, "resolution": None}
    history = list(claim.get("history", []))
    history.append({"at": now, "by": by_uid, "from": claim["status"], "to": "DISPUTED",
                    "reason": f"Farmer challenged: {CATEGORIES[category]}"})
    return {"status": "DISPUTED", "pre_dispute_status": claim["status"],
            "disputes": list(claim.get("disputes", [])) + [dispute], "history": history}


def remaining_cap(policy: dict[str, Any], policy_claims: list[dict[str, Any]], exclude_claim_id: Optional[str] = None) -> float:
    """Room left under the policy's cap, counting every committed claim (disputed ones included)."""
    sum_insured = float(policy.get("sum_insured") or 0)
    limit = policy.get("payout_limit")
    cap = min(sum_insured, float(limit)) if limit is not None else sum_insured
    used = sum(float(c.get("recommended_amount") or 0) for c in policy_claims
               if engine.is_committed(c) and c.get("id") != exclude_claim_id)
    return max(0.0, round(cap - used, 2))


def resolve(claim: dict[str, Any], policy: dict[str, Any], policy_claims: list[dict[str, Any]], *,
            outcome: str, note: str, amount: Optional[float], by_uid: str) -> tuple[dict[str, Any], Optional[dict[str, Any]]]:
    """Insurer's answer to the open challenge. Returns (claim_update, supplementary_claim_or_None).

    Raises ValueError with a plain message when the answer isn't allowed.
    """
    d = open_dispute(claim)
    if claim.get("status") != "DISPUTED" or not d:
        raise ValueError("This claim has no open challenge.")
    if outcome not in ("uphold", "dismiss"):
        raise ValueError("Outcome must be 'uphold' or 'dismiss'.")
    before = claim.get("pre_dispute_status") or "REJECTED"
    now = _now()
    history = list(claim.get("history", []))
    disputes = [dict(x) for x in claim["disputes"]]
    cur = next(x for x in disputes if x["id"] == d["id"])
    cur.update(resolved_at=now, resolution_note=note.strip())
    supplementary = None

    if outcome == "dismiss":
        cur["status"] = "dismissed"
        new_status = before
        history.append({"at": now, "by": by_uid, "from": "DISPUTED", "to": new_status,
                        "reason": f"Challenge dismissed: {note.strip()}"})
        update = {"status": new_status, "disputes": disputes, "history": history, "pre_dispute_status": None}
        return update, None

    cur["status"] = "upheld"
    update: dict[str, Any] = {"disputes": disputes, "pre_dispute_status": None}
    if before == "PAID":
        extra = float(amount or 0)
        room = remaining_cap(policy, policy_claims)
        if extra <= 0:
            raise ValueError("Enter the additional amount to pay (more than zero).")
        if extra > room + 0.005:
            raise ValueError(f"That is more than the policy cap allows. At most ₹{room:,.0f} can still be paid.")
        sup_id = f"{claim['id']}__adj{d['id']}"
        supplementary = {
            "id": sup_id, "policy_id": claim.get("policy_id"), "farm_id": claim.get("farm_id"),
            "farmer_profile_id": claim.get("farmer_profile_id"), "event_id": claim.get("event_id"),
            "status": "AWAITING_APPROVAL", "outcome": "PAY", "recommended_amount": round(extra, 2),
            "calculation": claim.get("calculation"), "supplementary": True, "parent_claim_id": claim["id"],
            "dispute_id": d["id"], "decision_reason": None,
            "history": [{"at": now, "by": by_uid, "from": None, "to": "AWAITING_APPROVAL",
                         "reason": f"Additional payment after the farmer's challenge was upheld: {note.strip()}"}],
            "created_at": now, "created_by": by_uid}
        cur["resolution"] = {"additional_amount": round(extra, 2), "supplementary_claim_id": sup_id}
        history.append({"at": now, "by": by_uid, "from": "DISPUTED", "to": "PAID",
                        "reason": f"Challenge upheld: additional payment of ₹{extra:,.0f} queued. {note.strip()}"})
        update.update(status="PAID", history=history, disputes=disputes)
        return update, supplementary

    # Unpaid claim (rejected, or approved but not yet paid): back to a person for a fresh decision.
    new_amount = float(amount) if amount is not None else float(claim.get("recommended_amount") or 0)
    room = remaining_cap(policy, policy_claims, exclude_claim_id=claim["id"])
    if new_amount <= 0:
        raise ValueError("Enter the corrected amount (more than zero) so the claim can be approved.")
    if new_amount > room + 0.005:
        raise ValueError(f"That is more than the policy cap allows. At most ₹{room:,.0f} can be approved.")
    if abs(new_amount - float(claim.get("recommended_amount") or 0)) > 0.005:
        update["original_recommended_amount"] = claim.get("original_recommended_amount", claim.get("recommended_amount"))
        update["recommended_amount"] = round(new_amount, 2)
    cur["resolution"] = {"new_amount": round(new_amount, 2)}
    history.append({"at": now, "by": by_uid, "from": "DISPUTED", "to": "AWAITING_APPROVAL",
                    "reason": f"Challenge upheld: sent back for a new decision at ₹{new_amount:,.0f}. {note.strip()}"})
    update.update(status="AWAITING_APPROVAL", history=history, disputes=disputes, decision_reason=None)
    return update, None
