# Remediation Report — ADVERSARIAL_REVIEW.md findings

Implements `docs/plans/review.md`. All changes under `phase0/` only.
Environment: node v22.23.5 user-local, SDK 5.5.0 pinned, no live database
(sandbox denies `bind`/`shmget` — DB-backed proofs stay owner-side BLOCKED).

## Dispositions — MAJOR (all CONFIRMED by source inspection, all FIXED in code)

| ID | Disposition | Fix location | Verification |
|---|---|---|---|
| M-01 | CONFIRMED → FIXED | `phase0/db-guard.ts` rewrite | 24-case unit table green (executed); live addr/port check code-complete BLOCKED |
| M-02 | CONFIRMED → FIXED | guard calls in worker/runner/probes/setup + `verifyLiveIdentity` | typecheck clean; live paths BLOCKED |
| M-03 | CONFIRMED → FIXED | `run-all.sh` derives `phase0_rt` URLs; setup grants TRUNCATE + sequences; preflight proves role | code-complete BLOCKED; preflight unit logic in guard tests |
| M-04 | CONFIRMED → FIXED | `phase0/tsconfig.json` + matrix verbatim command | `npx tsc -p phase0/tsconfig.json --noEmit` → zero errors (executed) |
| M-05 | CONFIRMED → FIXED | `PHASE0_RUN_ID` in runner + key prefixing in P1 tests; rerun procedure in runbook | code-complete; second-run proof is owner-side |
| M-06 | CONFIRMED → FIXED | `P1-REUSE` delete-then-resubmit test | code-complete BLOCKED |
| M-07 | CONFIRMED → FIXED | `p1_domain_action` synthetic mutation + 4-way absence assertions | code-complete BLOCKED; table names verified in SDK 5.5.0 |
| M-08 | CONFIRMED → FIXED | `recoverStaleAttempts` + runner exit-3 refusal + reconcile report | code-complete BLOCKED |
| M-09 | CONFIRMED → FIXED | lease transition + `ProviderTimeoutError` path (dead mode-branch removed) | code-complete BLOCKED |
| M-10 | CONFIRMED → FIXED | locked recheck + rowcount guard + NULLS NOT DISTINCT dedup + `ConflictError` + race test | code-complete BLOCKED |
| M-11 | CONFIRMED → FIXED | atomic sweeper rewrite + 2 barrier tests + per-row logging | code-complete BLOCKED |
| M-12 | CONFIRMED → FIXED | dual precondition (row + charge) | code-complete BLOCKED; 20× loop documented for owner run |
| M-13 | CONFIRMED → FIXED | shared client + explicit pool size + backend census ≤ 8 | code-complete BLOCKED |
| M-14 | CONFIRMED → FIXED | reserve counts, actual-cost settle, balance asserts in all crash tests | code-complete BLOCKED |
| M-15 | CONFIRMED → FIXED | regenerated audit + `LOCKFILE_PAIRS.md` + `verify-lockfile.mjs` | script executed: all 18 OK (registry == tree, HEAD differs) |
| M-16 | CONFIRMED → FIXED | runbook §2b five-check verification + evidence rule | procedural; owner executes |

## Dispositions — MINOR (all FIXED)

m-01 loser-status asserts; m-02 `httpStatusForOutcome` + unit test (green);
m-03 deterministic two-connection vanish test; m-04 worker log through
redact pipe; m-05 per-suite JSON markers + abort behavior; m-06 all rows
padded (verified: every data row now has 8 pipes); m-07 query-param
redaction + unit tests (green); m-08 exact-name cleanup + role drop +
password rotation on setup; m-09 READMEs refreshed (counts, commands,
status); m-10 per-row sweeper logging; m-11 `p2/schema.sql` + setup
application; m-12 tree-delta wording made exact; m-13 real after-settle
kill + balance asserts; m-14 zero-execution guard verified (skip-only
suite fails the checker, green suite passes).

## Dispositions — INFORMATIONAL

i-01 overlap sampler implemented (maxActive ≥ 2); i-02 23505 →
`ConflictError` in reserve; i-03 dead mktemp line removed; i-04 Node
prerequisite + install path in runbook; i-05 grants documented
per-permission in setup; i-06 covered by synthetic domain mutation
(M-07); i-07 comment fixed to 4s.

## Review-directive compliance (review.md §§1–11)

- §1 acceptance criteria: all 16 MAJOR closed in code with demonstrating
  tests; deferred items (DB execution, 20× SIGKILL, rerun-twice) named
  with owners (owner local run).
- §2 DB safety: guard table + entrypoint coverage complete.
- §3 P1: reuse/rollback/retention proofs complete as code.
- §4 P3: state machines + crash matrix complete as code.
- §5 backpressure: bounded shared client + census complete as code.
- §6 audit trail: regenerated from `git show HEAD` + committed script.
- §7 P2: prep-only preserved; restart policy verified from official docs;
  probe schema added; no staging touched.
- §8 process: sequential order followed; independent validation recorded
  per finding above (no blind copying — e.g. m-06 re-verified by recount,
  M-13 pool default confirmed in installed source, not assumed).
- §9 checks run here: typecheck clean; 26 unit tests green; JSON-reporter
  flow verified both directions; `lint` N/A (no script exists; adding one
  would breach the phase0/-only boundary); DB suites NOT RUN (sandbox).
- §10 boundary: `git status` delta unchanged in kind — only `phase0/`
  files added/modified since the approved baseline; no app/docs edits;
  no advisory locks; no new services; no `latest` pins.

## Addendum — review2 implementation sweep (2026-11-14)

Static defects found by adversarial re-read and fixed in `phase0/`
(all typechecked; DB-independent assertions executed):

- run-all.sh captured sed's PID instead of the worker's (orphaned worker
  on cleanup) → temp raw file + trap redaction; preflight now runs in two
  phases (bootstrap, then runtime role after setup creates it).
- Backpressure census conflated worker/test pools and could not observe
  DBOS sharing → tagged-backend census (≤ pool max) + shared-client
  creation counter (== 1).
- Setup grants for `dbos` now use the SDK's own `grantDbosSchemaPermissions`
  (versioned with the SDK) instead of a hand enumeration that could miss
  rights; internal imports verified resolvable.
- dispatchAttempt pre-gate (state check + budgets + attempt insert) moved
  into one operation-locked transaction, closing the sweep-vs-dispatch race;
  unique violations map to ConflictError.
- settle refuses non-reserved/settled states and rejects amount mismatches
  (first settle wins, verified by re-read).
- Runner exits 4 (not 0) on stalled/uncertain outcomes.
- P1 expiry-race losers, vanish-branch reachability, and renewal archive
  semantics re-verified by code tour; handler nits fixed (timestamp type,
  dead marker export).
- Matrix aligned to review2's canonical eight P1 rows with bullet maps;
  supplementary rows marked as such.

## Remaining BLOCKED (owner local run, runbook ready)

All P1/P3/backpressure DB tests, rerun-twice, 20× SIGKILL, listener/auth
verification, and the final Phase 0 verdict. Nothing is marked PASS
without execution.
