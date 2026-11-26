-- =============================================================================
-- MY No-Agent Property Buyer Co-Pilot — PostgreSQL 15+ / Supabase schema
--
-- Defence in depth: the application enforces these rules too, but the database is
-- the last line — a compromised worker or a buggy n8n node still cannot:
--   * skip a HITL gate or advance more than one stage,
--   * approve a gate that is not currently paused,
--   * edit or delete an approval record (append-only, SHA-256 hash-chained),
--   * read another buyer's transaction (FORCE ROW LEVEL SECURITY).
-- Idempotent: safe to re-run in CI and on fresh environments.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- extensions
-- pgvector is optional: semantic search falls back to the engine's local TF-IDF.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;

-- ---------------------------------------------------------------- enums
DO $$ BEGIN
  CREATE TYPE hitl_gate AS ENUM ('HITL_1_LISTING_VETTING','HITL_2_OFFER_BUDGET','HITL_3_LAWYER_DEPOSIT',
                                 'HITL_4_SPA_LOAN_DUTY','HITL_5_TRANSFER_HANDOVER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE txn_status AS ENUM ('PAUSED_FOR_HITL','IN_PROGRESS','COMPLETED','HALTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE hitl_decision AS ENUM ('APPROVED','CHANGES_REQUESTED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE doc_kind AS ENUM ('LISTING','OFFICIAL_TITLE_SEARCH','VALUATION_REPORT','SITE_PHOTOS','SURVEY_PLAN',
    'LETTER_OF_OFFER','DEPOSIT_RECEIPT','SPA','LOAN_AGREEMENT','REDEMPTION_STATEMENT','STATE_CONSENT',
    'STAMP_CERTIFICATE','MOT_BORANG_14A','VP_CHECKLIST','UTILITY_TRANSFER','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------- transactions
CREATE TABLE IF NOT EXISTS transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id      text        NOT NULL CHECK (buyer_id ~ '^[A-Za-z0-9_\-@.]{3,64}$'),
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  property_type text        CHECK (property_type IN ('RESIDENTIAL_HOUSE','VACANT_LAND','AGRICULTURAL_LAND')),
  state_code    text,
  stage         hitl_gate   NOT NULL DEFAULT 'HITL_1_LISTING_VETTING',
  status        txn_status  NOT NULL DEFAULT 'IN_PROGRESS',
  version       integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  gate_summary  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  flags         jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(flags) = 'array'),
  -- n8n Wait-node resume URL: a capability URL — never returned to buyers by the API.
  resume_url    text        CHECK (resume_url IS NULL OR resume_url ~ '^https?://'),
  ruleset_version text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_buyer_idx  ON transactions (buyer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status, stage);

-- ---------------------------------------------------------------- approvals (append-only audit)
CREATE TABLE IF NOT EXISTS hitl_approvals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id     uuid          NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  seq                integer       NOT NULL,
  gate               hitl_gate     NOT NULL,
  decision           hitl_decision NOT NULL,
  actor_id           text          NOT NULL,
  comment            text          NOT NULL DEFAULT '' CHECK (char_length(comment) <= 2000),
  acknowledged_flags text[]        NOT NULL DEFAULT '{}',
  idempotency_key    text          NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9\-_]{16,80}$'),
  created_at         timestamptz   NOT NULL DEFAULT clock_timestamp(),
  prev_hash          char(64)      NOT NULL,
  row_hash           char(64)      NOT NULL UNIQUE,
  UNIQUE (transaction_id, seq),
  CHECK (decision = 'APPROVED' OR char_length(comment) >= 5)
);

-- Canonical, length-prefixed serialisation — MUST match state_machine.compute_hash().
CREATE OR REPLACE FUNCTION hitl_canonical_hash(
  p_prev text, p_txn uuid, p_seq int, p_gate text, p_decision text, p_actor text,
  p_comment text, p_acks text[], p_idem text, p_created timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(string_agg(char_length(x)::text || ':' || x || ';', '' ORDER BY ord), 'UTF8')), 'hex')
  FROM unnest(ARRAY[
    p_prev, p_txn::text, p_seq::text, p_gate, p_decision, p_actor, p_comment,
    array_to_string(ARRAY(SELECT a FROM unnest(p_acks) a ORDER BY a COLLATE "C"), ','),
    p_idem,
    to_char(p_created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
  ]) WITH ORDINALITY AS t(x, ord)
$$;

CREATE OR REPLACE FUNCTION hitl_approvals_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t    transactions%ROWTYPE;
  last hitl_approvals%ROWTYPE;
  blocking int;
BEGIN
  -- Row lock serialises concurrent decisions on the same transaction.
  SELECT * INTO t FROM transactions WHERE id = NEW.transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction % not found', NEW.transaction_id; END IF;
  IF t.status <> 'PAUSED_FOR_HITL' THEN
    RAISE EXCEPTION 'HITL_NOT_PAUSED: transaction is %', t.status USING ERRCODE = 'check_violation';
  END IF;
  IF t.stage <> NEW.gate THEN
    RAISE EXCEPTION 'HITL_STALE_GATE: pending gate is %', t.stage USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.actor_id <> t.buyer_id THEN
    RAISE EXCEPTION 'HITL_FORBIDDEN: only the owner may decide' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.decision = 'APPROVED' THEN
    SELECT count(*) INTO blocking FROM jsonb_array_elements(t.flags) f WHERE f->>'severity' = 'BLOCK';
    IF blocking > 0 THEN
      RAISE EXCEPTION 'HITL_BLOCKING_FLAGS: % blocking flag(s) open', blocking USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(t.flags) f
               WHERE f->>'severity' = 'WARN' AND NOT (f->>'code' = ANY (NEW.acknowledged_flags))) THEN
      RAISE EXCEPTION 'HITL_UNACKNOWLEDGED_WARNINGS' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO last FROM hitl_approvals WHERE transaction_id = NEW.transaction_id ORDER BY seq DESC LIMIT 1;
  -- Server-assigned values: anything the client supplied is overwritten.
  NEW.id         := gen_random_uuid();
  NEW.seq        := COALESCE(last.seq, 0) + 1;
  NEW.prev_hash  := COALESCE(last.row_hash, repeat('0', 64));
  NEW.created_at := clock_timestamp();
  NEW.acknowledged_flags := ARRAY(SELECT d FROM (SELECT DISTINCT a AS d FROM unnest(NEW.acknowledged_flags) a) s
                                  ORDER BY d COLLATE "C");
  NEW.row_hash   := hitl_canonical_hash(NEW.prev_hash, NEW.transaction_id, NEW.seq, NEW.gate::text,
                      NEW.decision::text, NEW.actor_id, NEW.comment, NEW.acknowledged_flags,
                      NEW.idempotency_key, NEW.created_at);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS hitl_approvals_bi ON hitl_approvals;
CREATE TRIGGER hitl_approvals_bi BEFORE INSERT ON hitl_approvals
  FOR EACH ROW EXECUTE FUNCTION hitl_approvals_before_insert();
DROP TRIGGER IF EXISTS hitl_approvals_no_update ON hitl_approvals;
CREATE TRIGGER hitl_approvals_no_update BEFORE UPDATE OR DELETE ON hitl_approvals
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS hitl_approvals_no_truncate ON hitl_approvals;
CREATE TRIGGER hitl_approvals_no_truncate BEFORE TRUNCATE ON hitl_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Recompute the chain server-side: returns true only if every link is intact.
CREATE OR REPLACE FUNCTION verify_hitl_chain(p_txn uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r hitl_approvals%ROWTYPE; prev text := repeat('0', 64); i int := 0;
BEGIN
  FOR r IN SELECT * FROM hitl_approvals WHERE transaction_id = p_txn ORDER BY seq LOOP
    i := i + 1;
    IF r.seq <> i OR r.prev_hash <> prev OR r.row_hash <> hitl_canonical_hash(r.prev_hash, r.transaction_id,
         r.seq, r.gate::text, r.decision::text, r.actor_id, r.comment, r.acknowledged_flags,
         r.idempotency_key, r.created_at) THEN
      RETURN false;
    END IF;
    prev := r.row_hash;
  END LOOP;
  RETURN true;
END $$;

-- ---------------------------------------------------------------- transaction state guard
CREATE OR REPLACE FUNCTION transactions_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_idx int := array_position(enum_range(NULL::hitl_gate), OLD.stage);
  new_idx int := array_position(enum_range(NULL::hitl_gate), NEW.stage);
  last hitl_approvals%ROWTYPE;
BEGIN
  IF OLD.status IN ('COMPLETED','HALTED') THEN
    RAISE EXCEPTION 'TXN_TERMINAL: transaction is %', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.buyer_id <> OLD.buyer_id OR NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'TXN_IMMUTABLE_OWNER' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'TXN_VERSION: version must increment by exactly 1' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO last FROM hitl_approvals WHERE transaction_id = OLD.id ORDER BY seq DESC LIMIT 1;

  -- Leaving PAUSED_FOR_HITL requires a human decision recorded for THIS gate.
  IF OLD.status = 'PAUSED_FOR_HITL' AND NEW.status <> 'PAUSED_FOR_HITL' THEN
    IF last.id IS NULL OR last.gate <> OLD.stage OR last.created_at < OLD.updated_at THEN
      RAISE EXCEPTION 'TXN_NO_HUMAN_DECISION for %', OLD.stage USING ERRCODE = 'check_violation';
    END IF;
    IF (last.decision = 'REJECTED' AND NEW.status <> 'HALTED')
       OR (last.decision = 'CHANGES_REQUESTED' AND (NEW.status <> 'IN_PROGRESS' OR new_idx <> old_idx))
       OR (last.decision = 'APPROVED' AND NOT (
             (new_idx = old_idx + 1 AND NEW.status = 'IN_PROGRESS')
          OR (old_idx = 5 AND new_idx = 5 AND NEW.status = 'COMPLETED'))) THEN
      RAISE EXCEPTION 'TXN_DECISION_MISMATCH: % does not permit %/%', last.decision, NEW.stage, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF new_idx <> old_idx THEN
    RAISE EXCEPTION 'TXN_STAGE_SKIP: stage can only change via an approved HITL gate' USING ERRCODE = 'check_violation';
  ELSIF NEW.status IN ('COMPLETED','HALTED') AND OLD.status <> 'PAUSED_FOR_HITL' THEN
    RAISE EXCEPTION 'TXN_TERMINAL_WITHOUT_DECISION' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transactions_bu ON transactions;
CREATE TRIGGER transactions_bu BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_before_update();
DROP TRIGGER IF EXISTS transactions_no_delete ON transactions;
CREATE TRIGGER transactions_no_delete BEFORE DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- documents (metadata only)
-- Files live in object storage (Supabase Storage / S3) with SSE + signed URLs; the DB holds
-- only a content hash so tampering with a stored file is detectable.
CREATE TABLE IF NOT EXISTS transaction_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid        NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  gate            hitl_gate   NOT NULL,
  kind            doc_kind    NOT NULL,
  storage_key     text        NOT NULL CHECK (storage_key !~ '\.\.' AND storage_key ~ '^[A-Za-z0-9/_\-.]{1,300}$'),
  sha256          char(64)    NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type       text        NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','text/plain')),
  size_bytes      integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
  extracted_facts jsonb,
  verified_by_human boolean   NOT NULL DEFAULT false,
  uploaded_by     text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_documents_txn_idx ON transaction_documents (transaction_id, gate);

-- ---------------------------------------------------------------- workflow events (n8n, append-only)
-- Snapshot of exactly what the buyer was shown at each gate (flags, costs, ruleset) — evidence
-- for disputes and for re-running the engine when rules change.
CREATE TABLE IF NOT EXISTS workflow_events (
  id              bigserial PRIMARY KEY,
  transaction_id  uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  gate            hitl_gate,
  event_type      text        NOT NULL CHECK (event_type IN ('GATE_OPENED','DECISION_CONFIRMED',
                                'WORKFLOW_HALTED','WORKFLOW_COMPLETED','DIRECTORY_FRESHNESS_ALERT')),
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  n8n_execution_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_events_txn_idx ON workflow_events (transaction_id, created_at);
DROP TRIGGER IF EXISTS workflow_events_no_update ON workflow_events;
CREATE TRIGGER workflow_events_no_update BEFORE UPDATE OR DELETE ON workflow_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- legal/statutory directory
CREATE TABLE IF NOT EXISTS directory_entries (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_name                 text    NOT NULL,
  category                    text    NOT NULL CHECK (category IN ('STAMP_DUTY_TAX','LAND_OFFICE','VALUATION',
                                'LEGAL_PROFESSIONAL','FINANCING','SURVEY_PLANNING','LOCAL_COUNCIL_UTILITIES','LEGISLATION')),
  jurisdiction_state          text    NOT NULL DEFAULT 'NATIONAL',
  official_url                text    NOT NULL CHECK (official_url ~ '^https://'),
  contact_details             text    NOT NULL DEFAULT '',
  summary_rule                text    NOT NULL,
  last_verified_date          date,   -- NULL = never verified by a human; UI shows UNVERIFIED
  verified_by                 text,
  is_active                   boolean NOT NULL DEFAULT true,
  is_proposed_pending_gazette boolean NOT NULL DEFAULT false,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_name, jurisdiction_state)
);

CREATE OR REPLACE VIEW directory_entries_v AS
SELECT d.*,
  CASE
    WHEN NOT d.is_active THEN 'INACTIVE'
    WHEN d.is_proposed_pending_gazette THEN 'PROPOSED_PENDING_GAZETTE'
    WHEN d.last_verified_date IS NULL THEN 'UNVERIFIED'
    WHEN d.last_verified_date < current_date - 90 THEN 'STALE'
    ELSE 'VERIFIED'
  END AS freshness_status
FROM directory_entries d;

-- ---------------------------------------------------------------- RAG knowledge chunks (optional pgvector)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL, body text NOT NULL, source_url text,
      directory_entry_id uuid REFERENCES directory_entries(id),
      embedding vector(1536), created_at timestamptz NOT NULL DEFAULT now())';
    EXECUTE 'CREATE INDEX IF NOT EXISTS knowledge_chunks_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)';
  ELSE
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL, body text NOT NULL, source_url text,
      directory_entry_id uuid REFERENCES directory_entries(id),
      created_at timestamptz NOT NULL DEFAULT now());
  END IF;
END $$;

-- ---------------------------------------------------------------- least-privilege roles + RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_app') THEN
    CREATE ROLE copilot_app NOLOGIN;          -- engine API; LOGIN + password granted at deploy time
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_automation') THEN
    CREATE ROLE copilot_automation NOLOGIN;   -- n8n Postgres credential
  END IF;
END $$;

REVOKE ALL ON transactions, hitl_approvals, transaction_documents, directory_entries, knowledge_chunks, workflow_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON transactions TO copilot_app, copilot_automation;
GRANT SELECT, INSERT ON hitl_approvals TO copilot_app;           -- automation can never write decisions
GRANT SELECT ON hitl_approvals TO copilot_automation;
GRANT SELECT, INSERT ON transaction_documents TO copilot_app;
GRANT SELECT ON transaction_documents TO copilot_automation;
GRANT SELECT ON directory_entries, directory_entries_v, knowledge_chunks TO copilot_app, copilot_automation;
GRANT UPDATE (last_verified_date, verified_by, is_active, updated_at) ON directory_entries TO copilot_automation;
GRANT SELECT, INSERT ON workflow_events TO copilot_automation;
GRANT SELECT ON workflow_events TO copilot_app;
GRANT USAGE ON SEQUENCE workflow_events_id_seq TO copilot_automation;

ALTER TABLE transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions          FORCE ROW LEVEL SECURITY;
ALTER TABLE hitl_approvals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitl_approvals        FORCE ROW LEVEL SECURITY;
ALTER TABLE transaction_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_documents FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_can_see(p_buyer text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_buyer = current_setting('app.buyer_id', true)
      OR current_setting('app.actor_role', true) = 'automation'
      OR current_user = 'copilot_automation'
$$;

DROP POLICY IF EXISTS txn_owner ON transactions;
CREATE POLICY txn_owner ON transactions USING (app_can_see(buyer_id)) WITH CHECK (app_can_see(buyer_id));
DROP POLICY IF EXISTS apr_owner ON hitl_approvals;
CREATE POLICY apr_owner ON hitl_approvals
  USING (EXISTS (SELECT 1 FROM transactions t WHERE t.id = transaction_id AND app_can_see(t.buyer_id)))
  WITH CHECK (actor_id = current_setting('app.buyer_id', true));  -- only a buyer session can decide
DROP POLICY IF EXISTS doc_owner ON transaction_documents;
CREATE POLICY doc_owner ON transaction_documents
  USING (EXISTS (SELECT 1 FROM transactions t WHERE t.id = transaction_id AND app_can_see(t.buyer_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM transactions t WHERE t.id = transaction_id AND app_can_see(t.buyer_id)));

COMMIT;
