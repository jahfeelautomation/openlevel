**Verdict: FIX BEFORE EXECUTION. Do not run the local PostgreSQL setup yet.**

This review found exactly the kinds of defects the adversarial pass was meant to uncover. More importantly, several are not documentation problems: they affect database-target safety, whether a retry can charge a customer twice, whether the sweeper can refund an already-dispatched operation, and whether the tests genuinely prove the behavior they claim.

I agree with the review's overall verdict: **zero confirmed blockers at the architecture level, but 16 reported major findings must be resolved before Gate C execution.** The review was static because its Node.js runtime was unavailable, so its findings should be checked against the current source before being treated as independently reproduced.

The highest-priority corrections are:

| Priority | Findings | Why they matter |
| ----- | ----- | ----- |
| First: database safety | M-01, M-02, M-03, M-16 | Prevent accidental connection to the wrong database and ensure the tests actually use the restricted role and required authentication |
| Second: money and recovery | M-08, M-09, M-10, M-11 | Prevent duplicate provider charges, double reservations, and unsafe refunds |
| Third: proof validity | M-04 through M-07, M-12 through M-15 | Ensure the evidence is reproducible and that the tests exercise the claimed SDK and crash behavior |

I would also fix the relevant minor findings in the same pass. There is no reason to create another review cycle for stale READMEs, unredacted worker logs, missing test markers, or misleading matrix cells.

The review is useful, and I would **not abandon the implementation or restart the architecture work**. The right move is one bounded remediation pass, followed by the local execution.

I would give the coding agent the following directive. It has autonomy to choose the implementation details, but it must close the actual safety and correctness gaps rather than merely edit the report until the findings disappear.

# **OpenLevel Phase 0 — Adversarial Review Remediation Directive**

## **Objective**

Resolve the findings in `phase0/ADVERSARIAL_REVIEW.md` before the owner runs the local PostgreSQL proofs.

The review verdict is FIX BEFORE EXECUTION: 16 reported MAJOR findings, 14 MINOR findings, and 7 INFORMATIONAL/unverified observations.

You have autonomy to inspect, correct, test, and document the implementation. Use industry-standard database safety, transaction handling, idempotency, concurrency control, secret handling, and test reproducibility practices.

This is a bounded implementation remediation task. It is not an architecture review.

**Do not edit application code, V1, V2, V2.1, or planning documents. Do not introduce new infrastructure or redesign the approved architecture. All new or modified artifacts remain under `phase0/`.**

## **1\. First: independently validate the findings**

Do not blindly apply every proposed correction.

Inspect the actual source and installed SDK version. For each finding M-01 through M-16 and m-01 through m-14, record one disposition:

* CONFIRMED — reproduce or establish the defect from actual source.  
* NOT REPRODUCED — explain the evidence that disproves the finding.  
* PARTIALLY CONFIRMED — identify the valid part and remaining uncertainty.  
* FIXED — show the correction and its verification.  
* DEFERRED — explain why it cannot affect local proof safety or validity, and whether it gates a later phase.

Retain the original review. Produce `phase0/REMEDIATION_REPORT.md` with the dispositions and evidence.

Do not spend time disputing a finding that can be fixed safely and locally.

## **2\. Database-target safety — first execution gate**

Resolve M-01, M-02, M-03, and M-16 before asking the owner to start PostgreSQL.

### **M-01 — Validate the actual database target**

The current disposable-database guard is insufficient if it verifies only the database name.

Enforce all of the following:

* Accept only `postgres://` or `postgresql://` connection strings.  
* Enforce loopback-only connections for the local proof environment.  
* Reject foreign hosts, Unix sockets, alternate hosts supplied through query parameters, and connection-string overrides.  
* Reject unapproved query parameters, especially `host`, `options`, `port`, `dbname`, `user`, and credential overrides.  
* Inspect relevant `PG*` environment variables and service-file configuration that could change the actual connection target.  
* Verify the database name, server address, server port, and current role through the live connection.  
* Perform identity verification on the actual connection used for setup and tests, not only in a separate preflight process.  
* Recheck before destructive operations and cleanup.  
* Fail closed on malformed, ambiguous, or unexpected targets.

Do not add a general host-override environment variable that silently weakens the loopback policy.

Test malformed schemes, query overrides, encoded host values, IPv6 loopback, non-loopback hosts, socket paths, unexpected options, and incorrect server identity.

### **M-02 — Guard every database entrypoint**

Every standalone entrypoint must validate its own target before DBOS initialization, connection creation, queue registration, SQL execution, or cleanup.

This includes:

* P1 worker;  
* P3 runner;  
* P2 probe workflow entrypoint;  
* setup and test entrypoints.

A script must remain safe when invoked directly, not merely when reached through `run-all.sh`.

Add tests proving each direct invocation rejects a non-disposable database before performing database activity.

### **M-03 — Enforce actual restricted-role execution**

Separate database administration from runtime execution.

Use a bootstrap/admin connection only for:

* dedicated database/schema initialization;  
* role creation or controlled credential rotation;  
* minimum required grants;  
* other explicitly documented setup operations.

P1, P3, the DBOS worker, and backpressure tests must use the restricted runtime role.

Verify `current_user` for every proof connection. The evidence must demonstrate that the test runtime is not the bootstrap superuser.

Grant only the privileges actually required by the prototype and SDK. Do not solve permission failures by using superuser credentials or granting ownership of the whole database.

Where tests require `TRUNCATE`, either grant it narrowly on the relevant Phase 0 tables or use a safer row-level cleanup strategy. Never grant broad destructive privileges over unrelated application tables.

### **M-16 — Verify PostgreSQL listener and authentication**

Make the local runbook enforce the safety properties in `phase0/SAFEGUARDS.md`.

Before executing tests, record:

* `SHOW listen_addresses`;  
* the active PostgreSQL listener address and port;  
* the PostgreSQL server version;  
* the active `pg_hba.conf` file and applicable authentication rule;  
* the authentication method used by the Phase 0 runtime role.

Require loopback-only exposure and SCRAM authentication. Do not treat localhost `trust` authentication as equivalent to password authentication.

Verify that the intended port was free before starting the server and that the resulting listener belongs to the expected PostgreSQL process.

Do not ask the owner to run destructive database setup until this section passes.

## **3\. P1 — atomicity, idempotency, and SDK proof**

Resolve M-04, M-05, M-06, and M-07.

### **M-04 — Make Phase 0 typechecking reproducible**

The root `npm run typecheck` does not include `phase0/`.

Create an isolated Phase 0 TypeScript configuration or an exact dedicated command that typechecks all Phase 0 source and tests with explicit compiler options.

Record the complete command, without ellipses, in the evidence matrix and runbook.

A command that omits the Phase 0 files is not proof of Phase 0 type safety.

### **M-05 — Make proof runs repeatable**

A second execution against the same retained database must not fail simply because old DBOS workflow history remains.

Use an explicit test-run identity or another safe isolation strategy. Each run must be independently identifiable, and workflows within that run must retain stable IDs for duplicate tests.

Do not blindly truncate DBOS system tables to make tests pass. Use only a documented, SDK-compatible cleanup or isolation procedure.

Run the entire suite twice against the same disposable database and prove both runs complete successfully with independent results.

### **M-06 — Prove workflow ID reuse behavior independently**

The existing duplicate-handler path does not necessarily invoke DBOS's workflow-ID reuse branch.

Add a dedicated test that deliberately reaches that SDK behavior. For example, retain the DBOS workflow record while removing or isolating the corresponding business-event record, then exercise the fixed workflow ID again.

Prove:

* the SDK returns the existing workflow;  
* no second workflow record is created;  
* no second execution occurs;  
* the application's resulting status is correct.

The test must distinguish application-level deduplication from DBOS-level workflow-ID reuse.

Use the exact installed `@dbos-inc/dbos-sdk@5.5.0` behavior and types. No type casts or unsafe type patches.

### **M-07 — Prove rollback removes the workflow too**

The rollback test must assert the absence of:

* the business-event row;  
* the associated domain mutation, where modeled;  
* the DBOS workflow status;  
* the DBOS workflow input/payload.

Use supported SDK queries or precisely verified database inspection. A comment describing an assertion does not count.

Include an injected failure after enqueue has been attempted but before commit.

A synthetic Phase 0 domain-mutation row is acceptable to demonstrate that the business mutation and workflow enqueue share the same transaction. Keep it isolated from the application schema.

## **4\. P3 — provider recovery and wallet correctness**

Resolve M-08, M-09, M-10, M-11, M-12, and M-14.

These are the highest-risk implementation findings because they affect the possibility of duplicate provider charges and incorrect wallet balances.

### **M-08 and M-09 — Implement real uncertain-attempt recovery**

The current runner must not dispatch another provider call merely because it is invoked again.

Implement a recovery inspection path:

1. Inspect persisted attempts for the operation before dispatch.  
2. Identify stale `dispatching` attempts using an explicit lease/age policy.  
3. Transition eligible stale attempts to `uncertain`.  
4. Quarantine the operation or attempt.  
5. Return a reconciliation-required outcome.  
6. Do not issue another provider call without a proven safe recovery decision.

The system must create the `dispatching → uncertain` transition itself. A test that manually updates the database to `uncertain` does not prove the recovery implementation.

A normal retry is permitted only when the system can establish that the previous attempt never reached the provider.

Add recovery tests for provider accepted, provider not accepted, and outcome unknown. Include lease boundary behavior and ensure an active attempt cannot be mistaken for a stale attempt simply due to a slow provider response.

### **M-10 — Make reservation idempotent under concurrency**

Protect the operation's billing-state transition with appropriate row locking and a consistent lock order.

The same operation must not reserve or debit twice when multiple callers race.

Check every guarded update's affected-row count before performing associated money movement.

Make reserve entries deduplicable even when `attempt_id` is NULL. Use an appropriate partial unique index, non-null identity, or equivalent PostgreSQL-supported constraint.

Add a barrier-coordinated test racing multiple reserve calls for the same operation. Assert exactly one effective reservation and one debit.

Also verify the caller receives a well-defined idempotent result or a meaningful conflict/budget response—not an unexplained database uniqueness error.

### **M-11 — Make sweeper transitions atomic**

Revalidate eligibility inside the refund transaction.

Use consistent operation/wallet locking with dispatch and reserve operations.

The sweeper must:

* lock the operation;  
* recheck its attempt state and refund eligibility;  
* perform a guarded state transition;  
* inspect the affected-row count;  
* move money only after the transition succeeds;  
* deduplicate the refund record;  
* log an individual row failure with its operation ID while allowing unrelated eligible rows to proceed.

Do not credit a wallet before knowing the state transition succeeded.

Add barrier tests covering a dispatch racing the sweeper and two sweepers racing the same reservation.

Prove that a dispatched, uncertain, or provider-reconciled-but-unsettled operation cannot be refunded without the required evidence.

### **M-12 — Make SIGKILL tests deterministic**

Do not kill the child process merely because the application's `dispatching` record appeared.

For the provider-accepted-then-crash scenario, wait until both conditions are true:

* the application has durably recorded `dispatching`;  
* the independent fake-provider journal proves the provider accepted the operation.

Only then send SIGKILL.

Use an explicit synchronization signal where possible rather than fragile fixed delays or polling intervals.

Run the crash scenario repeatedly (at least 20 consecutive executions where practical) and record the results. A timing-dependent test must not be represented as deterministic.

### **M-14 — Complete the crash assertion matrix**

Every crash test must verify the complete relevant evidence set:

* accepted provider-side charge/call count;  
* stable operation ID;  
* attempt ID and attempt count;  
* reservation count and state;  
* settlement count and unique settlement key;  
* final wallet balance;  
* repeated provider-call count.

Crash 3 must reconcile the actual attempt cost to the settlement amount. Do not write a hardcoded settlement amount that differs from the provider-attempt cost.

The assertion matrix must make missing evidence obvious. No crash case passes if its core money or provider-side assertion is absent.

## **5\. Backpressure — bound the entire request path**

Resolve M-13.

The current business-pool acquisition timeout does not necessarily bound connections opened by per-request `DBOSClient.create`.

Inspect the exact installed SDK implementation and make the entire path bounded.

Prefer a safely shared process-level DBOS client with explicit pool limits, where supported, rather than creating a fresh DBOS client and connection pool for every request.

Acquire or initialize bounded resources before accepting unbounded concurrent work. Make the connection limit explicit; do not rely on SDK defaults.

Measure the actual database backend/connection count while the request flood is running.

The test must verify that:

* connection use remains bounded;  
* acquisition timeout produces predictable retryable failures;  
* the process does not accumulate an unbounded set of DBOS clients/pools;  
* no successful response is returned before commit;  
* retrying an event after transient failure converges through the P1 idempotency mechanism.

Test beyond the configured application pool size and include a load large enough to expose per-request client creation or connection growth.

## **6\. Supply-chain audit evidence**

Resolve M-15.

Regenerate `phase0/evidence/LOCKFILE_AUDIT.md` using the actual original committed lockfile and the current corrected lockfile.

For all 18 restored entries, record:

* package name;  
* exact version;  
* full resolved registry URL;  
* original integrity value;  
* corrected integrity value;  
* registry metadata/artifact integrity used for verification;  
* verification method and outcome.

Reconcile the total candidate, repaired, and verified-clean counts. The current arithmetic is internally inconsistent.

Do not rely on `/tmp` scripts or session-only evidence as the sole substantiation. Preserve a sanitized, reproducible verification script or complete verification procedure under `phase0/`.

Do not make additional dependency upgrades or unrelated lockfile changes.

## **7\. Resolve the material MINOR findings**

Fix these in the same remediation pass where they are confirmed and remain in scope:

* **m-01:** assert that losing duplicates return the correct existing status, not only the same workflow ID.  
* **m-02:** test the conflict outcome's mapping to HTTP 409, or explicitly scope the HTTP adapter outside this prototype and do not claim the HTTP response itself is tested.  
* **m-03:** test missing projection/history failure-closed behavior and confirm no new workflow is enqueued. Production alert delivery may remain a documented later integration.  
* **m-04:** redact worker stdout/stderr before it is persisted in its own evidence file, not only when copied to the main log.  
* **m-05:** emit an explicit PASS/FAIL/BLOCKED/NOT RUN result for every suite, including suites skipped after an earlier failure.  
* **m-06:** correct the seven-column evidence matrix alignment.  
* **m-07:** redact password-like query values consistently in every log and preflight path.  
* **m-08:** make cleanup verify the exact database identity and handle the runtime role/password lifecycle safely. Setup should not silently preserve an old runtime-role password when a new password is supplied.  
* **m-09:** update stale P1/P3 READMEs to reflect the current number of tests and implemented behavior.  
* **m-10:** log sweeper failures with operation identity; do not silently swallow them.  
* **m-11:** add the missing P2 probe schema as a preparation-only artifact. Do not run Fly staging operations.  
* **m-12:** accurately identify the pre-existing working-tree changes (`.gitignore`, `deepwiki.md`, and existing `docs/` entries) separately from the approved Gate A+B and Phase 0 changes.  
* **m-13:** implement a real fourth crash point between settlement and workflow completion, or stop counting the existing replay test as a crash test.  
* **m-14:** direct suite invocation without the required database URL must exit non-zero rather than report a green run with zero executed tests.

## **8\. Strengthen the INFORMTIONAL observations where they affect proof credibility**

* **i-01:** strengthen the P1 race proof so it demonstrates overlapping transactions at the actual conflict boundary, ideally with synchronization after transaction start and recorded active transaction/backend evidence. Do not equate releasing a barrier before a function call with proving concurrent database contention.  
* **i-02:** map duplicate attempt/unique-constraint conflicts to an explicit domain outcome where appropriate. A raw database error should not be mistaken for a provider-attempt budget result.  
* **i-03:** remove dead temporary-file configuration or document the macOS-only behavior accurately.  
* **i-04:** ensure the local runbook verifies its Node.js prerequisite and gives a safe, exact recovery/install path without assuming the sandbox's `/tmp` toolchain survives.  
* **i-05:** retain least-privilege DBOS grants and document why each permission is necessary.  
* **i-06:** be honest about what the prototype proves. Prefer a minimal synthetic domain-mutation record so the atomic transaction test covers business event \+ domain mutation \+ DBOS enqueue. If that is not included, explicitly state the narrower proof boundary.  
* **i-07:** correct inaccurate comments about wait durations.

Do not expand these into new architecture work.

## **9\. Regression and reproducibility checks**

After corrections:

1. Run the exact Phase 0 typecheck command.  
2. Run lint.  
3. Run the unit tests that do not require PostgreSQL.  
4. Run targeted tests for all corrected guards, state transitions, and concurrency controls.  
5. Run the proof suite twice against one retained disposable database when local PostgreSQL becomes available.  
6. Inspect logs for credentials, including worker failure and stack-trace paths.  
7. Inspect the complete git diff and verify protected files remain unchanged.

If Node.js or PostgreSQL is unavailable in the coding environment, do not fabricate a successful run. Complete static review and code changes where safe, then list exactly what must be executed locally.

Keep the previously recorded `vault.test.ts` baseline failure classified as pre-existing. Do not modify application code to hide it.

## **10\. Required deliverables**

Under `phase0/`, deliver:

1. `REMEDIATION_REPORT.md` — disposition of all reported M, m, and i findings, with evidence.  
2. Corrected guard, setup, worker, runner, test, and backpressure implementation.  
3. Updated reproducible typecheck and local PostgreSQL runbook.  
4. Corrected and reproducible lockfile audit.  
5. Updated seven-column evidence matrix.  
6. Updated P1/P3 READMEs and P2 probe schema.  
7. Updated test output/evidence where execution was possible.  
8. A final repository-boundary audit.

The final report must clearly distinguish:

* code corrected;  
* typecheck/lint actually executed;  
* tests actually executed;  
* database-dependent tests still BLOCKED;  
* staging-only P2 proofs still BLOCKED;  
* remaining owner decisions.

## **11\. Acceptance and stop rule**

The local PostgreSQL runbook must not be given to the owner for execution until all confirmed database-safety findings and all material atomicity/recovery correctness findings are resolved.

The remediation is complete when:

* no unresolved database-target safety defect remains;  
* the restricted runtime role is demonstrably used;  
* no repeat execution can double-dispatch or double-debit;  
* the sweeper cannot race a provider dispatch into an unsafe refund;  
* the four crash tests exercise four real failure windows;  
* database connections are bounded end-to-end;  
* evidence commands are reproducible and cannot silently pass without running tests;  
* all material review findings have explicit dispositions;  
* the repository boundary remains intact.

Do not add an advisory-lock fence, a new infrastructure service, a second worker, Conductor, or an architecture rewrite. None was demonstrated to be necessary by this review.

**Proceed autonomously with this one remediation pass. Return the updated report and implementation evidence. Then stop for the owner's local PostgreSQL execution. Do not begin Phase 1\.**

One nuance I would be especially strict about: **M-08 through M-11 must be fixed in the actual execution paths, not just in test setup.** The review describes a runner that can redispatch a provider-accepted operation and a sweeper that can credit a wallet before it knows the refund transition succeeded. Those are the most consequential findings.

After this remediation, the next step is the local PostgreSQL run—not another broad review.

