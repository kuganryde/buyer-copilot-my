"""Persistence: in-memory (tests/local demo) and PostgreSQL (production).

The Postgres implementation treats the database as the final authority: the
approval hash chain, sequence numbers and stage-advance rules are recomputed by
triggers (schema.sql), and Row-Level Security scopes every query to the buyer
set via `SET LOCAL app.buyer_id`.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from typing import Any, Protocol

from .state_machine import (
    ApprovalRecord,
    Decision,
    Gate,
    Status,
    Transaction,
    TransitionError,
    decide,
)


class Repository(Protocol):
    def create(self, txn: Transaction) -> Transaction: ...
    def get(self, txn_id: str, buyer_id: str | None) -> Transaction | None: ...
    def save(self, txn: Transaction, expected_version: int) -> Transaction: ...
    def approvals(self, txn_id: str, buyer_id: str | None) -> list[ApprovalRecord]: ...
    def apply_decision(self, txn_id: str, buyer_id: str, **kw: Any) -> tuple[Transaction, ApprovalRecord, bool, str | None]: ...
    def list_directory(self, category: str | None, state: str | None) -> list[dict[str, Any]]: ...


class MemoryRepository:
    def __init__(self, directory: list[dict[str, Any]] | None = None):
        self._txns: dict[str, Transaction] = {}
        self._approvals: dict[str, list[ApprovalRecord]] = {}
        self._idem: dict[str, ApprovalRecord] = {}
        self._lock = threading.RLock()
        self._directory = directory or []

    def create(self, txn: Transaction) -> Transaction:
        with self._lock:
            self._txns[txn.id] = txn
            self._approvals[txn.id] = []
            return txn

    def get(self, txn_id: str, buyer_id: str | None) -> Transaction | None:
        t = self._txns.get(txn_id)
        if t and buyer_id is not None and t.buyer_id != buyer_id:
            return None  # same response as "not found" — no ID enumeration oracle
        return t

    def save(self, txn: Transaction, expected_version: int) -> Transaction:
        with self._lock:
            cur = self._txns.get(txn.id)
            if cur is None or cur.version != expected_version:
                raise TransitionError("STALE_VERSION", "Concurrent update detected; retry")
            self._txns[txn.id] = txn
            return txn

    def approvals(self, txn_id: str, buyer_id: str | None) -> list[ApprovalRecord]:
        if self.get(txn_id, buyer_id) is None:
            return []
        return list(self._approvals.get(txn_id, []))

    def apply_decision(self, txn_id: str, buyer_id: str, **kw: Any) -> tuple[Transaction, ApprovalRecord, bool, str | None]:
        with self._lock:
            existing = self._idem.get(kw["idempotency_key"])
            txn = self.get(txn_id, buyer_id)
            if txn is None:
                raise TransitionError("NOT_FOUND", "Transaction not found")
            if existing:
                if existing.transaction_id != txn_id:
                    raise TransitionError("IDEMPOTENCY_CONFLICT", "Idempotency key already used")
                return txn, existing, True, None
            chain = self._approvals[txn_id]
            resume_url = txn.resume_url
            new, rec = decide(txn, actor_id=buyer_id, prev_record=chain[-1] if chain else None, **kw)
            self.save(new, txn.version)
            chain.append(rec)
            self._idem[rec.idempotency_key] = rec
            return new, rec, False, resume_url

    def list_directory(self, category: str | None, state: str | None) -> list[dict[str, Any]]:
        rows = [r for r in self._directory if r.get("is_active", True)]
        if category:
            rows = [r for r in rows if r["category"] == category]
        if state:
            rows = [r for r in rows if r["jurisdiction_state"] in (state, "NATIONAL")]
        return rows


_TS = "to_char({c} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"')"
_TXN_COLS = (f"id::text, buyer_id, title, stage::text, status::text, version, gate_summary, flags, resume_url, "
             f"{_TS.format(c='created_at')}, {_TS.format(c='updated_at')}")
_APR_COLS = (f"id::text, transaction_id::text, seq, gate::text, decision::text, actor_id, comment, "
             f"acknowledged_flags, idempotency_key, {_TS.format(c='created_at')}, prev_hash, row_hash")


def _row_txn(r: tuple[Any, ...]) -> Transaction:
    return Transaction(id=r[0], buyer_id=r[1], title=r[2], stage=Gate(r[3]), status=Status(r[4]),
                       version=r[5], gate_summary=r[6] or {}, flags=r[7] or [], resume_url=r[8],
                       created_at=r[9], updated_at=r[10])


def _row_apr(r: tuple[Any, ...]) -> ApprovalRecord:
    return ApprovalRecord(id=r[0], transaction_id=r[1], seq=r[2], gate=Gate(r[3]), decision=Decision(r[4]),
                          actor_id=r[5], comment=r[6], acknowledged_flags=tuple(r[7] or ()),
                          idempotency_key=r[8], created_at=r[9], prev_hash=r[10], row_hash=r[11])


class PostgresRepository:
    def __init__(self, dsn: str, pool_size: int = 5):
        from psycopg_pool import ConnectionPool  # imported lazily: optional dependency

        # Short statement timeout guards the API against slow-query resource exhaustion.
        self.pool = ConnectionPool(dsn, min_size=1, max_size=pool_size, open=True,
                                   kwargs={"options": "-c statement_timeout=5000"})

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def _tx(self, buyer_id: str | None) -> Iterator[Any]:
        with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
            # set_config(..., true) == SET LOCAL: scoped to this DB transaction only,
            # so a pooled connection can never leak one buyer's identity to another.
            if buyer_id is None:
                cur.execute("SELECT set_config('app.actor_role', 'automation', true)")
            else:
                cur.execute("SELECT set_config('app.buyer_id', %s, true)", (buyer_id,))
            yield cur

    def create(self, txn: Transaction) -> Transaction:
        with self._tx(txn.buyer_id) as cur:
            cur.execute(
                f"INSERT INTO transactions (id, buyer_id, title, stage, status) VALUES (%s,%s,%s,%s,%s) "
                f"RETURNING {_TXN_COLS}",
                (txn.id, txn.buyer_id, txn.title, txn.stage.value, txn.status.value))
            return _row_txn(cur.fetchone())

    def get(self, txn_id: str, buyer_id: str | None) -> Transaction | None:
        with self._tx(buyer_id) as cur:
            cur.execute(f"SELECT {_TXN_COLS} FROM transactions WHERE id = %s", (txn_id,))
            r = cur.fetchone()
            return _row_txn(r) if r else None

    def save(self, txn: Transaction, expected_version: int) -> Transaction:
        with self._tx(None) as cur:
            return self._save(cur, txn, expected_version)

    def _save(self, cur: Any, txn: Transaction, expected_version: int) -> Transaction:
        cur.execute(
            f"UPDATE transactions SET stage=%s, status=%s, version=%s, gate_summary=%s, flags=%s, "
            f"resume_url=%s, updated_at=now() WHERE id=%s AND version=%s RETURNING {_TXN_COLS}",
            (txn.stage.value, txn.status.value, txn.version, json.dumps(txn.gate_summary),
             json.dumps(txn.flags), txn.resume_url, txn.id, expected_version))
        r = cur.fetchone()
        if r is None:
            raise TransitionError("STALE_VERSION", "Concurrent update detected; retry")
        return _row_txn(r)

    def approvals(self, txn_id: str, buyer_id: str | None) -> list[ApprovalRecord]:
        with self._tx(buyer_id) as cur:
            cur.execute(f"SELECT {_APR_COLS} FROM hitl_approvals WHERE transaction_id=%s ORDER BY seq", (txn_id,))
            return [_row_apr(r) for r in cur.fetchall()]

    def apply_decision(self, txn_id: str, buyer_id: str, **kw: Any) -> tuple[Transaction, ApprovalRecord, bool, str | None]:
        with self._tx(buyer_id) as cur:
            cur.execute(f"SELECT {_APR_COLS} FROM hitl_approvals WHERE idempotency_key=%s", (kw["idempotency_key"],))
            dup = cur.fetchone()
            cur.execute(f"SELECT {_TXN_COLS} FROM transactions WHERE id=%s FOR UPDATE", (txn_id,))
            r = cur.fetchone()
            if r is None:
                raise TransitionError("NOT_FOUND", "Transaction not found")
            txn = _row_txn(r)
            if dup:
                rec = _row_apr(dup)
                if rec.transaction_id != txn_id:
                    raise TransitionError("IDEMPOTENCY_CONFLICT", "Idempotency key already used")
                return txn, rec, True, None
            cur.execute(f"SELECT {_APR_COLS} FROM hitl_approvals WHERE transaction_id=%s ORDER BY seq DESC LIMIT 1",
                        (txn_id,))
            last = cur.fetchone()
            new, _ = decide(txn, actor_id=buyer_id, prev_record=_row_apr(last) if last else None, **kw)
            # DB trigger recomputes seq/prev_hash/row_hash — Python values are not trusted.
            cur.execute(
                f"INSERT INTO hitl_approvals (transaction_id, gate, decision, actor_id, comment, "
                f"acknowledged_flags, idempotency_key) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING {_APR_COLS}",
                (txn_id, kw["gate"].value, kw["decision"].value, buyer_id, kw["comment"].strip()[:2000],
                 sorted(set(kw["acknowledged_flags"])), kw["idempotency_key"]))
            rec = _row_apr(cur.fetchone())
            saved = self._save(cur, replace(new), txn.version)
            return saved, rec, False, txn.resume_url

    def list_directory(self, category: str | None, state: str | None) -> list[dict[str, Any]]:
        sql = ("SELECT id::text, agency_name, category, jurisdiction_state, official_url, contact_details, "
               "summary_rule, last_verified_date::text, is_active, is_proposed_pending_gazette, "
               "freshness_status FROM directory_entries_v WHERE is_active")
        params: list[Any] = []
        if category:
            sql += " AND category = %s"
            params.append(category)
        if state:
            sql += " AND jurisdiction_state IN (%s, 'NATIONAL')"
            params.append(state)
        sql += " ORDER BY category, jurisdiction_state, agency_name LIMIT 500"
        with self._tx(None) as cur:
            cur.execute(sql, params)
            cols = [d.name for d in cur.description]
            return [dict(zip(cols, row, strict=False)) for row in cur.fetchall()]
