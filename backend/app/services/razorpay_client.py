"""Minimal Razorpay REST client (httpx, no SDK) plus signature helpers."""
from __future__ import annotations

import hashlib
import hmac
from typing import Any

import httpx

from app.core.config import settings

API = "https://api.razorpay.com/v1"


def configured() -> bool:
    return bool(settings.razorpay_key_id and settings.razorpay_key_secret) and settings.payment_mode != "sim"


def _auth() -> tuple[str, str]:
    return settings.razorpay_key_id, settings.razorpay_key_secret


def create_order(amount_inr: float, receipt: str, notes: dict[str, str]) -> dict[str, Any]:
    r = httpx.post(f"{API}/orders", auth=_auth(), timeout=20, json={
        "amount": int(round(amount_inr * 100)),     # paise
        "currency": "INR",
        "receipt": receipt[:40],
        "notes": notes,
    })
    if r.status_code >= 400:
        raise RuntimeError(f"Razorpay order failed: {r.status_code} {r.text}")
    return r.json()


def fetch_payment(payment_id: str) -> dict[str, Any]:
    r = httpx.get(f"{API}/payments/{payment_id}", auth=_auth(), timeout=20)
    if r.status_code >= 400:
        raise RuntimeError(f"Razorpay payment lookup failed: {r.status_code} {r.text}")
    return r.json()


def _hmac(secret: str, msg: bytes) -> str:
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def verify_checkout_signature(order_id: str, payment_id: str, signature: str) -> bool:
    expected = _hmac(settings.razorpay_key_secret, f"{order_id}|{payment_id}".encode())
    return hmac.compare_digest(expected, signature or "")


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    if not settings.razorpay_webhook_secret:
        return False
    return hmac.compare_digest(_hmac(settings.razorpay_webhook_secret, raw_body), signature or "")
