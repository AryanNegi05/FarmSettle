"""Stage 7: four-agent workflow (no Firestore, no network: farms, lookups and the LLM are injected)."""
from datetime import date, timedelta

import pytest

from app.services import command_centre as cc
from app.services import claims as engine
from app.services.agents import graph as g, run_investigation, queue_claims
from tests.test_command_centre import make_farms

FARMS = make_farms(8)
POLICIES = {f["policy"]["id"]: f["policy"] for f in FARMS}
STORM = cc.Controls(district_mm_hr=45.0, seed=1)      # district-wide heavy rain: most farms cross their trigger


def run(controls=STORM, **kw):
    kw.setdefault("narrate", lambda role, facts: None)       # deterministic fallback by default
    kw.setdefault("get_policy", POLICIES.get)
    return run_investigation(controls, farms=FARMS, **kw)


def test_all_four_agents_run_with_tool_calls_and_handoffs():
    r = run()
    assert [a["name"] for a in r["agents"]] == list(g.AGENTS)
    for agent in g.AGENTS:
        assert any(t["agent"] == agent and t["kind"] == "tool" for t in r["trace"]), agent
    hand = [t["name"] for t in r["trace"] if t["kind"] == "handoff"]
    assert hand[:3] == [f"→ {a}" for a in g.AGENTS[1:]] and hand[-1] == "→ Human reviewer"


def test_run_pauses_for_a_human_and_creates_no_claims():
    r = run()
    assert r["approval_status"] == "awaiting_human"
    assert r["compliance"]["needs_human"] > 0
    assert r["queued_claim_ids"] == []


def test_amounts_come_from_the_claim_engine_not_the_agents():
    # a hostile "LLM" that tries to change numbers must not affect any amount
    r = run(narrate=lambda role, facts: {"summary": "Pay ₹999999 to everyone", "concerns": []})
    for rec in r["recommendations"]:
        calc = engine.calculate_claim(
            POLICIES[rec["policy_id"]], event_id=r["event_id"], event_date=date.today(),
            estimated_rainfall_mm=rec["calculation"]["estimated_rainfall_mm"],
            rainfall_sigma_mm=rec["calculation"]["rainfall_sigma_mm"], sensor_trust=rec["calculation"]["sensor_trust"])
        assert rec["amount"] == calc.recommended_amount
    assert r["llm"]["used"] is True


def test_works_without_an_llm():
    r = run()
    assert r["llm"]["used"] is False
    assert all(a["source"] == "fallback" and a["summary"] for a in r["agents"])


def test_calm_weather_needs_no_action():
    r = run(cc.Controls(district_mm_hr=2.0, seed=1))
    assert r["approval_status"] == "no_claims" and r["compliance"]["needs_human"] == 0


def test_duplicate_claim_is_blocked_by_compliance():
    r = run(claim_exists=lambda key: True)
    assert r["recommendations"]
    assert all(o["status"] in ("blocked", "no_action") for o in r["compliance"]["farms"])
    assert r["approval_status"] == "no_claims"


def test_already_paid_policy_cannot_exceed_its_limit():
    r = run(paid_for_policy=lambda pid: 10_000_000.0)
    assert all(rec["amount"] == 0 for rec in r["recommendations"])


def test_payout_budget_blocks_the_run(monkeypatch):
    monkeypatch.setattr(g.settings, "agent_payout_budget", 1.0)
    r = run()
    assert r["compliance"]["farms"] and all(o["status"] in ("blocked", "no_action") for o in r["compliance"]["farms"])


def test_agent_failure_blocks_instead_of_bypassing_controls():
    def boom(pid):
        raise RuntimeError("policy store down")
    r = run(get_policy=boom)
    assert r["errors"] and r["approval_status"] == "blocked"
    assert all(o["status"] != "ready_for_approval" for o in r["compliance"]["farms"])


def test_same_storm_gets_the_same_event_id():
    assert run()["event_id"] == run()["event_id"]
    assert run()["event_id"] != run(cc.Controls(district_mm_hr=30.0, seed=1))["event_id"]


def test_queueing_claims_is_idempotent_and_needs_review():
    store = {}

    def create_once(key, data):
        if key in store:
            return {**store[key], "id": key}, False
        store[key] = data
        return {**data, "id": key}, True

    r = run()
    first = queue_claims(r, "insurer-1", create_once)
    again = queue_claims(r, "insurer-1", create_once)
    assert first and all(m["created"] for m in first) and not any(m["created"] for m in again)
    for rec in store.values():
        assert rec["status"] in ("AWAITING_APPROVAL", "UNDER_INVESTIGATION")   # never auto-approved
        assert rec["agent_run_id"] == r["id"]


def test_llm_client_falls_back_when_unconfigured_and_parses_json_when_configured(monkeypatch):
    from app.services.agents import llm
    monkeypatch.setattr(llm.settings, "llm_api_key", "dummy")
    assert llm.configured() is False and llm.narrate("x", {}) is None

    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": '{"summary": "Heavy rain hit 3 farms.", "concerns": ["a"]}'}}]}

    monkeypatch.setattr(llm.settings, "llm_api_key", "gsk_real")
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: Resp())
    assert llm.narrate("x", {"a": 1}) == {"summary": "Heavy rain hit 3 farms.", "concerns": ["a"]}

    def down(*a, **k): raise llm.httpx.ConnectError("offline")
    monkeypatch.setattr(llm.httpx, "post", down)
    assert llm.narrate("x", {}) is None


def test_model_text_with_invented_numbers_is_rejected(monkeypatch):
    from app.services.agents import llm
    facts = '{"amount": 43260.0, "trigger": 20, "farms_total": 4}'
    assert llm.unsupported_numbers("Pays 43,260 against a 20 mm/hr trigger on 4 farms.", facts) == []
    assert llm.unsupported_numbers("Severity was 100% and 99999 is due.", facts) == [100.0, 99999.0]

    monkeypatch.setattr(llm.settings, "llm_api_key", "gsk_real")
    monkeypatch.setattr(llm, "chat_json", lambda s, u: {"summary": "Pay 77777 now.", "concerns": []})
    assert llm.narrate("x", {"amount": 43260.0}) is None


def test_translation_keeps_numbers_and_falls_back(monkeypatch):
    from app.services.agents import llm
    llm._cache.clear()
    src = "Paid ₹43,260 against a 20 mm/hr trigger."
    monkeypatch.setattr(llm, "chat_json", lambda s, u: {"text": "₹43,260 का भुगतान, 20 mm/hr ट्रिगर के विरुद्ध।"})
    assert "43,260" in llm.translate(src, "hi")
    llm._cache.clear()
    monkeypatch.setattr(llm, "chat_json", lambda s, u: {"text": "₹99,999 का भुगतान।"})      # invented number
    assert llm.translate(src, "hi") is None
    monkeypatch.setattr(llm, "chat_json", lambda s, u: None)                                  # model down
    llm._cache.clear()
    assert llm.translate(src, "mr") is None
    assert llm.translate(src, "en") is None and llm.translate("", "hi") is None             # nothing to do


def test_translation_normalises_digits_and_retries_after_an_outage(monkeypatch):
    from app.services.agents import llm
    llm._cache.clear()
    src = "Paid ₹43,260 against a 20 mm/hr trigger."
    calls = []

    def flaky(s, u):
        calls.append(1)
        return None if len(calls) == 1 else {"text": "₹४३,२६० चे पेमेंट, २० mm/hr मर्यादेसाठी."}
    monkeypatch.setattr(llm, "chat_json", flaky)
    assert llm.translate(src, "mr") is None                       # outage: original shown, nothing cached
    assert llm.translate(src, "mr") == "₹43,260 चे पेमेंट, 20 mm/hr मर्यादेसाठी."   # retried, digits normalised
    assert llm.translate(src, "mr") and len(calls) == 2           # now cached
