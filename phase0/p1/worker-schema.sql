-- P1 worker execution log: proves exactly-once execution under concurrency.
-- The p1-echo workflow inserts one row per EXECUTION (not per step replay:
-- the insert lives in a DBOS step, so replays reuse the checkpoint).
CREATE TABLE IF NOT EXISTS p1_execution_log (
  id          bigserial PRIMARY KEY,
  workflow_id text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);
