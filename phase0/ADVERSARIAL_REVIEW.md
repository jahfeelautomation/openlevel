# Independent Adversarial Code Review — OpenLevel Phase 0 Implementation

Produced per `docs/plans/prompt7.md`. Review only; no application code, V1/V2/V2.1,
or planning documents were modified. This file is the prompt7 §6 deliverable.

**Scope reviewed:** every file under `phase0/` (2,425 lines), `tsconfig.json`,
`.gitignore`, `git status`, and the installed SDK sources for
`@dbos-inc/dbos-sdk@5.5.0` and `pg@8.21.0` (including `client.js`,
`system_database.js`, `workflow_management.js`, `pg-connection-string/index.js`,
`connection-parameters.js`).

**Method limitation (disclosed):** no Node.js runtime exists on this machine
(no `node`/`npm` binary on disk; the prior toolchain per `BASELINE_RUNBOOK.md`
lived in `/tmp` and did not survive). Typecheck and test execution could not be
re-run during this review; all findings are static analysis against source.
Consequently, "phase0 typechecks cleanly" and all BLOCKED Gate C rows remain
**unverified**, not disproven.

**Verdict: FIX BEFORE EXECUTION** — 0 BLOCKER, 16 MAJOR, 14 MINOR, 7 INFORMATIONAL.
Prompt7 §7 requires MAJOR findings affecting database safety, atomicity,
recovery correctness, or evidence validity to be fixed or explicitly resolved
before the owner executes the local runbook. All four categories are hit.

---

## Confirmed MAJOR findings

### M-01 · Database guard validates only the database name — no host, query-param, or connection-option checks

1. **Severity:** MAJOR (database safety — prompt7 §1 highest priority).
2. **Location:** `phase0/db-guard.ts:34-44` (name pattern only);
   `phase0/db-guard.ts:47-70` (live check compares only `current_database()`);
   destructive points use the static check only — `phase0/setup-db.ts:32`,
   `phase0/p1/p1.test.ts:50`, `phase0/p1/backpressure.test.ts:34`,
   `phase0/p3/p3.test.ts:52`.
3. **Failure scenario:** (a) `PHASE0_DATABASE_URL=postgres://u@any-host:5432/phase0_proofs`
   passes every check — including `connectGuarded`'s "live identity check" — as long
   as a database of that name exists on that host. (b) `pg` honors query-string
   overrides: `?host=` beats the URI hostname
   (`node_modules/pg-connection-string/index.js:40-42,54-56`), and `?options=` is
   passed into the startup packet (`node_modules/pg/lib/connection-parameters.js:83,139`),
   enabling `?options=-csearch_path=…` to redirect every unqualified
   `p1_*`/`p3_*`/`TRUNCATE` statement. (c) Non-`postgres` schemes (`https://`)
   parse identically because `pg` ignores the protocol. This also contains the
   explicit preflight→connection TOCTOU prompt7 §1 asks about: preflight
   (`phase0/preflight.ts:10`) live-checks once in a separate process; setup and
   tests never re-verify live identity.
4. **Why the current implementation does not prevent it:** `PROD_MARKERS` and
   `REQUIRED_PATTERN` only ever inspect the URL path segment. Nothing pins
   loopback, rejects unknown query params, or re-checks live identity before
   `TRUNCATE`/`GRANT`/schema creation.
5. **Smallest correction:** in `assertDisposableUrl`: (1) allowlist host ∈
   {`localhost`,`127.0.0.1`,`::1`} or `PHASE0_ALLOWED_HOSTS`; (2) reject any URL
   query parameter outside an allowlist (e.g. `sslmode`); (3) call
   `connectGuarded()` (live check) in `setup-db.ts` and in each test's
   `beforeEach` instead of the static-only check.
6. **Demonstrating test:** table-driven unit test over `assertDisposableUrl` —
   `?host=evil`, `?options=…`, `%2f` smuggling, uppercase scheme, IPv6, foreign
   host, unix-socket path must all throw; plus one integration case pointing
   setup at a second local instance — must refuse before any `TRUNCATE`/`GRANT`.

### M-02 · `worker.ts`, `runner.ts`, and `probe-workflows.ts` run with no database guard at all

1. **Severity:** MAJOR (database safety).
2. **Location:** `phase0/p1/worker.ts:21-24,43-45`; `phase0/p3/runner.ts:16`;
   `phase0/p2/probe-workflows.ts:12-14`; manual invocation instructed by
   `phase0/p1/README.md:30`.
3. **Failure scenario:** a typo'd `P1_DATABASE_URL` pointing at any database
   (production included) → `DBOS.launch()` + `DBOS.registerQueue('p1')`
   create/mutate the DBOS system schema and queue rows on that target, and
   `p1-echo` inserts into `p1_execution_log` on execution.
4. **Why not prevented:** `run-all.sh` is only *transitively* safe (preflight
   checks `PHASE0_*` then re-exports it); the entrypoints themselves never call
   `assertDisposableUrl`. Prompt7 §1: "Database identity is checked before every
   destructive setup or cleanup operation."
5. **Smallest correction:** first statement in each entrypoint:
   `assertDisposableUrl(url, '<ENV>')` (three lines; `db-guard.js` already ships
   in the package).
6. **Demonstrating test:** `P1_DATABASE_URL=postgres://x/postgres node --import tsx phase0/p1/worker.ts`
   → must exit non-zero with the refusal message before any DBOS activity.

### M-03 · The "restricted runtime role" is never used; tests run as bootstrap superuser — and its grants cannot even support the tests

1. **Severity:** MAJOR (database safety / prompt6 §2 compliance).
2. **Location:** `phase0/run-all.sh:19-20` (`P1_DATABASE_URL="$PHASE0_DATABASE_URL"`
   — the OS-superuser URL from `LOCAL_POSTGRES_RUNBOOK.md` §2:65);
   `phase0/setup-db.ts:56-63` (grants for `phase0_rt` contain no `TRUNCATE`);
   `phase0/p1/p1.test.ts:53`, `phase0/p3/p3.test.ts:55` (tests `TRUNCATE`).
3. **Failure scenario:** the entire least-privilege apparatus (prompt6 §2
   "dedicated database **and role**"; §1 "runtime role has only the privileges
   required by the tests", "bootstrap privileges are not accidentally retained")
   is dead code in the proof run: every `TRUNCATE`/`GRANT`/`ensureSystemDatabase`
   executes as the bootstrap superuser. If the tests *were* pointed at
   `phase0_rt`, `TRUNCATE` would fail — proving the grants were never aligned
   with what the tests need.
4. **Why not prevented:** the runbook creates the role and setup grants it, but
   no runner ever connects as `phase0_rt`; nothing asserts the role is used.
5. **Smallest correction:** export separate `P1/P3_DATABASE_URL` values for
   `phase0_rt` (credentials via env), and grant `TRUNCATE` on the prototype
   tables (or switch tests to `DELETE`); alternatively explicitly downgrade the
   claims and document bootstrap-only execution.
6. **Demonstrating test:** run one suite as `phase0_rt`; evidence row recording
   `current_user` and `pg_has_role('phase0_rt', …)` for the test connection.

### M-04 · B-COMPILE evidence row is not reproducible; `npm run typecheck` does not cover `phase0/` at all

1. **Severity:** MAJOR (evidence validity).
2. **Location:** `tsconfig.json` (`include: ["src","server","db"]` — no
   `phase0`); `phase0/EVIDENCE_MATRIX.md:21` (`npx tsc --ignoreConfig … phase0/…`
   with elided flags and elided file list; "Environment: tsc strict" is
   unverifiable because `--ignoreConfig` bypasses tsconfig — strictness came
   from flags the record does not show); `phase0/p1/README.md:27` claims
   `npm run typecheck` is the gate (it typechecks zero phase0 files).
3. **Failure scenario:** prompt7 §5 requires reproducible command records; a
   reviewer or the owner re-running the recorded command cannot reproduce the
   claimed gate. Any latent type error in `phase0/` escapes the documented
   green baseline. (The reviewer could not re-execute either — no runtime — so
   "phase0 typechecks" is carried as **unverified**.)
4. **Why not prevented:** no checked-in tsconfig or script covers `phase0/`;
   the matrix row abbreviates the command into ellipses.
5. **Smallest correction:** add `phase0/tsconfig.json` (or a `typecheck:phase0`
   package script) with the exact options; quote that one-line command verbatim
   in the matrix.
6. **Demonstrating test:** run the recorded command → exit 0, zero errors.

### M-05 · The proof suite is not re-runnable against a retained database — second run deterministically fails

1. **Severity:** MAJOR (evidence validity / reproducibility).
2. **Location:** `phase0/p1/p1.test.ts:52-54` (truncates `p1_*` but never
   `dbos.*`); deterministic IDs at `phase0/p1/handler.ts:56-63`; installed SDK
   upsert is a no-op for existing rows
   (`node_modules/@dbos-inc/dbos-sdk/dist/src/system_database.js:4531-4536` —
   an existing `SUCCESS` workflow is never re-enqueued or re-executed);
   `waitForExecution` timeout at `phase0/p1/p1.test.ts:65-72`.
3. **Failure scenario:** run `bash phase0/run-all.sh` twice (runbook §5 presents
   it as repeatable; setup is advertised "idempotent"). Second run: winner-path
   enqueue returns the existing `SUCCESS` workflow, `p1_execution_log` was just
   truncated and stays empty, `waitForExecution` times out after 30 s →
   P1-RACE, P1-DONE, P1-RETAIN, P1-EXP all FAIL despite correct code.
4. **Why not prevented:** nothing purges or re-keys DBOS workflow history
   between runs; the runbook never requires dropping the scratch database.
5. **Smallest correction:** add a runbook line "DROP + recreate `phase0_proofs`
   between evidence runs", **or** a guarded
   `TRUNCATE dbos.workflow_status, dbos.workflow_input, dbos.workflow_output, dbos.operation_outputs`
   in `beforeEach`.
6. **Demonstrating test:** execute `run-all.sh` twice end-to-end; both runs must
   pass.

### M-06 · `workflowIDReusePolicy` runtime behavior is never exercised — and the matrix claims the wrong test will prove it

1. **Severity:** MAJOR (evidence validity).
2. **Location:** `phase0/EVIDENCE_MATRIX.md:34` ("runtime acceptance still needs
   Gate C run of P1-RACE"); duplicate path never enqueues
   (`phase0/p1/handler.ts:144-216`); SDK reuse branch
   (`system_database.js:1257-1261`).
3. **Failure scenario:** duplicates skip enqueue entirely, and the winner
   enqueues each fixed ID exactly once per clean run — so **no test in the
   suite ever reaches the SDK's reuse-policy branch**. P1-RACE (and its
   execution-log count) is structurally incapable of proving P1-REUSE's runtime
   half; reuse semantics (`return-existing` on an already-existing workflow)
   ship unproven while the matrix says they are covered by the planned run.
4. **Why not prevented:** the test asserts execution count == 1, which the
   reuse policy itself would also produce — the observation cannot distinguish
   "one enqueue" from "N enqueues deduped by the SDK".
5. **Smallest correction:** dedicated test: `DELETE FROM p1_business_event WHERE business_key=$1`
   (keep DBOS history) → `handleEvent` again → winner path re-enqueues the same
   fixed ID → assert `dbos.workflow_status` row count still 1,
   `p1_execution_log` count still 1, outcome `accepted`.
6. **Demonstrating test:** that test (fails if the SDK silently created a second
   workflow or re-executed).

### M-07 · Rollback test (P1 acceptance case 3) never asserts workflow absence

1. **Severity:** MAJOR (atomicity proof validity).
2. **Location:** `phase0/p1/p1.test.ts:111-128` — lines 126-127 are a *comment*
   ("Workflow absence is asserted via DBOS client getStatus == not-found");
   no such assertion exists.
3. **Failure scenario:** if enqueue were ever moved to a separate connection (a
   plausible refactor), rollback would leave a committed workflow while the
   business row vanished — the test still passes. The fault hook placement
   (`phase0/p1/handler.ts:219-226`, enqueue *before* `beforeCommit`) is ideal
   for catching exactly this; only the assertion is missing.
4. **Why not prevented:** the test checks only `p1_business_event` count == 0.
5. **Smallest correction:** `SELECT count(*) FROM dbos.workflow_status WHERE workflow_uuid = $1`
   → expect 0 (also `dbos.workflow_input`).
6. **Demonstrating test:** the added assertions themselves (would fail against a
   deliberately separated enqueue connection).

### M-08 · There is no recovery process — and the actual recovery path (re-running the runner) *would* repeat the provider operation

1. **Severity:** MAJOR (recovery correctness).
2. **Location:** `phase0/p3/wallet.ts:112-119` (counts prior attempts as budget
   but performs no `dispatching → uncertain` inspection);
   `phase0/p3/runner.ts:29` (dispatches unconditionally on re-run);
   `phase0/p3/p3.test.ts:105-109` (substitutes a manual in-test `settle()` for
   "recovery").
3. **Failure scenario:** crash-3 state (`dispatching`, provider already charged)
   → operator or CI re-runs `runner.ts` → `prior.n = 1 < max 3` → **attempt 2 →
   second provider charge**. Prompt6 case 3 requires "recovery inspects the
   persisted attempt first; it does not repeat the provider operation." The code
   contradicts the claim; the test sidesteps it.
4. **Why not prevented:** there is no attempt-state inspection anywhere in the
   runtime; the test's "recovery" is a direct `settle()` call that never
   exercises the path an operator would actually run.
5. **Smallest correction:** at runner start: if any attempt for the operation is
   `dispatching` → mark it `uncertain`, refuse to dispatch, exit with a
   reconcile report (no new attempt, no provider call).
6. **Demonstrating test:** after crash-3, re-run the runner: assert
   `countCharges(op) == 1`, attempt-row count == 1, state `uncertain`, zero new
   provider-log entries.

### M-09 · Stale `dispatching` never *becomes* `uncertain`; the test accepts the unproven state; the "timeout → uncertain" branch is dead code

1. **Severity:** MAJOR (recovery correctness / test validity).
2. **Location:** `phase0/p3/p3.test.ts:90` accepts `['dispatching','uncertain']`
   — prompt6 case 2 requires the attempt **becomes uncertain**;
   the only `→ uncertain` writes are the unreachable branch at
   `phase0/p3/wallet.ts:137-143` and a *manual* test UPDATE at
   `phase0/p3/p3.test.ts:210`.
3. **Failure scenario:** an attempt stuck in `dispatching` forever is
   quarantined only by accident of the sweeper's `NOT EXISTS` clause. No lease
   or transition exists, so the required end-state is never produced by the
   system. Additionally `wallet.ts:137-143` is unreachable:
   `phase0/p3/fake-provider.ts:80` never throws for `timeout-unknown` — it waits
   60 s then resolves success — so the test comment's alternative pass path
   ("the timeout path marked uncertain") can never occur.
4. **Why not prevented:** the assertion was relaxed to accept the current,
   incomplete state rather than the required one.
5. **Smallest correction:** implement lease expiry (e.g.
   `UPDATE p3_attempt SET state='uncertain' WHERE state='dispatching' AND started_at < now() - lease`);
   tighten the assertion to `uncertain` after recovery runs; delete or fix the
   dead branch.
6. **Demonstrating test:** crash-2 → run recovery → assert exactly `uncertain`,
   attempt count 1, `countCharges == 0`, `refunded == 0`.

### M-10 · Double-reserve race can debit the wallet twice for one operation

1. **Severity:** MAJOR (money safety / race between worker, sweeper, recovery).
2. **Location:** `phase0/p3/wallet.ts:65-85`;
   `phase0/p3/schema.sql:54` (`UNIQUE (operation_id, kind, attempt_id)` —
   PostgreSQL treats NULLs as distinct, so `reserve` rows are never deduplicated).
3. **Failure scenario (READ COMMITTED):** tx B reads `billing_state='unbilled'`
   at `wallet.ts:65-69` *before* tx A commits, then blocks on the wallet
   `FOR UPDATE` (`wallet.ts:70`). A commits (`reserved`). B proceeds: debit
   (`wallet.ts:75`) → guarded `UPDATE … WHERE billing_state='unbilled'` affects
   0 rows — **rowcount never checked** → `INSERT reserve settlement` succeeds
   (NULL attempt_id). Result: wallet debited twice, two `reserve` rows, one
   operation. Trigger: a recovery retry racing an in-flight reserve — precisely
   the concurrency prompt7 §3 asks about. Tests only race *different* operations
   (`phase0/p3/p3.test.ts:218-229`), which the wallet lock handles correctly.
4. **Why not prevented:** the state guard is read before the lock and its
   rowcount is ignored; the settlement unique key cannot bind NULL rows.
5. **Smallest correction:** `SELECT … FOR UPDATE` on the operation row at line
   65 (keep lock order operation→wallet), check the guarded-update rowcount
   before any money movement, and make reserve/refund rows deduplicable
   (`UNIQUE … NULLS NOT DISTINCT` — PG15+, runbook requires 16+ — or a sentinel
   attempt_id).
6. **Demonstrating test:** N concurrent `reserve()` calls for the *same*
   `operationId` → exactly 1 fulfilled, balance debited once, exactly one
   `kind='reserve'` row.

### M-11 · Sweeper: eligibility read outside the transaction, credit before guard, guard rowcount unchecked, refund rows not deduplicated

1. **Severity:** MAJOR (recovery / sweeper correctness).
2. **Location:** `phase0/p3/wallet.ts:187-195` (stale `NOT EXISTS` in a
   separate autocommit statement), `phase0/p3/wallet.ts:198-226` (wallet credit
   at line 208 *before* the guarded update at line 212 with no rowcount check;
   errors swallowed silently at line 221; refund rows carry `attempt_id NULL` →
   no uniqueness).
3. **Failure scenario:** (a) a concurrent `dispatchAttempt` inserts
   `dispatching` between the stale eligibility read and the per-row transaction
   → a *dispatched* operation gets refunded while the provider later charges
   (double payout); (b) two concurrent sweepers → wallet credited twice — both
   `refund` inserts succeed (NULL distinct) and the guarded update's rowcount is
   ignored.
4. **Why not prevented:** eligibility is not re-validated under any lock inside
   the refunding transaction, and money moves before the state guard result is
   known.
5. **Smallest correction:** inside the per-row tx: `SELECT` the operation
   `FOR UPDATE`, re-check `NOT EXISTS (…)`, check the guarded-update rowcount,
   *then* move money; log swallowed errors.
6. **Demonstrating test:** barrier test: `afterDispatchingWrite` hook fires →
   run `sweepExpired` → assert `refunded == 0` and balance unchanged; plus a
   two-sweeper concurrency test asserting exactly one `refund` row.

### M-12 · External-SIGKILL test is inherently flaky (~15–20%)

1. **Severity:** MAJOR (evidence reproducibility).
2. **Location:** `phase0/p3/p3.test.ts:194-202` (polls every 100 ms for the
   `dispatching` row, then kills) vs `phase0/p3/fake-provider.ts:67,78` (charge
   is written at `t0 + P3_FAKE_LATENCY_MS`, default 20 ms).
3. **Failure scenario:** if the first poll observes the row within the first
   ~20 ms, SIGKILL lands **before the charge is durable** →
   `expect(countCharges(op)).toBe(1)` fails intermittently. Evidence runs fail
   for reasons unrelated to the property under test.
4. **Why not prevented:** the kill precondition observes only the application
   table, not the provider-side durable evidence the test is about.
5. **Smallest correction:** wait for **both** conditions before killing:
   `dispatching` row **and** `countCharges(op) === 1`.
6. **Demonstrating test:** the same test run 20× consecutively without failure.

### M-13 · Backpressure bound covers only the business pool — per-request `DBOSClient.create` opens connections before the timeout

1. **Severity:** MAJOR (backpressure/retry correctness).
2. **Location:** `phase0/p1/handler.ts:129` creates a fresh `DBOSClient` *before*
   `connectBounded`; `DBOSClient.create` runs `checkShardedSchema()` immediately
   (`node_modules/@dbos-inc/dbos-sdk/dist/src/client.js:112-128`) → ≥1 real PG
   connection per request, each client with its own pool
   (`DEFAULT_POOL_SIZE = 10`), regardless of `acquireTimeoutMs`.
3. **Failure scenario:** a retry storm of N concurrent requests opens N
   connections before any timeout fires; past `max_connections`, failures become
   `ECONNREFUSED`-class — **not** `AcquireTimeoutError` — violating prompt6 §5
   ("cannot exhaust the process", "failure is retryable"). The N=10 flood
   (`phase0/p1/backpressure.test.ts:44-74`) cannot surface this and never counts
   connections: prompt7 §4's "retry storm that defeats the bounded pool" is
   untested. The prototype comment (`handler.ts:127-128`) acknowledges the
   per-request shape, but the claim under test remains unbounded by construction.
4. **Why not prevented:** `acquireTimeoutMs` bounds only `deps.pool`; connection
   usage outside that pool scales with request concurrency and is unmeasured.
5. **Smallest correction:** acquire the bounded tx **first** and create/reuse
   the client afterwards (or hoist one shared client per process); record
   `SELECT count(*) FROM pg_stat_activity` during the flood as an assertion.
6. **Demonstrating test:** flood with N > `max_connections` → only
   `AcquireTimeoutError` outcomes, zero connection errors, `pg_stat_activity`
   count bounded.

### M-14 · Required P3 assertion matrix (prompt6 §4) is only partially implemented

1. **Severity:** MAJOR (evidence validity).
2. **Location:** `phase0/p3/p3.test.ts:74-175`. Confirmed gaps by case:

   | Case | Missing required assertions |
   |---|---|
   | crash-1 | reserve-row count / uniqueness; settlement row counts (only balance + `refunded` asserted) |
   | crash-2 | **provider charge count** (must be 0), attempt-row count (no blind retry), final balance |
   | crash-3 | final balance; **COGS consistency** — settles `15000` at `p3.test.ts:108` while attempt cost is `35000`, and nothing asserts they match |
   | crash-4 | final balance; reservation count/state |
   | sweeper test (`:137-175`) | final balance |

3. **Failure scenario:** prompt7 §3 requires every test to assert provider
   count, operation/attempt identity, reservation/settlement counts, final
   balance, and repeat-call count. Confirmed: they do not. crash-3 actively
   writes an internally inconsistent ledger and still passes — "billing/COGS
   reconciliation remains consistent" is unproven.
4. **Why not prevented:** assertions were written per-test rather than against
   the prompt6 §4 checklist.
5. **Smallest correction:** add the missing assertions per the table; settle
   with `att.cost_usd_micro` and assert
   `terminal_result.actual_micro == attempt.cost_usd_micro`.
6. **Demonstrating test:** the enriched assertions (crash-3's amount equality
   fails today at `15000 ≠ 35000`).

### M-15 · LOCKFILE_AUDIT cannot substantiate its own PASS row from the repository

1. **Severity:** MAJOR (evidence validity — prompt7 §5 explicit audit item).
2. **Location:** `phase0/evidence/LOCKFILE_AUDIT.md` — 6/18 rows have truncated
   URLs (`/-/…`, lines 28-33); no before/after integrity values are in the repo
   (deferred to "the Phase 0 session record" and `/tmp/audit-lock.js`, lines
   41-42 — both ephemeral); completeness arithmetic is internally inconsistent
   (lines 49-52: "20 candidates, 12 repaired here + 6 first round = 18, **8
   verified-clean**" — 12+6+8 = 26 ≠ 20).
3. **Failure scenario:** `S-AUDIT` (`EVIDENCE_MATRIX.md:64`) claims "comparison
   table in LOCKFILE_AUDIT.md" — the table lacks the hash pairs that would prove
   the mapping from package → version → resolved URL → registry artifact.
   Nothing in the repository can substantiate the PASS.
4. **Why not prevented:** the audit artifact was summarized instead of recorded;
   the verification script lives in `/tmp`.
5. **Smallest correction:** regenerate from `git show HEAD:package-lock.json`:
   full resolved URLs plus integrity old→new pairs for all 18 entries, and
   reconcile the candidate arithmetic (all data is in-repo — fixable offline).
6. **Demonstrating test:** a script asserting each recorded new hash equals
   `dist.integrity` from registry metadata and byte-matches the committed
   lockfile.

### M-16 · Runbook omits SAFEGUARDS-mandated loopback / SCRAM / port verification

1. **Severity:** MAJOR (database safety — prompt7 §1 "loopback-only binding and
   authentication requirements in the runbook are accurate").
2. **Location:** `phase0/SAFEGUARDS.md:14-17` (binding: "loopback-only listen;
   verified-free local port; **SCRAM authentication**") vs
   `phase0/LOCAL_POSTGRES_RUNBOOK.md` §1-2 — no `SHOW listen_addresses`, no
   `pg_hba.conf` inspection, no auth-method check, no port probe assertion.
3. **Failure scenario:** the runbook flow is compatible with `trust`
   authentication on localhost (Postgres.app/Homebrew defaults), so the random
   `phase0_rt` password is unenforced by the server — and the role is unused
   anyway (M-03). The SAFEGUARDS guarantees were not carried over when the
   embedded-postgres path was blocked and replaced by the runbook path.
4. **Why not prevented:** nothing in the runbook verifies binding or auth; the
   SAFEGUARDS document is not referenced by the runbook at all.
5. **Smallest correction:** add runbook §1 verification steps: `SHOW listen_addresses`
   → must be `localhost`; inspect `pg_hba.conf` → record method (warn on
   `trust`); probe the port is free; record all three in the evidence log.
6. **Demonstrating test:** evidence lines produced by those runbook commands.

---

## Confirmed MINOR findings

| ID | Location | Issue | Smallest correction | Demonstrating test |
|---|---|---|---|---|
| m-01 | `phase0/p1/p1.test.ts:92-95` | Losing duplicates' returned **status** never asserted (only `workflowId`) — prompt7 §2 "loser receives the correct existing status" unproven. | Assert each loser's status matches the winner's stored/live status. | Add status assertions to the race test; a deliberately wrong status projection must fail it. |
| m-02 | `phase0/p1/handler.ts:45`; `docs/plans/plan6.2.md:228` | **HTTP 409** has no seam: test asserts `outcome==='conflict'` only; no route/mapping exists in the prototype. | Document out-of-prototype scope in the matrix row, or add a mapping unit test. | Unit test asserting the conflict outcome maps to 409. |
| m-03 | `phase0/p1/handler.ts:153` | Case 8's missing-**projection** fail-closed path (invariant-violation throw) is statically sound but has **no test**; no alerting mechanism exists. | Add a test deleting the event row mid-flight and expecting a thrown, non-accepted failure; record alerting as production scope. | The added test (must not enqueue). |
| m-04 | `phase0/run-all.sh:48,56` | `WORKER_LOG` is written **outside** the `redact` pipeline — raw worker stdout/stderr persists unredacted in `phase0/evidence/` (its `cat` into the main log *is* redacted; the file itself is not). | Pipe worker output through `redact` before writing. | Force a worker startup error with a password-bearing URL → grep the worker log → expect 0 matches. |
| m-05 | `phase0/run-all.sh:58-71` | No per-suite PASS/FAIL/BLOCKED/NOT-RUN markers; on first failure later suites are silently absent (implicitly NOT RUN, never stated). | Emit one result line per suite; distinguish "aborted" from "passed". | Fail suite 1 deliberately → log must show suites 2-3 as NOT RUN. |
| m-06 | `phase0/EVIDENCE_MATRIX.md:10-11` | `C-PROV-1`/`C-PROV-2` rows have 6 cells in a 7-column table (column misalignment). | Pad cells to 7. | Render check / cell-count script. |
| m-07 | `phase0/db-guard.ts:25-27` | `redactUrl` does not redact `?password=…` query values (preflight/setup print the URL); run-all's sed does — inconsistent protection. | Extend `redactUrl` to strip password-like query params. | `redactUrl('…?password=x')` must not contain `x`. |
| m-08 | `phase0/LOCAL_POSTGRES_RUNBOOK.md` §7; `phase0/setup-db.ts:47-55` | Cleanup's verified target (`current_database()`) and the **literal** `DROP DATABASE phase0_proofs` can diverge if the scratch DB was renamed; `phase0_rt` is never dropped and keeps its *first* password forever (setup skips password when "role exists"). | Verify-then-drop the literal name **and** role in the runbook; `ALTER ROLE … PASSWORD` on each setup when env provided. | Rename the DB, run §7 as written → demonstrate divergence; setup with changed password → verify old password no longer valid. |
| m-09 | `phase0/p1/README.md:3,17,42`; `phase0/p3/README.md:14` | Stale: "5 active tests + 1 todo" (actual 7), "draft, unexecuted", expiry case "blocked on sweeper" (implemented), procedure missing `--config`, and the `npm run typecheck` gate that doesn't cover phase0 (M-04). | Refresh both READMEs. | File counts match `p*.test.ts`. |
| m-10 | `phase0/p3/wallet.ts:221` | Per-row sweep errors swallowed with no log — a fully failing sweeper returns `refunded: 0` silently. | Log with `operation_id`. | Inject a failing row → error appears in output, other rows still processed. |
| m-11 | `phase0/setup-db.ts:42`; `phase0/p2/probe-workflows.ts:18` | `p2_probe_log` table has no schema anywhere — P2 probes will fail at Gate D. | Add `p2/schema.sql` to prep (prep only; Gate D unauthorized). | Apply schema + insert one probe row. |
| m-12 | `phase0/BASELINE_RUNBOOK.md:92`; `phase0/EVIDENCE_MATRIX.md:20`; `LOCAL_POSTGRES_RUNBOOK.md` §0:14 | "Tree delta **exactly** package.json + lockfile + phase0/" omits pre-existing `M .gitignore` and untracked `deepwiki.md`/`docs/` (present since the Step-1 snapshot, `BASELINE_RUNBOOK.md:25` — so *not* a boundary violation, but the claims are literally false and §0's expected-status list will surprise the owner). | List known pre-existing entries explicitly in §0 and the matrix rows. | Compare claim text against `git status --short`. |
| m-13 | `phase0/p3/p3.test.ts:119-135` | "crash-4" contains **no crash** (runner exits 0; there is no post-settle/pre-completion step to die in). The money property (replay idempotence) *is* proven. | Rename/split, or add a real kill point between settle and completion. | A killed-at-that-point variant asserting one settle row. |
| m-14 | `phase0/p1/p1.test.ts:45`, `backpressure.test.ts:17`, `p3.test.ts:17` | Missing-URL → `test.skip` → vitest **exit 0** with zero executed tests: a direct invocation without env yields a green shell result. `run-all.sh` guards the main path. | Add a "0 passed ⇒ non-zero" summary check for manual invocations. | Run a suite with no URL → process exit must be non-zero. |

---

## INFORMATIONAL and unverified items (not confirmed defects)

1. **i-01** — `phase0/p1/p1.test.ts:81-87`: the barrier releases all racers
   pre-call; with `pool max 5` and N=8, overlap at the conflict window is not
   *proven* (no in-flight-transaction evidence). Assertions remain sound either
   way; a post-`BEGIN` barrier or `pg_stat_activity` count would strengthen the
   "concurrent" claim.
2. **i-02** — `phase0/p3/wallet.ts:117-125`: the concurrent-dispatch budget race
   is stopped by `UNIQUE (operation_id, sequence)` — a raw `23505` surfaces
   instead of "provider-attempt budget exhausted". No double provider call;
   error-mapping nicety only.
3. **i-03** — `phase0/run-all.sh:21`: `mktemp -t p3-provider.XXXXXX.jsonl` works
   on macOS (verified: creates `…XXXXXX.jsonl.<rand>`) but would fail on GNU
   mktemp; the value is also dead — `p3.test.ts:57` overrides `P3_PROVIDER_LOG`
   per test.
4. **i-04** — Environment: no Node.js runtime on this machine; runbook §0 fails
   closed at step 0 (no data risk, but execution currently impossible until
   Node ≥22 is re-provisioned). All "typechecks clean" claims remain
   **unverified** by this review (static analysis only).
5. **i-05** — `phase0/setup-db.ts:56-63`: `phase0_rt` receives DML on `dbos.*`
   system tables; defensible for DBOS applications, but it exceeds "only what
   the tests need" (and the tests never use the role — M-03).
6. **i-06** — The prototype has no separate "domain mutation" table: P1
   atomicity is exercised for (business-event row + enqueue) only; V2.1's
   domain-mutation atomicity has nothing to exercise here. Re-scope when
   planning Phase 1.
7. **i-07** — `phase0/p1/backpressure.test.ts:46,68`: comments say holds are
   "6 s"; actual `pg_sleep(4)`. Cosmetic narration inaccuracy in evidence-bound
   code.

---

## Verified strengths (adversarial attempts that failed to find a defect)

1. **P1 atomicity is real:** `enqueueInTransaction` →
   `initWorkflowStatus(…, client)` uses the caller's own `PoolClient` — no
   inner BEGIN/COMMIT (`client.js:269-276`, `system_database.js:1194-1199`);
   system tables live in the same database → business insert + enqueue
   genuinely share one PostgreSQL transaction.
2. **Guard name parsing** is strict (charset allowlist; decode-before-check
   ordering defeats `%2f` smuggling) and fails closed on every malformed URL
   variant attempted (empty path, multi-segment path, over-long names). Host /
   query-param gaps are M-01.
3. **`connectBounded`** is leak-safe: late-arriving client released after
   timeout, timer cleared, retryable error class
   (`phase0/p1/handler.ts:83-104`).
4. **Ack-after-commit:** the result is returned only after `COMMIT`
   (`handler.ts:227-228`); a failed enqueue rolls back and throws — no
   silent-drop or early-acknowledgement path found.
5. **Expiry-renewal concurrency design:** row lock + generation-guarded update +
   archive-before-renew converge correctly by inspection (P1-EXP-8 will prove
   it at Gate C).
6. **`deleteWorkflow` semantics match the test premise:** it deletes
   `workflow_status` plus payload tables
   (`system_database.js:2079-2102`) → the projection-fallback test (case 4) is a
   fair simulation of history removal.
7. **SDK claims verified in installed source:** `workflowIDReusePolicy`
   present (`enqueue_options.d.ts:25`) with `return-existing` semantics
   (`system_database.js:1259-1261`); `duplicationPolicy` correctly never passed;
   `DEFAULT_POOL_SIZE = 10` (`system_database.js:62`); `deleteWorkflow` present;
   the `./internal/*` subpath exports used by `setup-db.ts` exist and resolve at
   runtime.
8. **Settlement replay** for `kind='settle'` is genuinely deduplicated by
   `(operation_id, kind, attempt_id)` with non-NULL attempt — crash-3/4 replay
   assertions are sound.
9. **`run-all.sh` failure propagation** is correct by inspection:
   `set -euo pipefail` with the group in a pipeline means a failing suite
   aborts later suites and exits non-zero; main-log redaction covers error and
   stack-trace output (worker-log file excepted — m-04); `singleFork: true`
   (`vitest.phase0.config.ts:13`) prevents cross-suite TRUNCATE races.
10. **Provider log is durable and independent** (JSONL file,
    `appendFileSync` *before* fault injection) — "provider accepted" evidence
    cannot be forgotten by an application-side mock for crash-1/3.
11. **`.env` isolation verified:** `git check-ignore phase0/.env` → matched by
    `.gitignore:4` — runbook §3's claim is true.

---

## Disposition (prompt7 §7)

| Category | Findings |
|---|---|
| BLOCKER | none |
| Database safety (fix or explicitly resolve first) | M-01, M-02, M-03, M-16 |
| Recovery / state-machine correctness | M-08, M-09, M-10, M-11 |
| Evidence validity / reproducibility | M-04, M-05, M-06, M-07, M-12, M-13, M-14, M-15 |
| Test-validity minors | m-01, m-03, m-05, m-13, m-14 |
| Not triggered | advisory-lock fencing, new services, additional infrastructure, architecture changes — none needed; nothing here reopens V2.1 |

**Verdict: FIX BEFORE EXECUTION.**

Fastest safe sequence:

1. **M-01 + M-02 + M-16** — small, mechanical, and they fully close the
   "wrong database" surface before the owner touches Postgres.
2. **M-08 + M-09** — recovery inspection and `dispatching → uncertain` lease
   transition; these are the difference between P3 evidence and P3 theater.
3. **M-04 + M-05 + M-06 + M-07 + M-15** — make the record re-executable and the
   suite re-runnable.
4. **M-10, M-11, M-12, M-13, M-14** — before the Phase 0 report is written;
   they directly determine whether Gate C output can be believed.

No BLOCKER exists: following the runbook's literal commands verbatim (hardcoded
`127.0.0.1` + `phase0_proofs`) does not by itself endanger a non-disposable
database. The MAJOR findings instead make the *evidence* untrustworthy and the
*guards* incomplete against everything the runbook does not happen to write
down — which is exactly the condition prompt7 §7 says to fix first.
