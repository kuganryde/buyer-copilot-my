import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from copilot_engine.api import Settings, create_app
from copilot_engine.repository import MemoryRepository

SVC = "s" * 40
BUY = "b" * 40
N8N = "http://n8n.internal:5678"


@pytest.fixture
def ctx():
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        return httpx.Response(200, json={"ok": True})

    settings = Settings(env="test", service_token=SVC, buyer_proxy_token=BUY, n8n_base_url=N8N,
                        n8n_resume_header_value="r" * 40, database_url=None, rate_limit_per_min=1000)
    repo = MemoryRepository([{"agency_name": "X", "category": "LAND_OFFICE", "jurisdiction_state": "SELANGOR",
                              "official_url": "https://x", "contact_details": "", "summary_rule": "s",
                              "last_verified_date": None, "is_active": True, "is_proposed_pending_gazette": False}])
    app = create_app(settings, repo, httpx.Client(transport=httpx.MockTransport(handler)))
    return TestClient(app), calls


def buyer(b="buyer-001"):
    return {"Authorization": f"Bearer {BUY}", "X-Buyer-Id": b}


SVC_H = {"Authorization": f"Bearer {SVC}"}
CALC = {"purchase_price": "500000", "property_type": "RESIDENTIAL_HOUSE", "buyer_status": "CITIZEN",
        "spa_date": "2026-12-01", "market_value": "500000", "loan_amount": "450000"}


def test_auth_required_and_constant_roles(ctx):
    c, _ = ctx
    assert c.post("/v1/calculate", json=CALC).status_code == 401
    assert c.post("/v1/calculate", json=CALC, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.post("/v1/calculate", json=CALC, headers={"Authorization": f"Bearer {BUY}"}).status_code == 401
    assert c.post("/v1/calculate", json=CALC, headers={**buyer(), "X-Buyer-Id": "bad id;drop"}).status_code == 401


def test_calculate_returns_string_money(ctx):
    c, _ = ctx
    r = c.post("/v1/calculate", json=CALC, headers=buyer())
    assert r.status_code == 200, r.text
    assert r.json()["mot_duty"] == "9000.00"
    assert r.headers["cache-control"] == "no-store"


def test_calculate_rejects_float_and_extra_fields(ctx):
    c, _ = ctx
    assert c.post("/v1/calculate", json={**CALC, "purchase_price": 500000.5}, headers=buyer()).status_code == 422
    assert c.post("/v1/calculate", json={**CALC, "admin": True}, headers=buyer()).status_code == 422
    r = c.post("/v1/calculate", json={**CALC, "loan_amount": "600000"}, headers=buyer())
    assert r.status_code == 422 and r.json()["error"] == "INVALID_INPUT"


def test_vet_merges_flags(ctx):
    c, _ = ctx
    body = {"facts": {"payments": [{"amount": "5000", "method": "CASH_BY_HAND"}]},
            "purchase": {**CALC, "purchase_price": "400000", "loan_amount": "0"}}
    r = c.post("/v1/vet", json=body, headers=SVC_H).json()
    codes = {f["code"] for f in r["flags"]}
    assert {"CASH_BY_HAND", "NO_OFFICIAL_SEARCH", "UNDER_DECLARATION_RISK"} <= codes and r["blocking"]


def test_interpret_and_directory(ctx):
    c, _ = ctx
    r = c.post("/v1/interpret/title-search", json={"text": "Gadaian kepada BANK. Pajakan 99 tahun"}, headers=buyer())
    assert r.json()["facts"]["has_existing_charge"] is True
    d = c.get("/v1/directory?state=SELANGOR", headers=buyer()).json()
    assert d["entries"][0]["freshness_status"] == "UNVERIFIED"
    assert c.get("/v1/directory?state=sel'--", headers=buyer()).status_code == 422


def test_end_to_end_gate_cycle_notifies_n8n(ctx):
    c, calls = ctx
    t = c.post("/v1/transactions", json={"title": "Lot 12 Kajang"}, headers=buyer()).json()
    # buyers cannot open gates; automation cannot decide
    assert c.post(f"/v1/transactions/{t['id']}/gate", json={"gate": t["stage"]}, headers=buyer()).status_code == 403
    g = c.post(f"/v1/transactions/{t['id']}/gate", headers=SVC_H, json={
        "gate": "HITL_1_LISTING_VETTING", "summary": {"headline": "ok"},
        "flags": [{"code": "EXISTING_CHARGE", "severity": "WARN"}],
        "resume_url": f"{N8N}/webhook-waiting/123"}).json()
    assert g["status"] == "PAUSED_FOR_HITL" and "resume_url" not in g
    dec = {"gate": "HITL_1_LISTING_VETTING", "decision": "APPROVED", "acknowledged_flags": ["EXISTING_CHARGE"],
           "idempotency_key": uuid.uuid4().hex, "expected_version": g["version"]}
    assert c.post(f"/v1/transactions/{t['id']}/decisions", json=dec, headers=SVC_H).status_code == 403
    assert c.post(f"/v1/transactions/{t['id']}/decisions", json=dec, headers=buyer("intruder")).status_code == 404
    r = c.post(f"/v1/transactions/{t['id']}/decisions", json=dec, headers=buyer())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["workflow_notified"] and body["transaction"]["stage"] == "HITL_2_OFFER_BUDGET"
    assert len(calls) == 1 and calls[0].headers["X-Copilot-Resume-Token"] == "r" * 40
    # idempotent replay: no second n8n call
    again = c.post(f"/v1/transactions/{t['id']}/decisions", json=dec, headers=buyer()).json()
    assert again["idempotent_replay"] and len(calls) == 1
    full = c.get(f"/v1/transactions/{t['id']}", headers=buyer()).json()
    assert full["audit_chain_valid"] and len(full["approvals"]) == 1


def test_ssrf_guard_on_resume_url(ctx):
    c, _ = ctx
    t = c.post("/v1/transactions", json={"title": "Lot 12 Kajang"}, headers=buyer()).json()
    for bad in ["http://169.254.169.254/latest/meta-data", f"{N8N}.evil.com/x", "file:///etc/passwd"]:
        r = c.post(f"/v1/transactions/{t['id']}/gate", headers=SVC_H,
                   json={"gate": "HITL_1_LISTING_VETTING", "resume_url": bad})
        assert r.status_code == 422, bad


def test_payload_limit_and_rate_limit():
    s = Settings(env="test", service_token=SVC, buyer_proxy_token=BUY, n8n_base_url=N8N,
                 n8n_resume_header_value="", database_url=None, rate_limit_per_min=3)
    c = TestClient(create_app(s, MemoryRepository()))
    big = c.post("/v1/interpret/explain", content=b"x" * 300_000,
                 headers={**buyer(), "content-type": "application/json"})
    assert big.status_code == 413
    codes = [c.get("/healthz").status_code for _ in range(4)]
    assert codes[-1] == 429


def test_settings_fail_closed(monkeypatch):
    monkeypatch.setenv("COPILOT_ENV", "production")
    monkeypatch.setenv("ENGINE_SERVICE_TOKEN", "short")
    with pytest.raises(RuntimeError):
        Settings.from_env()
    monkeypatch.setenv("ENGINE_SERVICE_TOKEN", "x" * 40)
    monkeypatch.setenv("ENGINE_BUYER_PROXY_TOKEN", "x" * 40)
    monkeypatch.setenv("N8N_RESUME_TOKEN", "y" * 40)
    with pytest.raises(RuntimeError, match="differ"):
        Settings.from_env()
