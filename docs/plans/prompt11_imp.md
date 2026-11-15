# Track B (native provisioner) — B-5 sanitized evidence report

**Execution:** `run-2026-11-15T03-19-34-525Z-29438`
**Flags:** `--repeat-suites --sigkill-loop 20` · **EXITCODE=0** · elapsed 103s
**Repo:** `openlevel`, branch `phase0/automated-testing` · all fixes below are **uncommitted**
**Protocol:** `PHASE0_RT_URL` unset per run; `phase0/.env` untouched; DB left running after the green run (B-6).

## 1. Gates

| Gate | Result |
|---|---|
| `tsc` | exit 0 |
| unit (no database) | **120/120** passed, 6 files, 7.32s (was 111 before this session's fixes) |
| preflight | **PASS** (disposable target verified) |
| SCRAM provision | `native: password_encryption=scram-sha-256 (verified)`; hba `line 115: host db=all user=all addr=127.0.0.1 method=scram-sha-256` |
| runtime | `phase0_rt@127.0.0.1:5433 scram=scram-sha-256` |
| setup | all 4 schemas applied, 11 prototype relations present, ownership ledger recorded (11 tables) |

Console (redacted excerpt):

```
provisioner: native
native: hba rule for phase0_rt@127.0.0.1 (tls=off): line 115: host db=all user=all addr=127.0.0.1 method=scram-sha-256
native: anton@127.0.0.1:5433/phase0_proofs (16.16 (Postgres.app))
native: password_encryption=scram-sha-256 (verified)
native: url postgres://anton:<redacted>@127.0.0.1:5433/phase0_proofs
preflight: PASS (disposable target verified)
...
runtime: phase0_rt@127.0.0.1:5433 scram=scram-sha-256
```

## 2. `summary-run-2026-11-15T03-19-34-525Z-29438.md` (verbatim)

```markdown
# Phase 0 run summary — run-2026-11-15T03-19-34-525Z-29438

Verdict: **PASS**

| Suite | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| P1-rerun | 9 | 9 | 0 | 0 |
| P1 | 9 | 9 | 0 | 0 |
| P3-rerun | 11 | 11 | 0 | 0 |
| P3 | 11 | 11 | 0 | 0 |
| backpressure-rerun | 1 | 1 | 0 | 0 |
| backpressure | 1 | 1 | 0 | 0 |
| sigkill-1-of-20 … sigkill-20-of-20 | 11 each | 1 each | 0 | 10 each |

Reconciliation: **PASS**
- OK journal-parseable — 30 entries ok
- OK no-negative-wallets — 1 wallets ok
- OK charges-have-attempts — 30 charged ops checked (live + archive)
- OK settle-equals-attempt-cost — 0 mismatches

Environment: node v22.23.5, postgres `unrecorded`, SDK `unrecorded`, image `unrecorded`.
```

(The sigkill rows are 20 identical rows, elided here only for width; the on-disk file lists all 20 individually. `unrecorded` is expected: the optional `PHASE0_PG_VERSION` / `PHASE0_SDK_VERSION` / `PHASE0_IMAGE` env vars were not set — image is intentionally unrecorded, Docker provenance is CI's.)

## 3. `reconciliation-run-2026-11-15T03-19-34-525Z-29438.json` (key content)

```json
{
  "at": "2026-11-15T03:21:07.311Z",
  "p1": { "eventsByStatus": [{ "status": "accepted", "n": 10 }], "executions": 10, "archivedGenerations": 0 },
  "p3": {
    "operationsByState": [{ "billing_state": "reserved", "n": 1 }],
    "attemptsByState": [{ "state": "uncertain", "n": 1 }],
    "attemptsArchived": 34,
    "settlements": [{ "kind": "reserve", "n": 1, "total": "100000" }],
    "wallets": [{ "agency_id": "ag-1", "balance_credits_micro": "900000" }],
    "providerCharges": 30,
    "providerLogEntries": 30
  },
  "invariants": [
    { "name": "journal-parseable", "pass": true, "detail": "30 entries ok" },
    { "name": "no-negative-wallets", "pass": true, "detail": "1 wallets ok" },
    { "name": "charges-have-attempts", "pass": true, "detail": "30 charged ops checked (live + archive)" },
    { "name": "settle-equals-attempt-cost", "pass": true, "detail": "0 mismatches" }
  ],
  "verdict": "PASS"
}
```

Console reconcile tail:

```
RECON-OK   journal-parseable — 30 entries ok
RECON-OK   no-negative-wallets — 1 wallets ok
RECON-OK   charges-have-attempts — 30 charged ops checked (live + archive)
RECON-OK   settle-equals-attempt-cost — 0 mismatches
reconciliation: PASS -> phase0/evidence/reconciliation-run-2026-11-15T03-19-34-525Z-29438.json
summary: PASS -> phase0/evidence/summary-run-2026-11-15T03-19-34-525Z-29438.md
```

## 4. Version evidence

```
SELECT version();
PostgreSQL 16.16 (Postgres.app) on aarch64-apple-darwin21.6.0, compiled by Apple clang version 14.0.0 (clang-1400.0.29.102), 64-bit

npm ls @dbos-inc/dbos-sdk --depth=0
└── @dbos-inc/dbos-sdk@5.5.0
```

(Node `v22.23.5`, vitest `v4.1.8`, per console headers.)

## 5. Per-suite pass/fail counts + durations

| Suite | Tests | Duration |
|---|---|---|
| unit (no DB) | 120/120 | 7.32s |
| P1 | 9/9 | 9.05s |
| backpressure | 1/1 | 4.62s |
| P3 | 11/11 | 3.95s |
| P1-rerun | 9/9 | 8.61s |
| backpressure-rerun | 1/1 | 4.75s |
| P3-rerun | 11/11 | 3.89s |

Reruns are identical to the first pass in both counts and test-level results. Suite total: **62/62 suite tests, 0 failed.**

## 6. SIGKILL tally — 20/20 PASS

All 20 iterations: `SUITE sigkill-<i>-of-20: PASS (total=11 passed=1 skipped=10)`, each running the single test `external SIGKILL mid-provider-call leaves exactly one charge, quarantined`. Durations 0.96–1.41s each. Zero failures across `sigkill-1-of-20` … `sigkill-20-of-20`.

## 7. Teardown report

```
run id: run-2026-11-15T03-19-34-525Z-29438 run_ids=[run-2026-11-15T03-19-34-525Z-29438,run-2026-11-15T03-19-34-525Z-29438-rerun] elapsed_s=103
cleaned: p1_business_event_discrepancy: dropped (created by this execution)
cleaned: p1_business_event: dropped (created by this execution)
cleaned: p1_business_event_generation: dropped (created by this execution)
cleaned: p1_domain_action: dropped (created by this execution)
cleaned: p1_execution_log: dropped (created by this execution)
cleaned: p2_probe_log: dropped (created by this execution)
cleaned: p3_attempt: dropped (created by this execution)
cleaned: p3_attempt_archive: dropped (created by this execution)
cleaned: p3_operation: dropped (created by this execution)
cleaned: p3_settlement: dropped (created by this execution)
cleaned: p3_wallet: dropped (created by this execution)
cleaned: phase0_ownership: this execution's ledger rows deleted
cleaned: phase0_ownership: dropped (created by this execution, now empty)
retained: (none)
```

Teardown exit 0, FK-ordered: 11 prototype tables + ownership ledger dropped, nothing retained. DB left running per B-6 (`127.0.0.1:5433`, 0 prototype tables, 0 ledger rows) — re-verified after the run by a `SELECT version()` query against it.

## 8. B-4 redaction check

```
grep -rE "password=|://[^ /]+:[^ @/]+@" phase0/evidence/ | grep -v "<redacted>" ; echo "redaction-check done (no output above = clean)"
redaction-check done (no output above = clean)
```

Clean — no output above the marker. No `phase0/.env` content appears anywhere in this report.

## 9. Artifacts

**30 files** under `phase0/evidence/` for execution id `run-2026-11-15T03-19-34-525Z-29438`: `native-provision`, `provider` (.jsonl), `reconciliation`, `summary`, 6 named suite reports, and 20 `suite-sigkill-<i>-of-20` reports — exactly the B-4 set.

## 10. Root causes found and fixed (four, all uncommitted)

1. **`phase0/provisioners/native.ts` — blind cast vs `text[]`.** `r.rows as HbaRuleRow[]` assumed shaped rows, but PostgreSQL returns the hba query as `text[]`. Fixed at the DB boundary with an exported, unit-tested `toHbaRuleRow()` normalizer (not SQL casts), which also added the unit tests taking 111 → 120.
2. **`phase0/p1/worker.ts` — phantom `{workflowRunTag}` input.** No producer ever supplies `workflowRunTag`, so the insert got NULL → SQLSTATE 23502 → 40 `ERROR` workflows with NULL `error` (the real error only in `dbos.workflow_output`) → 6× `timed out waiting for execution`. The step now keys on the durable `DBOS.workflowID`. Diagnostic gap closed: `phase0/test-env.ts` now forwards worker stderr as `[p1 worker] …`.
3. **`phase0/p3/wallet.ts:251` — untyped `jsonb_build_object` params.** Produced SQLSTATE 42P18 (ambiguous type): crash-3 threw the SQL error and crash-4 exited 1 instead of the expected 137. Fixed with explicit `$2::text`, `$3::bigint`. (3b) **`planNativeTeardown` was FK-unaware** — drops are now FK-ordered, with retain-with-blocker reporting instead of a mid-teardown FK error.
4. **Reconcile ran run-wide against a fixture that `TRUNCATE`s `p3_attempt` per test.** Fixed as *evidence preservation*, not by weakening the `charges-have-attempts` invariant: new `p3_attempt_archive` table + `BEFORE TRUNCATE` trigger, and reconcile reads live ∪ archive — hence `attemptsArchived: 34` and "30 charged ops checked (live + archive)".

## 11. Failure history preserved (not deleted, not rerun with different flags)

- `run-2026-11-15T02-30-13-963Z-26977` — exit 2 (infra refusal), then exit 1 after correction; artifacts retained under `phase0/evidence/`.
- `run-2026-11-15T02-59-51-741Z-28378` — all tests green, **reconcile FAIL** (the run-wide-journal vs per-test-TRUNCATE defect above); artifacts retained.

## 12. Notes for the owner

- **No verdict issued here.** This report is evidence only; reconciling it into `phase0/EVIDENCE_MATRIX.md` and issuing LOCAL PASS / LOCAL FIX / LOCAL BLOCKED is owner-only. Docker-image provenance stays BLOCKED by design until CI.
- `phase0/evidence/RUNTIME_VERDICT.md` and `ENVIRONMENT.md` still record the stale `EPERM` verdicts ("no database server can start here") — **disproven**: PostgreSQL 16.16 runs fine on this machine and this run executed fully against it.
- Full redacted console log available at `/private/var/folders/5n/djf8r0xs1l9f8n8_g1wqp0t80000gn/T/opencode/trackb.log` (456 lines, redaction-checked).
