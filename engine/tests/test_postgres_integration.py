"""Runs only when COPILOT_TEST_DATABASE_URL points at a disposable PostgreSQL with schema.sql applied.
Proves the DATABASE enforces the HITL invariants even if application code is bypassed."""
import os
import uuid

import pytest

from copilot_engine.state_machine import (
    Decision,
    Gate,
    Status,
    TransitionError,
    new_transaction,
    pause_for_gate,
    verify_chain,
)

DSN = os.getenv("COPILOT_TEST_DATABASE_URL")
APP_DSN = os.getenv("COPILOT_TEST_APP_DATABASE_URL")  # login role that is a member of copilot_app
pytestmark = [pytest.mark.integration, pytest.mark.skipif(not DSN, reason="no test database")]


@pytest.fixture(scope="module")
def repo():
    from copilot_engine.repository import PostgresRepository
    r = PostgresRepository(APP_DSN or DSN)
    yield r
    r.close()


def raw(sql, params=(), buyer=None):
    import psycopg
    with psycopg.connect(APP_DSN or DSN) as conn, conn.cursor() as cur:
        if buyer:
            cur.execute("SELECT set_config('app.buyer_id', %s, false)", (buyer,))
        else:
            cur.execute("SELECT set_config('app.actor_role', 'automation', false)")
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def paused(repo, buyer):
    t = repo.create(new_transaction(buyer, "Integration test house"))
    return repo.save(pause_for_gate(t, t.stage, {}, [], None), t.version)


def test_full_cycle_and_db_chain_matches_python(repo):
    b = f"it-{uuid.uuid4().hex[:8]}"
    t = paused(repo, b)
    t, rec, _, _ = repo.apply_decision(t.id, b, gate=t.stage, decision=Decision.APPROVED, comment="",
                                       acknowledged_flags=[], idempotency_key=uuid.uuid4().hex,
                                       expected_version=t.version)
    assert t.stage is Gate.HITL_2_OFFER_BUDGET and t.status is Status.IN_PROGRESS
    recs = repo.approvals(t.id, b)
    assert verify_chain(recs)  # Python verifies the hashes the DATABASE computed
    assert raw("SELECT verify_hitl_chain(%s)", (t.id,))[0][0] is True


def test_db_blocks_stage_skip_and_audit_mutation(repo):
    import psycopg
    b = f"it-{uuid.uuid4().hex[:8]}"
    t = paused(repo, b)
    with pytest.raises(psycopg.errors.CheckViolation):
        raw("UPDATE transactions SET stage='HITL_4_SPA_LOAN_DUTY', status='IN_PROGRESS', version=version+1 WHERE id=%s",
            (t.id,))
    repo.apply_decision(t.id, b, gate=t.stage, decision=Decision.CHANGES_REQUESTED, comment="please recheck",
                        acknowledged_flags=[], idempotency_key=uuid.uuid4().hex, expected_version=t.version)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        raw("UPDATE hitl_approvals SET decision='APPROVED' WHERE transaction_id=%s", (t.id,), buyer=b)
    with pytest.raises(psycopg.Error):
        raw("DELETE FROM hitl_approvals WHERE transaction_id=%s", (t.id,), buyer=b)


def test_db_blocks_approval_with_blocking_flag(repo):
    import psycopg
    b = f"it-{uuid.uuid4().hex[:8]}"
    t = repo.create(new_transaction(b, "Blocked house"))
    t = repo.save(pause_for_gate(t, t.stage, {}, [{"code": "CASH_BY_HAND", "severity": "BLOCK"}], None), t.version)
    with pytest.raises(TransitionError):
        repo.apply_decision(t.id, b, gate=t.stage, decision=Decision.APPROVED, comment="", acknowledged_flags=[],
                            idempotency_key=uuid.uuid4().hex, expected_version=t.version)
    # Bypass the app entirely: the trigger still refuses.
    with pytest.raises(psycopg.errors.CheckViolation):
        raw("INSERT INTO hitl_approvals (transaction_id, gate, decision, actor_id, idempotency_key, prev_hash, row_hash)"
            " VALUES (%s, 'HITL_1_LISTING_VETTING', 'APPROVED', %s, %s, '', '')", (t.id, b, uuid.uuid4().hex), buyer=b)


@pytest.mark.skipif(not APP_DSN, reason="RLS needs a non-superuser login role")
def test_rls_isolates_buyers(repo):
    b1, b2 = f"it-{uuid.uuid4().hex[:8]}", f"it-{uuid.uuid4().hex[:8]}"
    t = paused(repo, b1)
    assert repo.get(t.id, b2) is None
    assert raw("SELECT count(*) FROM transactions WHERE id=%s", (t.id,), buyer=b2)[0][0] == 0
    assert raw("SELECT count(*) FROM transactions WHERE id=%s", (t.id,), buyer=b1)[0][0] == 1
