"""FastAPI service: the single authority for money maths, guardrails and HITL decisions.

Trust boundaries:
  * Browser  -> Next.js server proxy (holds ENGINE_BUYER_PROXY_TOKEN, asserts X-Buyer-Id
                from the verified session) -> this API.
  * n8n      -> this API with ENGINE_SERVICE_TOKEN (automation role, cannot decide gates).
  * this API -> n8n Wait-node resume URL (only URLs under N8N_BASE_URL; header-auth secret).
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from . import calculator as calc
from . import guardrails as gr
from . import interpreter as interp
from .repository import MemoryRepository, PostgresRepository, Repository
from .rules import ACTIVE_RULESET
from .state_machine import (
    Decision,
    Gate,
    TransitionError,
    new_transaction,
    pause_for_gate,
    verify_chain,
)

log = logging.getLogger("copilot")

Money = Annotated[str, StringConstraints(pattern=r"^\d{1,10}(\.\d{1,2})?$")]
Rate = Annotated[str, StringConstraints(pattern=r"^(0(\.\d{1,4})?|1(\.0{1,4})?)$")]
BUYER_ID_RE = re.compile(r"^[A-Za-z0-9_\-@.]{3,64}$")
MAX_BODY_BYTES = 256 * 1024


# ----------------------------------------------------------------- settings


@dataclass(frozen=True)
class Settings:
    env: str
    service_token: str
    buyer_proxy_token: str
    n8n_base_url: str
    n8n_resume_header_value: str
    database_url: str | None
    rate_limit_per_min: int

    @classmethod
    def from_env(cls) -> Settings:
        s = cls(
            env=os.getenv("COPILOT_ENV", "production"),
            service_token=os.getenv("ENGINE_SERVICE_TOKEN", ""),
            buyer_proxy_token=os.getenv("ENGINE_BUYER_PROXY_TOKEN", ""),
            n8n_base_url=os.getenv("N8N_BASE_URL", "http://n8n:5678").rstrip("/"),
            n8n_resume_header_value=os.getenv("N8N_RESUME_TOKEN", ""),
            database_url=os.getenv("DATABASE_URL") or None,
            rate_limit_per_min=int(os.getenv("RATE_LIMIT_PER_MIN", "120")),
        )
        s.validate()
        return s

    def validate(self) -> None:
        # Fail closed: never boot a non-test service with missing/weak secrets.
        if self.env == "test":
            return
        for name, val in (("ENGINE_SERVICE_TOKEN", self.service_token),
                          ("ENGINE_BUYER_PROXY_TOKEN", self.buyer_proxy_token),
                          ("N8N_RESUME_TOKEN", self.n8n_resume_header_value)):
            if len(val) < 32:
                raise RuntimeError(f"{name} must be set to a random value of at least 32 chars")
        if self.service_token == self.buyer_proxy_token:
            raise RuntimeError("Service and buyer tokens must differ (role separation)")


# ----------------------------------------------------------------- auth


@dataclass(frozen=True)
class Principal:
    role: Literal["automation", "buyer"]
    buyer_id: str | None


def _auth_dep(settings: Settings):
    def dep(authorization: str = Header(default=""), x_buyer_id: str = Header(default="")) -> Principal:
        token = authorization.removeprefix("Bearer ").strip()
        # compare_digest: constant-time, avoids token-guessing via timing side channel
        if settings.service_token and hmac.compare_digest(token, settings.service_token):
            return Principal("automation", None)
        if settings.buyer_proxy_token and hmac.compare_digest(token, settings.buyer_proxy_token):
            if not BUYER_ID_RE.match(x_buyer_id):
                raise HTTPException(401, "missing or invalid buyer identity")
            return Principal("buyer", x_buyer_id)
        raise HTTPException(401, "unauthorized")
    return dep


# ----------------------------------------------------------------- schemas


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=4000)


class CalcIn(Strict):
    purchase_price: Money
    market_value: Money | None = None
    loan_amount: Money = "0"
    property_type: calc.PropertyType
    buyer_status: calc.BuyerStatus
    spa_date: date
    first_time_buyer: bool = False
    never_owned_residential: bool = False
    requires_state_consent: bool = False
    include_survey: bool = False
    deposit_rate: Rate | None = None
    budget2027_mode: calc.Budget2027Mode = calc.Budget2027Mode.GAZETTED_ONLY
    estimate_overrides: dict[str, Money] = Field(default_factory=dict, max_length=10)

    def to_domain(self) -> calc.PurchaseInput:
        return calc.PurchaseInput(
            purchase_price=Decimal(self.purchase_price),
            market_value=Decimal(self.market_value) if self.market_value else None,
            loan_amount=Decimal(self.loan_amount), property_type=self.property_type,
            buyer_status=self.buyer_status, spa_date=self.spa_date,
            first_time_buyer=self.first_time_buyer, never_owned_residential=self.never_owned_residential,
            requires_state_consent=self.requires_state_consent, include_survey=self.include_survey,
            deposit_rate=Decimal(self.deposit_rate) if self.deposit_rate else None,
            budget2027_mode=self.budget2027_mode,
            estimate_overrides={k: Decimal(v) for k, v in self.estimate_overrides.items()},
        )


class PaymentIn(Strict):
    amount: Money
    method: gr.PaymentMethod
    has_written_receipt: bool = False
    has_written_terms: bool = False
    stakeholder_held: bool = False


class FactsIn(Strict):
    property_type: calc.PropertyType = calc.PropertyType.RESIDENTIAL_HOUSE
    official_title_search_done: bool = False
    title_search_date: date | None = None
    registered_owner_matches_seller: bool | None = None
    has_existing_charge: bool | None = None
    has_private_caveat: bool | None = None
    has_registrar_caveat: bool | None = None
    has_restriction_in_interest: bool | None = None
    restriction_text: str = Field(default="", max_length=500)
    is_malay_reserve: bool | None = None
    buyer_is_malay_as_defined: bool | None = None
    is_bumiputera_lot: bool | None = None
    tenure: gr.Tenure = gr.Tenure.UNKNOWN
    lease_expiry: date | None = None
    land_use_category: str | None = Field(default=None, max_length=40)
    intended_use: str | None = Field(default=None, max_length=40)
    has_legal_road_access: bool | None = None
    boundary_confirmed: bool | None = None
    has_unapproved_renovation: bool | None = None
    quit_rent_assessment_arrears: bool | None = None
    declared_price: Money | None = None
    market_value: Money | None = None
    payments: list[PaymentIn] = Field(default_factory=list, max_length=20)

    def to_domain(self) -> gr.ListingFacts:
        d = self.model_dump(exclude={"payments", "declared_price", "market_value", "property_type"})
        return gr.ListingFacts(
            **d, property_type=self.property_type.value,
            declared_price=Decimal(self.declared_price) if self.declared_price else None,
            market_value=Decimal(self.market_value) if self.market_value else None,
            payments=[gr.PaymentIntent(Decimal(p.amount), p.method, p.has_written_receipt,
                                       p.has_written_terms, p.stakeholder_held) for p in self.payments],
        )


class VetIn(Strict):
    facts: FactsIn
    purchase: CalcIn


class TextIn(Strict):
    model_config = ConfigDict(extra="forbid", str_max_length=interp.MAX_DOC_CHARS)
    text: str = Field(min_length=1, max_length=interp.MAX_DOC_CHARS)


class TxnIn(Strict):
    title: str = Field(min_length=3, max_length=200)


class GateIn(Strict):
    gate: Gate
    summary: dict[str, Any] = Field(default_factory=dict)
    flags: list[dict[str, str]] = Field(default_factory=list, max_length=100)
    resume_url: str | None = Field(default=None, max_length=1000)


class DecisionIn(Strict):
    gate: Gate
    decision: Decision
    comment: str = Field(default="", max_length=2000)
    acknowledged_flags: list[str] = Field(default_factory=list, max_length=100)
    idempotency_key: str = Field(min_length=16, max_length=80, pattern=r"^[A-Za-z0-9\-_]+$")
    expected_version: int = Field(ge=1)


# ----------------------------------------------------------------- app


def _load_directory_seed() -> list[dict[str, Any]]:
    p = Path(__file__).resolve().parents[2] / "db" / "directory_seed.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


def _freshness(entry: dict[str, Any], today: date) -> str:
    if not entry.get("is_active", True):
        return "INACTIVE"
    if entry.get("is_proposed_pending_gazette"):
        return "PROPOSED_PENDING_GAZETTE"
    lv = entry.get("last_verified_date")
    if not lv:
        return "UNVERIFIED"
    return "STALE" if (today - date.fromisoformat(lv)).days > 90 else "VERIFIED"


def create_app(settings: Settings | None = None, repo: Repository | None = None,
               http_client: httpx.Client | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    if repo is None:
        repo = PostgresRepository(settings.database_url) if settings.database_url else \
            MemoryRepository(_load_directory_seed())
    http = http_client or httpx.Client(timeout=httpx.Timeout(5.0), follow_redirects=False)

    app = FastAPI(title="MY Buyer Co-Pilot Engine", version=ACTIVE_RULESET.version,
                  docs_url=None if settings.env == "production" else "/docs", redoc_url=None)
    auth = _auth_dep(settings)
    buckets: dict[str, list[float]] = defaultdict(list)

    @app.middleware("http")
    async def guard(request: Request, call_next):  # type: ignore[no-untyped-def]
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = time.monotonic()
        cl = request.headers.get("content-length")
        if cl and (not cl.isdigit() or int(cl) > MAX_BODY_BYTES):
            return JSONResponse({"error": "payload_too_large"}, status_code=413)
        # Per-client fixed-window limiter (defence in depth; put a gateway/WAF in front in prod).
        key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window = [t for t in buckets[key] if now - t < 60]
        if len(window) >= settings.rate_limit_per_min:
            return JSONResponse({"error": "rate_limited"}, status_code=429, headers={"Retry-After": "60"})
        window.append(now)
        buckets[key] = window
        resp = await call_next(request)
        resp.headers["X-Request-Id"] = rid
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Cache-Control"] = "no-store"  # financial/PII data must not be cached
        resp.headers["Referrer-Policy"] = "no-referrer"
        # Structured log line: no bodies, no tokens, no buyer PII.
        log.info(json.dumps({"rid": rid, "method": request.method, "path": request.url.path,
                             "status": resp.status_code, "ms": round((time.monotonic() - start) * 1000, 1)}))
        return resp

    @app.exception_handler(TransitionError)
    async def _te(_: Request, exc: TransitionError) -> JSONResponse:
        status = {"NOT_FOUND": 404, "FORBIDDEN": 403}.get(exc.code, 409)
        return JSONResponse({"error": exc.code, "message": str(exc)}, status_code=status)

    @app.exception_handler(calc.CalculationError)
    async def _ce(_: Request, exc: calc.CalculationError) -> JSONResponse:
        return JSONResponse({"error": "INVALID_INPUT", "message": str(exc)}, status_code=422)

    def require_buyer(p: Principal) -> str:
        if p.role != "buyer" or not p.buyer_id:
            raise HTTPException(403, "buyer role required")
        return p.buyer_id

    def require_automation(p: Principal) -> None:
        if p.role != "automation":
            raise HTTPException(403, "automation role required")

    # ------------------------------------------------------------- routes

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "ruleset": ACTIVE_RULESET.version}

    @app.get("/v1/rules")
    def rules(_: Principal = Depends(auth)) -> dict[str, Any]:
        rs = ACTIVE_RULESET
        metas = [rs.mot_meta, rs.noncitizen_residential_meta, rs.noncitizen_nonresidential_meta, rs.loan_meta,
                 rs.ftb_meta, rs.b2027_meta, rs.sro_meta, rs.sst_meta, rs.rpgt_meta, rs.estimates_meta]
        return {"version": rs.version, "rules": [
            {**m.__dict__, "status": m.status.value,
             "effective_from": m.effective_from.isoformat() if m.effective_from else None,
             "effective_to": m.effective_to.isoformat() if m.effective_to else None,
             "last_reviewed": m.last_reviewed.isoformat()} for m in metas if m]}

    @app.post("/v1/calculate")
    def calculate(body: CalcIn, _: Principal = Depends(auth)) -> dict[str, Any]:
        return calc.calculate(body.to_domain()).to_dict()

    @app.post("/v1/guardrails/evaluate")
    def evaluate(body: FactsIn, _: Principal = Depends(auth)) -> dict[str, Any]:
        flags = gr.evaluate(body.to_domain())
        return {"flags": [f.to_dict() for f in flags], "blocking": gr.has_blocking(flags)}

    @app.post("/v1/vet")
    def vet(body: VetIn, _: Principal = Depends(auth)) -> dict[str, Any]:
        """Combined intake used by n8n: guardrails + cost, merged & de-duplicated flags."""
        flags = [f.to_dict() for f in gr.evaluate(body.facts.to_domain())]
        cost = calc.calculate(body.purchase.to_domain()).to_dict()
        seen = {f["code"] for f in flags}
        flags += [{"code": f["code"], "severity": f["severity"], "title_en": f["title_en"], "title_ms": f["title_ms"],
                   "message": f["message"], "next_step": ""} for f in cost["flags"] if f["code"] not in seen]
        return {"flags": flags, "blocking": any(f["severity"] == "BLOCK" for f in flags), "cost": cost,
                "disclaimer": interp.DISCLAIMER}

    @app.post("/v1/interpret/title-search")
    def interpret_title(body: TextIn, _: Principal = Depends(auth)) -> dict[str, Any]:
        return interp.parse_title_search(body.text)

    @app.post("/v1/interpret/explain")
    def interpret_explain(body: TextIn, _: Principal = Depends(auth)) -> dict[str, Any]:
        return interp.explain(body.text[:2000])

    @app.get("/v1/directory")
    def directory(category: str | None = None, state: str | None = None,
                  _: Principal = Depends(auth)) -> dict[str, Any]:
        if category and not re.fullmatch(r"[A-Z_]{2,40}", category):
            raise HTTPException(422, "invalid category")
        if state and not re.fullmatch(r"[A-Z_]{2,40}", state):
            raise HTTPException(422, "invalid state")
        today = date.today()
        rows = repo.list_directory(category, state)
        for r in rows:
            r.setdefault("freshness_status", _freshness(r, today))
        return {"entries": rows, "as_of": today.isoformat()}

    @app.post("/v1/transactions", status_code=201)
    def create_txn(body: TxnIn, p: Principal = Depends(auth)) -> dict[str, Any]:
        buyer = require_buyer(p)
        return repo.create(new_transaction(buyer, body.title)).to_dict()

    @app.get("/v1/transactions/{txn_id}")
    def get_txn(txn_id: uuid.UUID, p: Principal = Depends(auth)) -> dict[str, Any]:
        buyer = p.buyer_id if p.role == "buyer" else None
        t = repo.get(str(txn_id), buyer)
        if t is None:
            raise HTTPException(404, "not found")
        recs = repo.approvals(str(txn_id), buyer)
        return {"transaction": t.to_dict(), "approvals": [r.to_dict() for r in recs],
                "audit_chain_valid": verify_chain(recs)}

    @app.post("/v1/transactions/{txn_id}/gate")
    def open_gate(txn_id: uuid.UUID, body: GateIn, p: Principal = Depends(auth)) -> dict[str, Any]:
        require_automation(p)
        if body.resume_url and not body.resume_url.startswith(settings.n8n_base_url + "/"):
            # SSRF guard: we will later POST to this URL, so it must point at our n8n only.
            raise HTTPException(422, "resume_url must be under N8N_BASE_URL")
        t = repo.get(str(txn_id), None)
        if t is None:
            raise HTTPException(404, "not found")
        paused = pause_for_gate(t, body.gate, body.summary, body.flags, body.resume_url)
        return repo.save(paused, t.version).to_dict()

    @app.post("/v1/transactions/{txn_id}/decisions")
    def decide_gate(txn_id: uuid.UUID, body: DecisionIn, p: Principal = Depends(auth)) -> dict[str, Any]:
        buyer = require_buyer(p)
        txn, rec, replay, resume_url = repo.apply_decision(
            str(txn_id), buyer, gate=body.gate, decision=body.decision, comment=body.comment,
            acknowledged_flags=body.acknowledged_flags, idempotency_key=body.idempotency_key,
            expected_version=body.expected_version)
        notified = False
        if resume_url and not replay and resume_url.startswith(settings.n8n_base_url + "/"):
            payload = {"transaction_id": str(txn_id), "approval_id": rec.id, "gate": rec.gate.value,
                       "decision": rec.decision.value, "row_hash": rec.row_hash}
            for attempt in range(3):  # bounded retry with backoff; DB already holds the decision
                try:
                    r = http.post(resume_url, json=payload,
                                  headers={"X-Copilot-Resume-Token": settings.n8n_resume_header_value})
                    if r.status_code < 300:
                        notified = True
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.2 * (2 ** attempt))
            if not notified:
                log.warning(json.dumps({"event": "n8n_resume_failed", "txn": str(txn_id), "approval": rec.id}))
        return {"transaction": txn.to_dict(), "approval": rec.to_dict(), "idempotent_replay": replay,
                "workflow_notified": notified}

    return app


def app_factory() -> FastAPI:  # uvicorn --factory copilot_engine.api:app_factory
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return create_app()
