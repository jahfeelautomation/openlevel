## Goal

Implement `docs/plans/prompt6.md`: provision disposable local PostgreSQL for Gate C, execute the P1 (8 cases), P3 (4 crashes + extras), and backpressure proofs on real infrastructure, complete the supply-chain audit trail, keep P2 at prep-only, and deliver the test matrix plus Phase 0 report with a PROCEED/FIX/STOP verdict. No architecture review, no V2.1 edits, no Phase 1.

## Success Criteria

- Local PostgreSQL running user-locally (loopback-only, random credentials, dedicated role/database, exact version recorded), or a documented blocker with the Neon-fallback approval request as the only escalation.
- P1: all 8 acceptance cases pass with quoted evidence — including barrier-coordinated concurrency (not just `Promise.all`), reuse-behavior proof against SDK 5.5.0, status projection after history deletion, 409-on-hash-mismatch, and tombstone-expiry following an explicit defined-as-new policy (handler gains the expiry branch it currently lacks).
- P3: all 4 crash tests pass via real process termination with the 7-field evidence set (provider charges, operation/attempt IDs, reservation/settlement counts, balance, no blind repeat); exhaustion never negative; sweeper provably cannot refund dispatched/uncertain operations.
- Backpressure: saturation test executed with pool size, contender count, timeouts, response distribution, committed counts, and retry-convergence proof.
- `phase0/evidence/LOCKFILE_AUDIT.md` committed (sanitized): all 18 restored hashes mapped to package/version/URL/artifact with verification method.
- Test matrix (7 columns × every case) and 9-item Phase 0 report delivered under `phase0/`; V1/V2/V2.1, plans, and app code byte-identical; only `phase0/` files are new.

## Approach

Build on the accepted baseline — no re-runs without cause. Provisioning follows a least-complexity ladder since this machine has no package manager, Docker, or Postgres (but does have Xcode CLT and network): (1) `embedded-postgres` via npm in `/tmp` (no sudo, version-pinned); (2) Postgres.app binaries copied user-local; (3) compile from source; (4) throwaway Neon branch only with explicit billing/auth approval. All database credentials stay in process-local env (`PHASE0_DATABASE_URL`), data/logs under `/tmp`, and every test asserts its target is a disposable database before any destructive setup. Missing test code (expiry branch + test, barrier coordination, backpressure suite, sweeper-explicit test) is written before execution; nothing is marked PASS without observed output.

## Steps

1. **Gate C provision.** Walk the ladder; initdb + start loopback-only cluster; create restricted runtime role and bootstrap role; record exact PG version; smoke-test connectivity; write down the fallback decision if local fails.
2. **Supply-chain close-out.** Extend the audit to assert each restored hash against name/version/URL/artifact; commit the sanitized comparison table; confirm no other lockfile drift and no dependency changes beyond the approved SDK pin.
3. **P1 completion.** Add the expiry branch (expired tombstone → defined-as-new per trigger policy) plus its test; convert tombstone `test.todo` to a real test; add reuse-behavior proof and status-projection (history-deletion) tests; harden the race with a barrier release; execute worker + suite; capture row/workflow counts and timings.
4. **P3 completion.** Verify each test asserts all 7 evidence fields; add the explicit sweeper-safety test; execute with real kills; capture provider-log vs. ledger comparisons.
5. **Backpressure suite.** New test: small pool + acquisition timeout, N-way concurrent handler flood, assert retryable failures, no silent drops/acks, retry convergence via the P1 idempotency contract; record the full measurement set.
6. **P2 prep verification.** Audit existing `phase0/p2/` artifacts against prompt6 §7 (scripts, config proposal, health/readiness spec, evidence procedure); fill documentation gaps only; mark all staging proofs BLOCKED-pending-Gate-D. No deploys, no billable resources.
7. **Matrix + report + tree audit.** Fill the 7-column matrix from observed runs; write the 9-item report with the verdict and V2.1 fix list (demonstrated-only); verify via `git status`/`diff` that only `phase0/` changed since the approved baseline delta.

## Validation Plan

- Each P1/P3/backpressure bullet traced to a named test with quoted output; BLOCKED/NOT RUN marked explicitly, never implied.
- Banned outcomes: plain-`enqueue()` swaps, SDK type casts, silent drops or pre-commit acks, auto-retry of uncertain attempts, PGlite substitution, production-database targets, credentials in output or commits, any file outside `phase0/`.
- `git status` before/after: only `phase0/` files are new; docs and app code byte-identical.
- Highest-risk validation: the concurrent-duplicate race proof and the provider-accepted-then-crash proof — the two mechanisms everything else rests on.

## Risks / Open Questions

- If local provisioning fails at every ladder rung, Gate C becomes a single narrow approval (throwaway Neon branch) with cost/cleanup stated — the only planned stop.
- `deleteWorkflow` availability and exact reuse runtime behavior are verified against the installed 5.5.0 at execution; any deviation becomes a finding, not a workaround.
- The pre-existing `vault.test.ts` failure stays red and untouched; any new failure is reported independently as a regression.
- No blocking open questions for starting: Steps 1–2 need no approval, and owner input is required only at the two named gates (Neon fallback, Gate D staging).
