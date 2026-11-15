# Independent Adversarial Review — Deterministic P1 Concurrency Proof

Review assignment: `docs/plans/prompt17.md`. Reviewer: independent senior architect (not the
implementation agent).
Subject: branch `phase0/automated-testing`, HEAD `de76b2e`, uncommitted working tree
(5 modified files: `.gitignore`, `package.json`, `phase0/EVIDENCE_MATRIX.md`,
`phase0/p1/p1.test.ts`, `phase0/provisioners/types.ts`; 2 new files:
`phase0/p1/race-observer.ts`, `phase0/p1/race-observer.test.ts`).
Review mode: read-only; no commits, no pushes, no Docker, no database operations, no `.env`
access, no source modification. Previous CI failure baseline: `43688018842`.

---

## A. Executive verdict

**READY FOR OWNER-MANAGED PUSH — LIVE P1 PROOF PENDING**

The new proof is technically sound: it observes genuine PostgreSQL lock contention (blocked
backends on the uncommitted unique insert) rather than inferring overlap from sampling, the
winner barrier structurally cannot hold losers, every failure path releases and drains, and all
twelve regression tests are properly scoped. No CRITICAL or MAJOR defect exists. One INFO
hardening note below. Live P1 proof (9/9, reconciliation, cleanup) still requires the
owner-authorized CI run.

---

## B. PostgreSQL contention detection

Sound. `selectContendingBackends` (`phase0/p1/race-observer.ts:38`) requires same database,
exact contender application name, `state = 'active'`, query containing
`INSERT INTO p1_business_event`, non-empty `blockers`, distinct PIDs via `Set`, and
observer-PID exclusion. Each conjunct verified: the fragment matches `phase0/p1/handler.ts:132`
INSERT text at offset 0 (inside the `left(query, 300)` window); a lock-blocked INSERT reports
`state = 'active'` per PostgreSQL semantics; `ON CONFLICT DO NOTHING` losers wait on the
winner's speculative insertion, so `pg_blocking_pids` is non-empty exactly for genuinely
contending losers. No `wait_event` value is in the acceptance predicate — wait fields are
diagnostic-only, as required. Self-exclusion is triple-redundant (SQL `pid <> pg_backend_pid()`,
`selfPid` param, distinct observer application name), and the observer pool's `max: 1` with
sequential queries keeps `selfPid` stable.

Permissions hold under the actual runtime role: observer and contenders connect with the same
URL/role, so same-role `query` text is visible in `pg_stat_activity`; `pg_blocking_pids` is
`PUBLIC`-executable; no superuser is needed. (Established from PostgreSQL documented semantics;
behaviorally confirmed in CI.) No unrelated session can satisfy the threshold: the worker and
shared pools never carry the contender application name and never run the business-event INSERT.
Sequential execution cannot false-accept — a lone active INSERT has empty `blockers`, pinned by
the broken-constraint-detector unit test — so the CRITICAL false-accept criterion is met. The
threshold (≥2) plus the convergence assertions (1 accepted, 7 duplicates on one UUID, 1 row,
1 execution, live SUCCESS status) jointly prove contention plus correct serialization.

---

## C. Winner barrier and synchronization

Correct, with the strongest possible structural property: `afterInsert` fires **only on the
winner path** (`phase0/p1/handler.ts:229`, inside the `row` branch, in-transaction, before
enqueue/COMMIT). Losers never call it, so the barrier cannot hold every contender — that failure
mode is impossible by construction, not by timing. The winner is identified by first arrival at
the hook, which coincides with the unique inserter. Losers block inside their INSERT (same key,
winner's transaction open) and can reach the duplicate path only after release, when the gate is
already open. No path commits or rolls back the winner prematurely: the hook awaits `winnerGate`
before enqueue/COMMIT, `acquireTimeoutMs` is unset (no bounded-acquire rejection), and stock
PostgreSQL disables `idle_in_transaction_session_timeout` by default. If the winner's transaction
died mid-hold (infra fault only), another contender would win and re-hold — self-healing, and any
residual damage fails loudly, never hangs or false-passes.

---

## D. Pool independence

Genuine. Contender pool (`max: 5`, `p1-race-contender`) and observer pool (`max: 1`,
`p1-race-observer`) are separate `Pool` instances; the observer can never queue behind
contenders. `application_name` is a valid pg pool option (verified in installed `@types/pg`).
Capacity guarantees the observation opportunity: FIFO acquire grants 5 backends (1 winner
idle-in-transaction + up to 4 INSERT-blocked losers), exceeding the ≥2 threshold with margin,
while 3 racers queue harmlessly at the application level. Polling until a 15s deadline removes
all timing luck — losers stay blocked indefinitely while the winner is held.

---

## E. Cleanup and error propagation

All paths traced safe. Success: release → `Promise.all` → assertions → `finally` ends both
pools. Observer timeout/SQL error: `catch` releases the winner, `allSettled` drains every racer,
and if the winner never arrived with a racer rejection present, the error is enriched with the
racer's reason before rethrowing. Winner-fails-before-`afterInsert`: nothing is held, remaining
racers elect a new winner, or the catch path reports the rejection — no hang. `Promise.all` /
`allSettled` subscribe to every racer, so no unhandled rejections. Observer errors propagate (no
`try/catch-break`, no zero-swallowing — the old shape is gone file-wide). The deadline bounds
every iteration, and timeout errors carry the winner-arrived flag plus a full snapshot
distinguishing all five required diagnostic cases (no contenders, pool queuing, lock-blocked,
permission failure, unexpected sessions/queries). `pool.end()` in `finally` waits for
checked-out clients, so no straggler can race the next test's TRUNCATE.

### INFO-1 (hardening, non-blocking)

| Field | Content |
|---|---|
| **Severity** | INFO (defense-in-depth; no plausible hang vector) |
| **File:line** | `phase0/p1/p1.test.ts:60-101` (`observeContenders`; observer query at `:69-75`) |
| **Root cause** | The observer query has no `statement_timeout`, so the deadline bounds iterations but not a single hung query. |
| **Consequence** | None plausible: a `pg_stat_activity` SELECT takes no locks contenders hold and cannot block on them; connection-level failures reject rather than hang. |
| **Evidence** | Source-proven (no timeout option set); PostgreSQL documented semantics for the non-blocking claim. |
| **Smallest durable correction** | `statement_timeout: 5000` on the observer pool options. |
| **Required regression test** | None (unit level cannot exercise it); CI behavior unchanged either way. |
| **Blocks push** | NO. |

---

## F. Regression-test independence

All twelve classified: **8 behavioral unit tests** (two-blocked selection, self-exclusion,
database isolation, application-name isolation, idle rejection, unrelated-query rejection,
no-blockers rejection, PID dedup); **1 diagnostic formatting test** (snapshot columns + empty
case); **1 fake-pool mechanism reproduction** (FIFO starvation: queued sampler observes nothing
during the window, observes only after — mechanism-faithful to `pg.Pool` semantics; the file
header properly disclaims historical-cause proof); **1 mechanism-shape demonstration**
(swallow-into-zero loop); **1 source-structure guard** (sampler absence,
`pg_blocking_pids`/`allSettled`/`releaseWinner` presence). The grep test is supplementary
protection, not runtime proof — exactly as prompt17 requires, and the test file's own discipline
note agrees. No test claims more than it proves.

---

## G. Cross-cutting invariants and validation

`handler.ts` is unmodified (absent from git status); the `P1Deps.hooks` interface pre-existed,
so no production synchronization was introduced — `winnerGate` is test-local. Enqueue semantics,
workflow identity, uniqueness, duplicate/conflict/rollback/tombstone behavior, P3, provider
uncertainty, and backpressure are untouched (only `p1.test.ts`, registration, script, and matrix
changed, plus the two new files). Executed with user-local Node v22.23.5: phase0 typecheck exit
0, root typecheck exit 0, `npm run test:phase0:unit` **162/162 across 7 files**
(58+2+12+4+4+26+56 — exactly the matrix claim; new file 12/12). Script verified
Docker/database-free.

---

## H. Remaining live CI requirements

CI run must prove: P1 9/9 (including this rewritten race test observing ≥2 blocked backends),
backpressure 1/1, P3 11/11, reconciliation 4/4, summary PASS, and container cleanup. Live
confirmation will also settle the permission/predicate behavior against real `pg_stat_activity`
output. Nothing in this review substitutes for that run.

---

## I. One next owner action

Manually commit and push `phase0/automated-testing` to trigger the integration run (CI failure
`43688018842` is the baseline this remediation answers), then read the race test's
observed-backend count and the reconciliation verdict from the CI log.
