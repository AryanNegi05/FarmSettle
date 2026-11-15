"""Premium collection via Razorpay Checkout (test mode while keys are rzp_test_*).

Flow: farmer asks for an order -> Checkout in the browser -> client calls /verify (HMAC check) and
Razorpay also calls /webhook. Both paths go through `_mark_paid`, which is idempotent, so a payment
can never be applied twice. The amount is always computed server-side from the policy.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.config import settings
from app.core.firebase_auth import get_current_user
from app.services import razorpay_client as rz
from app.services.firestore_service import firestore_service as fs

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/premium", tags=["premium"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def premium_for(policy: dict) -> float:
    return round(float(policy.get("sum_insured") or 0) * settings.premium_rate, 2)


def _orders():
    return fs.db.collection("premium_payments")


def _mark_paid(order_id: str, payment_id: str, source: str) -> bool:
    """Apply a captured payment once. Returns True if this call did the work."""
    ref = _orders().document(order_id)
    rec = ref.get().to_dict()
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown order")
    if rec.get("status") == "PAID":
        return False
    now = _now()
    ref.update({"status": "PAID", "payment_id": payment_id, "paid_at": now, "confirmed_by": source})
    fs.update_policy(rec["policy_id"], {
        "premium_status": "paid", "premium_paid_at": now,
        "premium_payment_id": payment_id, "premium_order_id": order_id,
    })
    return True


class OrderOut(BaseModel):
    order_id: str
    amount: int          # paise
    currency: str
    key_id: str
    policy_number: str


@router.post("/{policy_id}/order", response_model=OrderOut)
async def create_order(policy_id: str, current_user=Depends(get_current_user)):
    if not rz.configured():
        raise HTTPException(status_code=503, detail="Payments are not configured on the server.")
    policy = fs.get_policy_by_id(policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    profile = fs.get_farmer_profile_by_uid(current_user.uid)
    if not profile or profile["id"] != policy.get("farmer_profile_id"):
        raise HTTPException(status_code=403, detail="Not your policy")
    if policy.get("premium_status") == "paid":
        raise HTTPException(status_code=409, detail="Premium already paid")
    amount = premium_for(policy)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Policy has no premium due")
    try:
        order = rz.create_order(amount, f"prem_{policy_id}", {"policy_id": policy_id, "policy_number": policy["policy_number"]})
    except RuntimeError as e:
        log.error("%s", e)
        raise HTTPException(status_code=502, detail="Payment provider error")
    _orders().document(order["id"]).set({
        "order_id": order["id"], "policy_id": policy_id, "farmer_profile_id": profile["id"],
        "amount": amount, "currency": "INR", "status": "CREATED", "created_at": _now(),
        "mode": settings.payment_mode,
    })
    fs.update_policy(policy_id, {"premium_amount": amount,
                                 "premium_status": policy.get("premium_status") or "unpaid"})
    return OrderOut(order_id=order["id"], amount=order["amount"], currency="INR",
                    key_id=settings.razorpay_key_id, policy_number=policy["policy_number"])


class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/verify")
async def verify(body: VerifyIn, current_user=Depends(get_current_user)):
    rec = _orders().document(body.razorpay_order_id).get().to_dict()
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown order")
    profile = fs.get_farmer_profile_by_uid(current_user.uid)
    if not profile or profile["id"] != rec.get("farmer_profile_id"):
        raise HTTPException(status_code=403, detail="Not your order")
    if not rz.verify_checkout_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid payment signature")
    _mark_paid(body.razorpay_order_id, body.razorpay_payment_id, "client-verify")
    return {"status": "paid", "policy_id": rec["policy_id"]}


@router.post("/webhook")
async def webhook(request: Request):
    raw = await request.body()
    if not rz.verify_webhook_signature(raw, request.headers.get("X-Razorpay-Signature", "")):
        raise HTTPException(status_code=400, detail="Bad signature")
    event = json.loads(raw)
    if event.get("event") in ("payment.captured", "order.paid"):
        pay = (event.get("payload", {}).get("payment") or {}).get("entity") or {}
        order_id, payment_id = pay.get("order_id"), pay.get("id")
        if order_id and payment_id and _orders().document(order_id).get().exists:
            _mark_paid(order_id, payment_id, "webhook")
    return {"ok": True}
