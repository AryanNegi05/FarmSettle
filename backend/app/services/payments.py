"""Simulated payment service (Stage 9).

SIMULATION ONLY: no bank, UPI or payment-rail integration exists. A "transaction"
is a database record with a made-up reference. Payment identity equals the claim
identity (farm + event + policy), so the same settlement can never be paid twice.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

PAYMENT_ENGINE = "sim-pay-1.0"


def new_transaction_ref() -> str:
    return "SIM-" + uuid.uuid4().hex[:12].upper()


def validate_payable(claim: dict[str, Any], bank: Optional[dict[str, Any]]) -> list[str]:
    """Return the reasons a claim cannot be paid right now (empty list = payable)."""
    problems: list[str] = []
    status = claim.get("status")
    if status == "PAID":
        problems.append("Claim is already paid.")
    elif status != "APPROVED":
        problems.append(f"Claim must be APPROVED before payment (current status: {status}).")
    if float(claim.get("recommended_amount") or 0) <= 0:
        problems.append("Approved amount is zero.")
    if not bank:
        problems.append("Farmer has no registered bank account.")
    elif bank.get("verification_status") not in (None, "verified"):
        problems.append(f"Bank account is not verified (status: {bank.get('verification_status')}).")
    return problems


def build_payment_record(claim: dict[str, Any], bank: dict[str, Any], by_uid: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "claim_id": claim["id"],
        "policy_id": claim.get("policy_id"),
        "farm_id": claim.get("farm_id"),
        "farmer_profile_id": claim.get("farmer_profile_id"),
        "event_id": claim.get("event_id"),
        "amount": round(float(claim["recommended_amount"]), 2),
        "currency": "INR",
        "status": "SUCCEEDED",
        "simulated": True,
        "transaction_ref": new_transaction_ref(),
        "destination": {
            "bank_name": bank.get("bank_name"),
            "account": bank.get("masked_account_number"),   # masked only
            "holder": bank.get("account_holder_name"),
        },
        "initiated_by": by_uid,
        "created_at": now,
        "engine": PAYMENT_ENGINE,
    }


def reconcile(claims: list[dict[str, Any]], payments: list[dict[str, Any]]) -> dict[str, Any]:
    """Cross-check claims against payments; any non-empty issue list is a problem."""
    paid_claims = {c["id"]: c for c in claims if c.get("status") == "PAID"}
    by_claim = {p["claim_id"]: p for p in payments}
    issues: list[str] = []
    for cid, c in paid_claims.items():
        p = by_claim.get(cid)
        if not p:
            issues.append(f"Claim {cid} is PAID but has no payment record.")
        elif abs(float(p["amount"]) - float(c.get("recommended_amount") or 0)) > 0.005:
            issues.append(f"Claim {cid}: payment amount {p['amount']} differs from approved {c.get('recommended_amount')}.")
    for cid in by_claim:
        if cid not in paid_claims:
            issues.append(f"Payment for claim {cid} exists but the claim is not PAID.")
    total_paid = round(sum(float(p["amount"]) for p in payments), 2)
    total_claims = round(sum(float(c.get("recommended_amount") or 0) for c in paid_claims.values()), 2)
    return {
        "paid_claims": len(paid_claims),
        "payments": len(payments),
        "total_paid": total_paid,
        "total_paid_claims_amount": total_claims,
        "balanced": not issues and abs(total_paid - total_claims) < 0.005,
        "issues": issues,
    }


def portfolio_stats(claims: list[dict[str, Any]], payments: list[dict[str, Any]]) -> dict[str, Any]:
    def total(status: set[str]) -> float:
        return round(sum(float(c.get("recommended_amount") or 0) for c in claims if c.get("status") in status), 2)
    def count(status: set[str]) -> int:
        return sum(1 for c in claims if c.get("status") in status)
    return {
        "total_claims": len(claims),
        "under_investigation": count({"UNDER_INVESTIGATION", "CREATED", "RECOMMENDED"}),
        "awaiting_approval": count({"AWAITING_APPROVAL"}),
        "on_hold": count({"ON_HOLD"}),
        "approved": count({"APPROVED", "PAYMENT_PENDING"}),
        "paid": count({"PAID"}),
        "rejected": count({"REJECTED"}),
        "amount_awaiting_approval": total({"AWAITING_APPROVAL"}),
        "amount_approved_unpaid": total({"APPROVED", "PAYMENT_PENDING"}),
        "amount_paid": round(sum(float(p["amount"]) for p in payments), 2),
        "approved_exposure": total({"APPROVED", "PAYMENT_PENDING", "PAID"}),
    }
