-- P1 prototype schema (Phase 0, isolated — NOT the app migration path).
-- Run against a scratch real-PostgreSQL database only. Never production.
-- Business-event idempotency is independent of DBOS workflow-history retention.

CREATE TABLE IF NOT EXISTS p1_business_event (
  business_key   text PRIMARY KEY,          -- stable: provider|account|tenant|provider_event_id
  agency_id      text NOT NULL,
  location_id    text NOT NULL,
  payload_hash   text NOT NULL,             -- sha256 of canonical payload bytes
  workflow_id    text NOT NULL UNIQUE,      -- deterministic UUID derived from business_key
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  last_status    text NOT NULL DEFAULT 'accepted',
  -- Compact terminal response/result reference (JSON, bounded size).
  last_result    jsonb,
  -- Tombstone expiry: duplicates after this are treated as NEW per policy.
  expires_at     timestamptz NOT NULL,
  -- Generation: incremented on each post-expiry renewal. The workflow ID
  -- is derived from (business_key, generation) so concurrent renewals
  -- converge on exactly one new generation via the update guard below.
  generation     int NOT NULL DEFAULT 1
);

-- Superseded generations are archived here on renewal (audit evidence
-- retained per the trigger's retention policy, never silently overwritten).
CREATE TABLE IF NOT EXISTS p1_business_event_generation (
  business_key   text NOT NULL,
  generation     int NOT NULL,
  workflow_id    text NOT NULL,
  payload_hash   text NOT NULL,
  last_status    text NOT NULL,
  last_result    jsonb,
  accepted_at    timestamptz NOT NULL,
  superseded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_key, generation)
);

CREATE INDEX IF NOT EXISTS p1_business_event_expiry
  ON p1_business_event (expires_at);

-- Synthetic domain mutation (M-07/i-06): the winner path writes one row
-- here in the same transaction as the event + enqueue, so rollback and
-- atomicity cover (domain mutation + event + enqueue), not just the
-- idempotency bookkeeping. Production code would write the real domain row.
CREATE TABLE IF NOT EXISTS p1_domain_action (
  business_key text NOT NULL,
  generation   int NOT NULL DEFAULT 1,
  workflow_id  text NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_key, generation)
);

-- Same-key/different-payload conflicts are recorded, never silently merged.
CREATE TABLE IF NOT EXISTS p1_business_event_discrepancy (
  id            bigserial PRIMARY KEY,
  business_key  text NOT NULL REFERENCES p1_business_event(business_key),
  expected_hash text NOT NULL,
  observed_hash text NOT NULL,
  observed_at   timestamptz NOT NULL DEFAULT now()
);
