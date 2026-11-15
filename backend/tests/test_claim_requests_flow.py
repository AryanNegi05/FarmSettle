"""Claim-request flow (farmer applies → insurer assesses → decides) against an in-memory store."""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import claim_requests as cr
from app.api.command import EvaluateIn
from app.services import command_centre as cc
from app.services.agents import llm
from tests.test_command_centre import make_farms


class FakeFS:
    def __init__(self, farms):
        self.farms = farms
        self.requests, self.claims = {}, {}

    def list_farms_by_profile(self, pid): return [{"id": f["farm_id"], "name": f["name"]} for f in self.farms if f["farmer_profile_id"] == pid]
    def list_policies_by_profile(self, pid): return [f["policy"] for f in self.farms if f["farmer_profile_id"] == pid and f["policy"]]
    def get_farmer_profile_by_uid(self, uid): return {"id": uid, "full_name": "Test"}
    def create_claim_request(self, d): i = f"R{len(self.requests)}"; self.requests[i] = {**d, "id": i}; return self.requests[i]
    def get_claim_request(self, i): return self.requests.get(i)
    def list_claim_requests(self, pid=None): return [r for r in self.requests.values() if not pid or r["farmer_profile_id"] == pid]
    def update_claim_request(self, i, d): self.requests[i].update(d); return self.requests[i]
    def get_policy_by_id(self, pid): return next((f["policy"] for f in self.farms if f["policy"] and f["policy"]["id"] == pid), None)
    def list_claims_by_policy(self, pid): return [c for c in self.claims.values() if c["policy_id"] == pid]
    def create_claim_once(self, i, d):
        if i in self.claims: return self.claims[i], False
        self.claims[i] = {**d, "id": i}; return self.claims[i], True


@pytest.fixture()
def env(monkeypatch):
    farms = make_farms()
    fs = FakeFS(farms)
    monkeypatch.setattr(cr, "fs", fs)
    monkeypatch.setattr(cr, "_profile", lambda u: {"id": u.uid, "full_name": "Test"})
    monkeypatch.setattr(cc, "_collect_farms", lambda: [dict(f) for f in farms])
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: None)
    return fs


def user(i): return SimpleNamespace(uid=f"U{i}")
def scenario(): return EvaluateIn(district_mm_hr=70.0)


def test_apply_then_assess_then_approve_creates_claim_once(env):
    r = cr.create_request(cr.ClaimRequestIn(farm_id="F0", note="flooded"), current_user=user(0))
    assert r["status"] == "pending"
    with pytest.raises(HTTPException) as e:                                 # one open request per farm
        cr.create_request(cr.ClaimRequestIn(farm_id="F0"), current_user=user(0))
    assert e.value.status_code == 409
    with pytest.raises(HTTPException):                                      # must assess before approving
        cr.decide(r["id"], cr.DecideIn(action="approve", reason="ok ok"), current_user=user(9))
    out = cr.assess(r["id"], scenario(), current_user=user(9))
    assert out["claim"]["recommended_amount"] > 0 and env.requests[r["id"]]["status"] == "assessed"
    done = cr.decide(r["id"], cr.DecideIn(action="approve", reason="rain confirmed"), current_user=user(9))
    claim = done["claim"]
    assert claim["status"] == "APPROVED" and claim["recommended_amount"] == out["claim"]["recommended_amount"]
    assert done["request"]["status"] == "approved" and done["request"]["claim_id"] == claim["id"]
    with pytest.raises(HTTPException):                                      # already decided
        cr.decide(r["id"], cr.DecideIn(action="reject", reason="changed mind"), current_user=user(9))


def test_hold_keeps_request_open_and_reject_creates_rejected_claim(env):
    r = cr.create_request(cr.ClaimRequestIn(farm_id="F1"), current_user=user(1))
    held = cr.decide(r["id"], cr.DecideIn(action="hold", reason="wait for data"), current_user=user(9))
    assert held["status"] == "on_hold" and not env.claims
    cr.assess(r["id"], EvaluateIn(district_mm_hr=2.0), current_user=user(9))      # dry weather: nothing payable
    with pytest.raises(HTTPException) as e:
        cr.decide(r["id"], cr.DecideIn(action="approve", reason="please"), current_user=user(9))
    assert e.value.status_code == 409
    out = cr.decide(r["id"], cr.DecideIn(action="reject", reason="no rain at farm"), current_user=user(9))
    assert out["claim"]["status"] == "REJECTED" and out["claim"]["recommended_amount"] == 0


def test_farm_without_active_policy_cannot_apply(env):
    env.farms[2]["policy"]["status"] = "cancelled"
    with pytest.raises(HTTPException) as e:
        cr.create_request(cr.ClaimRequestIn(farm_id="F2"), current_user=user(2))
    assert e.value.status_code == 409
