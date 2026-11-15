# Phase 0 — Track B Owner Execution Package (native provisioner)

Concise procedure for executing the P1/P3/backpressure proofs on the owner's
Mac using the native PostgreSQL adapter (`PHASE0_PROVISIONER=native`). The
agent cannot run these steps (sandbox has no TCP); the owner runs them and
pastes back sanitized output. No push happens in this task.

Setup prerequisites (§0–§2b) live in `phase0/LOCAL_POSTGRES_RUNBOOK.md` and
are not repeated here beyond the checkpoint list.

## B-0. Checkpoint: prerequisites done

- [ ] Repo root `/Users/sherwin/Documents/openlevel/openlevel`, branch
      `phase0/automated-testing`, `node --version` → v22.x.
- [ ] `npm ci --no-audit --no-fund` completed; `npm ls @dbos-inc/dbos-sdk` → 5.5.0.
- [ ] PostgreSQL **16.x** running, loopback-only (`SHOW listen_addresses` →
      `127.0.0.1` and/or `::1`; native adapter requires major 16 exactly).
- [ ] Database `phase0_proofs` exists; bootstrap superuser has a password.
- [ ] Loopback `pg_hba.conf` lines are `scram-sha-256` (no `trust`).
- [ ] `phase0/.env` (gitignored) exports `PHASE0_DATABASE_URL` (bootstrap)
      and `PHASE0_RT_PASSWORD` (random). Never paste these anywhere.

## B-1. Session setup (every new shell)

```bash
cd /Users/sherwin/Documents/openlevel/openlevel
set -a; source phase0/.env; set +a
export PHASE0_PROVISIONER=native
node --import tsx phase0/preflight.ts
# Expect: database, server_version 16.x, user, server 127.0.0.1:<port>, preflight: PASS
```

## B-2. Primary command (one line, full sequence)

```bash
PHASE0_PROVISIONER=native node --import tsx phase0/test-env.ts run --repeat-suites --sigkill-loop 20
```

What it does: unit gates → native provision + SCRAM demonstration → setup
(+ ownership ledger) → runtime verification as `phase0_rt` → p1 worker →
P1 → backpressure → P3 → retained-database rerun (P1 + backpressure + P3)
→ 20× SIGKILL loop → provider-vs-ledger reconciliation → summary →
ownership-scoped teardown. Exit 0 = pass; 1 = test failure; 2 = infra
refusal (nothing proven); 3 = cleanup failure after green.

Expected console markers (all must appear on a pass):

- `provisioner: native`
- `native: <bootstrap-user>@127.0.0.1:<port>/phase0_proofs (PostgreSQL 16.x ...)`
- `native: password_encryption=scram-sha-256 (verified)`
- `native: hba rule for phase0_rt@127.0.0.1 ... method=scram-sha-256`
- `native: role phase0_rt has a SCRAM-SHA-256 verifier (value never logged)`
- `runtime: phase0_rt@127.0.0.1:<port> scram=scram-sha-256`
- `run id: <execution-id> ... elapsed_s=<n>`
- `cleaned: ...` lines; `retained: ...` lines only with benign reasons

## B-3. Diagnosis commands (only if B-2 fails)

```bash
# Re-run one suite against the retained database (worker needed for P1):
export P1_DATABASE_URL="$PHASE0_RT_URL" P3_DATABASE_URL="$PHASE0_RT_URL"
node --import tsx phase0/p1/worker.ts &  # wait for "p1 worker up"
npx vitest run --config phase0/vitest.phase0.config.ts phase0/p1/p1.test.ts
npx vitest run --config phase0/vitest.phase0.config.ts phase0/p1/backpressure.test.ts
npx vitest run --config phase0/vitest.phase0.config.ts phase0/p3/p3.test.ts
# Provision / tear down alone:
PHASE0_PROVISIONER=native node --import tsx phase0/test-env.ts up
PHASE0_PROVISIONER=native node --import tsx phase0/test-env.ts down
```

## B-4. Artifacts (all under phase0/evidence/)

Per execution id: `native-provision-<id>.json`, `suite-P1-<id>.json`,
`suite-backpressure-<id>.json`, `suite-P3-<id>.json`,
`suite-P1-rerun-<id>.json`, `suite-backpressure-rerun-<id>.json`,
`suite-P3-rerun-<id>.json`, `suite-sigkill-<i>-of-20-<id>.json` (×20),
`provider-<id>.jsonl`, `reconciliation-<id>.json`, `summary-<id>.md`.

Verify redaction before sharing anything:

```bash
grep -rE "password=|://[^ /]+:[^ @/]+@" phase0/evidence/ | grep -v "<redacted>" ; echo "redaction-check done (no output above = clean)"
```

## B-5. What to paste back (sanitized)

1. Full console output of B-2 (passwords never appear; verify with B-4 check).
2. `summary-<id>.md` and `reconciliation-<id>.json` contents.
3. `SELECT version()` verbatim + `npm ls @dbos-inc/dbos-sdk` line.
4. Per-suite pass/fail counts + durations (from the console tail).
5. The 20-iteration SIGKILL tally (all must pass).
6. The `cleaned:`/`retained:` teardown report.

Paste into chat or a file — never include `phase0/.env` contents.

## B-6. After the run

- Green run: leave the database running for a possible second confirmatory
  run; full removal later follows runbook §7 (exact-name DROP DATABASE +
  DROP ROLE, verified scope).
- Any failure: paste the output as-is (step B-5). Do not edit assertions,
  weaken timeouts, or rerun with different flags to force green — the
  agent applies root-cause discipline and issues a corrected tree.
- The agent reconciles pasted output into `phase0/EVIDENCE_MATRIX.md` and
  issues LOCAL PASS / LOCAL FIX / LOCAL BLOCKED. Docker-image provenance
  stays BLOCKED here by design; it is proven by a later CI run.
