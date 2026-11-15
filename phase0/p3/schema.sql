-- P3 prototype schema (Phase 0, isolated — scratch DB only).
-- Operation/attempt hierarchy + wallet ledger per V2.1 §§8/12.

CREATE TABLE IF NOT EXISTS p3_operation (
  operation_id   text PRIMARY KEY,            -- stable business intent UUID
  agency_id      text NOT NULL,
  location_id    text NOT NULL,
  purpose        text NOT NULL,               -- e.g. 'agent-turn', 'outbound-send'
  provider       text NOT NULL,
  -- Budget ceiling: USD micro-units + token/attempt caps (versioned pricing).
  budget_usd_micro     bigint NOT NULL,
  max_input_tokens     int NOT NULL,
  max_output_tokens    int NOT NULL,
  max_provider_attempts int NOT NULL,
  price_table_version  text NOT NULL,
  -- Customer billing state (separate from provider attempts).
  billing_state  text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_state IN ('unbilled','reserved','settled','refunded','expired')),
  terminal_result jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS p3_attempt (
  attempt_id     text PRIMARY KEY,
  operation_id   text NOT NULL REFERENCES p3_operation(operation_id),
  sequence       int NOT NULL,
  request_fingerprint text NOT NULL,         -- sha256 of exact bytes sent
  idempotency_key text,                      -- when the provider supports one
  state          text NOT NULL DEFAULT 'prepared'
    CHECK (state IN ('prepared','dispatching','succeeded','failed','uncertain')),
  provider_request_id text,
  provider_object_id  text,
  usage_input_tokens  int,
  usage_output_tokens int,
  cost_usd_micro      bigint,
  started_at     timestamptz,
  finished_at    timestamptz,
  UNIQUE (operation_id, sequence)
);

CREATE TABLE IF NOT EXISTS p3_wallet (
  agency_id      text PRIMARY KEY,
  balance_credits_micro bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Settlement records: unique per operation/attempt => replay cannot double-settle.
-- NULLS NOT DISTINCT (PostgreSQL 15+; runbook requires 16+) makes the
-- reserve/refund rows (NULL attempt_id) deduplicate too — without it,
-- concurrent duplicate reserves would both insert (M-10).
CREATE TABLE IF NOT EXISTS p3_settlement (
  operation_id   text NOT NULL,
  attempt_id     text,
  kind           text NOT NULL CHECK (kind IN ('reserve','settle','refund','expire')),
  amount_micro   bigint NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (operation_id, kind, attempt_id)
);

-- Evidence preservation for the run-wide provider-vs-ledger audit
-- (phase0/reconcile.mjs). The P3 acceptance suite TRUNCATEs p3_attempt
-- before every test for isolation, but reconcile audits the RUN-WIDE
-- provider journal against those rows only after every suite has finished.
-- Destroying them made the invariant unprovable by construction: the first
-- reconcile run found 30 charged operations and exactly 1 surviving attempt
-- row (the final test's). Move rows here instead of losing them; the audit
-- reads live UNION archive, so every provider charge stays provable for the
-- whole run no matter how many times the fixture resets its tables.
CREATE TABLE IF NOT EXISTS p3_attempt_archive (
  attempt_id     text PRIMARY KEY,
  operation_id   text NOT NULL,
  sequence       int NOT NULL,
  request_fingerprint text NOT NULL,         -- sha256 of exact bytes sent
  idempotency_key text,
  state          text NOT NULL,              -- same domain as p3_attempt.state
  provider_request_id text,
  provider_object_id  text,
  usage_input_tokens  int,
  usage_output_tokens int,
  cost_usd_micro      bigint,
  started_at     timestamptz,
  finished_at    timestamptz,
  archived_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION p3_archive_attempts() RETURNS trigger AS $$
BEGIN
  INSERT INTO p3_attempt_archive (
    attempt_id, operation_id, sequence, request_fingerprint, idempotency_key,
    state, provider_request_id, provider_object_id, usage_input_tokens,
    usage_output_tokens, cost_usd_micro, started_at, finished_at)
  SELECT attempt_id, operation_id, sequence, request_fingerprint, idempotency_key,
         state, provider_request_id, provider_object_id, usage_input_tokens,
         usage_output_tokens, cost_usd_micro, started_at, finished_at
  FROM p3_attempt
  ON CONFLICT (attempt_id) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Statement-level: fires for every TRUNCATE that includes p3_attempt, so
-- evidence survives regardless of which harness component resets the table.
CREATE OR REPLACE TRIGGER p3_attempt_archive_on_truncate
  BEFORE TRUNCATE ON p3_attempt
  FOR EACH STATEMENT EXECUTE FUNCTION p3_archive_attempts();
