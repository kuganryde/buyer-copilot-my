import uuid
from dataclasses import replace

import pytest

from copilot_engine.repository import MemoryRepository
from copilot_engine.state_machine import (
    GATE_ORDER,
    Decision,
    Gate,
    Status,
    TransitionError,
    new_transaction,
    pause_for_gate,
    verify_chain,
)

BUYER = "buyer-001"


def key():
    return uuid.uuid4().hex


def setup(flags=None):
    repo = MemoryRepository()
    t = repo.create(new_transaction(BUYER, "Teres 2 tingkat, Kajang"))
    p = pause_for_gate(t, Gate.HITL_1_LISTING_VETTING, {"s": 1}, flags or [], None)
    repo.save(p, t.version)
    return repo, p


def decide(repo, t, decision=Decision.APPROVED, comment="", acks=(), idem=None, actor=BUYER, gate=None):
    return repo.apply_decision(t.id, actor, gate=gate or t.stage, decision=decision, comment=comment,
                               acknowledged_flags=list(acks), idempotency_key=idem or key(),
                               expected_version=t.version)


def test_full_happy_path_through_all_five_gates():
    repo, t = setup()
    for i, gate in enumerate(GATE_ORDER):
        assert t.stage is gate and t.status is Status.PAUSED_FOR_HITL
        t, rec, replay, _ = decide(repo, t)
        assert rec.seq == i + 1 and not replay
        if gate is not GATE_ORDER[-1]:
            assert t.status is Status.IN_PROGRESS and t.stage is GATE_ORDER[i + 1]
            p = pause_for_gate(t, t.stage, {}, [], None)
            t = repo.save(p, t.version)
    assert t.status is Status.COMPLETED
    assert verify_chain(repo.approvals(t.id, BUYER))


def test_blocking_flag_prevents_approval_but_allows_reject():
    repo, t = setup([{"code": "CASH_BY_HAND", "severity": "BLOCK"}])
    with pytest.raises(TransitionError) as e:
        decide(repo, t)
    assert e.value.code == "BLOCKING_FLAGS"
    t2, _, _, _ = decide(repo, t, Decision.REJECTED, comment="Seller insists on cash, walking away")
    assert t2.status is Status.HALTED
    with pytest.raises(TransitionError):  # terminal
        decide(repo, t2, Decision.APPROVED)


def test_warnings_must_be_acknowledged():
    repo, t = setup([{"code": "EXISTING_CHARGE", "severity": "WARN"}])
    with pytest.raises(TransitionError) as e:
        decide(repo, t)
    assert e.value.code == "UNACKNOWLEDGED_WARNINGS"
    t2, rec, _, _ = decide(repo, t, acks=["EXISTING_CHARGE"])
    assert rec.acknowledged_flags == ("EXISTING_CHARGE",)


def test_changes_requested_needs_comment_and_stays_on_gate():
    repo, t = setup()
    with pytest.raises(TransitionError) as e:
        decide(repo, t, Decision.CHANGES_REQUESTED, comment="")
    assert e.value.code == "COMMENT_REQUIRED"
    t2, _, _, _ = decide(repo, t, Decision.CHANGES_REQUESTED, comment="Recheck the lease expiry")
    assert t2.status is Status.IN_PROGRESS and t2.stage is Gate.HITL_1_LISTING_VETTING


def test_stale_gate_version_and_wrong_actor_rejected():
    repo, t = setup()
    with pytest.raises(TransitionError) as e:
        decide(repo, t, gate=Gate.HITL_2_OFFER_BUDGET)
    assert e.value.code == "STALE_GATE"
    with pytest.raises(TransitionError) as e:
        decide(repo, replace(t, version=t.version - 1))
    assert e.value.code == "STALE_VERSION"
    with pytest.raises(TransitionError) as e:
        decide(repo, t, actor="attacker-9")
    assert e.value.code == "NOT_FOUND"  # other buyers can't even see it


def test_idempotent_replay_returns_same_record():
    repo, t = setup()
    k = key()
    t2, r1, replay1, _ = decide(repo, t, idem=k)
    _, r2, replay2, _ = decide(repo, t, idem=k)
    assert not replay1 and replay2 and r1.id == r2.id
    assert len(repo.approvals(t.id, BUYER)) == 1


def test_tampering_breaks_chain():
    repo, t = setup()
    t, _, _, _ = decide(repo, t)
    t = repo.save(pause_for_gate(t, t.stage, {}, [], None), t.version)
    decide(repo, t)
    recs = repo.approvals(t.id, BUYER)
    assert verify_chain(recs)
    forged = [replace(recs[0], decision=Decision.REJECTED)] + recs[1:]
    assert not verify_chain(forged)
    reordered = [replace(recs[1], seq=1), replace(recs[0], seq=2)]
    assert not verify_chain(reordered)


def test_cannot_pause_wrong_gate_or_when_paused():
    repo, t = setup()
    with pytest.raises(TransitionError):
        pause_for_gate(t, Gate.HITL_1_LISTING_VETTING, {}, [], None)  # already paused
    t2 = new_transaction(BUYER, "x x x")
    with pytest.raises(TransitionError):
        pause_for_gate(t2, Gate.HITL_3_LAWYER_DEPOSIT, {}, [], None)


def test_resume_url_never_serialised():
    t = new_transaction(BUYER, "abc")
    t = pause_for_gate(t, t.stage, {}, [], "http://n8n:5678/webhook-waiting/secret")
    assert "resume_url" not in t.to_dict()
