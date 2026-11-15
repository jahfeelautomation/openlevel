# Phase 0 — Additional Execution Safeguards (user-directed)

Binding for all prompt6/plan_prompt6 execution. Supplements (never contradicts)
`docs/plans/plan_prompt6.md`, which stays byte-identical per prompt6 §6.

## 1. PostgreSQL provisioning and binary provenance

- Pin exact versions before installing anything: the `embedded-postgres`
  npm package version AND the PostgreSQL binary version it provisions.
  Never install unpinned `latest`.
- Inspect the package contents and all platform-specific lifecycle
  scripts (preinstall/postinstall) BEFORE executing them. Record the npm
  integrity hash and the PostgreSQL binary SHA-256 in the evidence log.
- Override unsafe defaults explicitly: unique directory under `/tmp`;
  random generated credentials; dedicated database + restricted runtime
  role; loopback-only listen; verified-free local port (probe before
  bind); SCRAM authentication; full cleanup of data dir on completion.
- Set `createPostgresUser: false`. The tool must not modify host users
  or system configuration. Any privileged requirement = stop + report.
- Tooling stays OUTSIDE the repo: install `embedded-postgres` in `/tmp`
  scratch, never into `package.json`/lockfile. No new repo dependencies
  from provisioning.
- Major-version selection: match the intended Neon deployment target. If
  no target is selected at execution time, record the assumed version
  explicitly and require compatibility verification against the actual
  Neon branch before production cutover (owner gate, not assumed).

## 2. Tombstone-expiry concurrency (new P1 acceptance test)

Beyond the single-request expiry test: two or more requests with the same
event key arrive concurrently AFTER its tombstone expired. Requirements:

- The expired event is treated as new per the defined retention policy.
- All concurrent requests converge on exactly ONE new event generation
  and ONE workflow — no concurrent request may create a second new
  generation or workflow.
- The expiry transition, new generation identity, and workflow enqueue
  are atomic (single transaction; unique constraint on
  `(business_key, generation)` or equivalent claim mechanism).
- The superseded generation's audit evidence is preserved per the
  retention policy (tombstone archive, not silent overwrite).

Design note (to prove, not assume): likely implemented as
claim-expired-row + insert-new-generation in one transaction with
`ON CONFLICT` adoption; losers read the winner's generation. The exact
mechanism is set at implementation and proven by the test below.

## 3. Evidence rules (reaffirmed)

- Provisioning results (chosen rung, exact versions, hashes, ports,
  roles) and the expiry-race test go in the seven-column matrix like
  every other case: Test ID, Requirement, Environment, Command, Result,
  Evidence, Notes.
- IMPLEMENTED ≠ PASS. Any test not executed against real PostgreSQL is
  marked NOT RUN or BLOCKED with the specific gate named. No exceptions.
