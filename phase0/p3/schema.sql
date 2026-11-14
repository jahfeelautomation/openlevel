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
