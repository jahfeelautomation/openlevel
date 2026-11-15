-- P2 probe evidence table (m-11). Staging-only; applied by setup-db.ts so the
-- table exists wherever probes run. Every probe step writes one row; the
-- fencing assertions count marks per workflow ID.
CREATE TABLE IF NOT EXISTS p2_probe_log (
  id          bigserial PRIMARY KEY,
  workflow_id text NOT NULL,
  mark        text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS p2_probe_by_workflow ON p2_probe_log (workflow_id, mark);
