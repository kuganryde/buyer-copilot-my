"""Transaction state machine with mandatory Human-in-the-Loop gates.

Invariants (mirrored by DB triggers in schema.sql so a compromised worker cannot
bypass them):
  1. A gate can only be decided while the transaction is PAUSED_FOR_HITL at that gate.
  2. APPROVED is impossible while any BLOCK flag is open; every WARN flag must be
     explicitly acknowledged by the human.
  3. Stages only move forward one step, and only after an APPROVED record exists.
  4. Approval records are append-only and SHA-256 hash-chained (tamper evident).
  5. Decisions are idempotent by `idempotency_key`; stale decisions (wrong gate /
     wrong version) are rejected rather than silently applied.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from enum import Enum
from typing import Any


class Gate(str, Enum):
    HITL_1_LISTING_VETTING = "HITL_1_LISTING_VETTING"
    HITL_2_OFFER_BUDGET = "HITL_2_OFFER_BUDGET"
    HITL_3_LAWYER_DEPOSIT = "HITL_3_LAWYER_DEPOSIT"
    HITL_4_SPA_LOAN_DUTY = "HITL_4_SPA_LOAN_DUTY"
    HITL_5_TRANSFER_HANDOVER = "HITL_5_TRANSFER_HANDOVER"


GATE_ORDER: tuple[Gate, ...] = tuple(Gate)

GATE_DESCRIPTIONS: dict[Gate, dict[str, str]] = {
    Gate.HITL_1_LISTING_VETTING: {
        "en": "Review listing & title facts, red flags and estimated upfront cash before ordering a formal title search and site checks.",
        "ms": "Semak fakta iklan & hakmilik, amaran risiko dan anggaran wang pendahuluan sebelum membuat carian rasmi dan lawatan tapak.",
    },
    Gate.HITL_2_OFFER_BUDGET: {
        "en": "Review title/site/valuation findings; approve target offer, cash-vs-loan split and maximum cash buffer.",
        "ms": "Semak dapatan hakmilik/tapak/penilaian; luluskan harga tawaran, pecahan tunai-pinjaman dan had penampan tunai.",
    },
    Gate.HITL_3_LAWYER_DEPOSIT: {
        "en": "Choose your conveyancing lawyer; approve stakeholder deposit terms and written-receipt requirements.",
        "ms": "Pilih peguam hartanah; luluskan terma deposit pemegang amanah dan keperluan resit bertulis.",
    },
    Gate.HITL_4_SPA_LOAN_DUTY: {
        "en": "Review the SPA, loan/redemption, state consent and stamp duty with your lawyer before signing or releasing funds.",
        "ms": "Semak Perjanjian Jual Beli, pinjaman/penebusan, kebenaran negeri dan duti setem bersama peguam sebelum menandatangani atau melepaskan dana.",
    },
    Gate.HITL_5_TRANSFER_HANDOVER: {
        "en": "Verify transfer registration (Borang 14A), vacant possession checklist and apportionments, then archive.",
        "ms": "Sahkan pendaftaran pindah milik (Borang 14A), senarai semak milikan kosong dan pembahagian bayaran, kemudian arkibkan.",
    },
}


class Status(str, Enum):
    PAUSED_FOR_HITL = "PAUSED_FOR_HITL"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    HALTED = "HALTED"


class Decision(str, Enum):
    APPROVED = "APPROVED"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    REJECTED = "REJECTED"


class TransitionError(Exception):
    """Business-rule violation. `code` is stable for clients; message is user-safe."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


GENESIS_HASH = "0" * 64


@dataclass(frozen=True)
class Transaction:
    id: str
    buyer_id: str
    title: str
    stage: Gate
    status: Status
    version: int = 1
    gate_summary: dict[str, Any] = field(default_factory=dict)
    flags: list[dict[str, str]] = field(default_factory=list)
    resume_url: str | None = None
    created_at: str = field(default_factory=lambda: _now())
    updated_at: str = field(default_factory=lambda: _now())

    def to_dict(self) -> dict[str, Any]:
        d = self.__dict__.copy()
        d["stage"] = self.stage.value
        d["status"] = self.status.value
        d.pop("resume_url")  # internal — never exposed to buyers (it is a capability URL)
        d["gate_description"] = GATE_DESCRIPTIONS[self.stage]
        d["gate_index"] = GATE_ORDER.index(self.stage) + 1
        d["gate_total"] = len(GATE_ORDER)
        return d


@dataclass(frozen=True)
class ApprovalRecord:
    id: str
    transaction_id: str
    seq: int
    gate: Gate
    decision: Decision
    actor_id: str
    comment: str
    acknowledged_flags: tuple[str, ...]
    idempotency_key: str
    created_at: str
    prev_hash: str
    row_hash: str

    def to_dict(self) -> dict[str, Any]:
        d = self.__dict__.copy()
        d["gate"] = self.gate.value
        d["decision"] = self.decision.value
        d["acknowledged_flags"] = list(self.acknowledged_flags)
        return d


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def compute_hash(prev_hash: str, txn_id: str, seq: int, gate: str, decision: str, actor: str,
                 comment: str, acks: tuple[str, ...], idem: str, created_at: str) -> str:
    # Length-prefixed fields: prevents ambiguity attacks where "a|b"+"c" == "a"+"b|c".
    parts = [prev_hash, txn_id, str(seq), gate, decision, actor, comment, ",".join(sorted(acks)), idem, created_at]
    canonical = "".join(f"{len(p)}:{p};" for p in parts)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def verify_chain(records: list[ApprovalRecord]) -> bool:
    prev = GENESIS_HASH
    for i, r in enumerate(sorted(records, key=lambda x: x.seq), start=1):
        if r.seq != i or r.prev_hash != prev:
            return False
        expect = compute_hash(r.prev_hash, r.transaction_id, r.seq, r.gate.value, r.decision.value,
                              r.actor_id, r.comment, r.acknowledged_flags, r.idempotency_key, r.created_at)
        if expect != r.row_hash:
            return False
        prev = r.row_hash
    return True


def new_transaction(buyer_id: str, title: str) -> Transaction:
    return Transaction(id=str(uuid.uuid4()), buyer_id=buyer_id, title=title[:200],
                       stage=Gate.HITL_1_LISTING_VETTING, status=Status.IN_PROGRESS)


def pause_for_gate(txn: Transaction, gate: Gate, summary: dict[str, Any],
                   flags: list[dict[str, str]], resume_url: str | None) -> Transaction:
    """Called by automation once the work preceding a gate is done."""
    if txn.status is not Status.IN_PROGRESS:
        raise TransitionError("NOT_IN_PROGRESS", f"Cannot pause: transaction is {txn.status.value}")
    if gate is not txn.stage:
        raise TransitionError("GATE_MISMATCH", f"Transaction is at {txn.stage.value}, not {gate.value}")
    return replace(txn, status=Status.PAUSED_FOR_HITL, gate_summary=summary, flags=flags,
                   resume_url=resume_url, version=txn.version + 1, updated_at=_now())


def decide(txn: Transaction, *, gate: Gate, decision: Decision, actor_id: str, comment: str,
           acknowledged_flags: list[str], idempotency_key: str, expected_version: int,
           prev_record: ApprovalRecord | None) -> tuple[Transaction, ApprovalRecord]:
    if actor_id != txn.buyer_id:
        # Only the buyer who owns the transaction may decide (least privilege).
        raise TransitionError("FORBIDDEN", "Only the transaction owner can decide this gate")
    if txn.status is not Status.PAUSED_FOR_HITL:
        raise TransitionError("NOT_PAUSED", f"No decision pending: transaction is {txn.status.value}")
    if gate is not txn.stage:
        raise TransitionError("STALE_GATE", f"Pending gate is {txn.stage.value}; refresh and retry")
    if expected_version != txn.version:
        raise TransitionError("STALE_VERSION", "Transaction changed since you loaded it; refresh and retry")
    comment = comment.strip()[:2000]
    if decision is not Decision.APPROVED and len(comment) < 5:
        raise TransitionError("COMMENT_REQUIRED", "Please explain what should change or why you are rejecting")

    acks = tuple(sorted(set(acknowledged_flags)))
    if decision is Decision.APPROVED:
        blocking = [f["code"] for f in txn.flags if f.get("severity") == "BLOCK"]
        if blocking:
            raise TransitionError("BLOCKING_FLAGS", "Resolve blocking risks first: " + ", ".join(blocking))
        missing = sorted({f["code"] for f in txn.flags if f.get("severity") == "WARN"} - set(acks))
        if missing:
            raise TransitionError("UNACKNOWLEDGED_WARNINGS", "Acknowledge warnings: " + ", ".join(missing))

    seq = (prev_record.seq + 1) if prev_record else 1
    prev_hash = prev_record.row_hash if prev_record else GENESIS_HASH
    created = _now()
    rec = ApprovalRecord(
        id=str(uuid.uuid4()), transaction_id=txn.id, seq=seq, gate=gate, decision=decision,
        actor_id=actor_id, comment=comment, acknowledged_flags=acks, idempotency_key=idempotency_key,
        created_at=created, prev_hash=prev_hash,
        row_hash=compute_hash(prev_hash, txn.id, seq, gate.value, decision.value, actor_id, comment,
                              acks, idempotency_key, created),
    )

    if decision is Decision.REJECTED:
        new = replace(txn, status=Status.HALTED)
    elif decision is Decision.CHANGES_REQUESTED:
        new = replace(txn, status=Status.IN_PROGRESS)
    else:
        idx = GATE_ORDER.index(txn.stage)
        if idx == len(GATE_ORDER) - 1:
            new = replace(txn, status=Status.COMPLETED)
        else:
            new = replace(txn, stage=GATE_ORDER[idx + 1], status=Status.IN_PROGRESS,
                          gate_summary={}, flags=[])
    return replace(new, resume_url=None, version=txn.version + 1, updated_at=_now()), rec
