**Do not paste a database connection string into the chat.** The next step should be to let the coding agent provision an isolated, disposable local PostgreSQL environment for Gate C. That is sufficient for the P1/P3 real-PostgreSQL tests and avoids exposing credentials or creating an unnecessary cloud resource.

I would give the agent autonomy over local setup, test implementation, and evidence collection, but preserve explicit boundaries around external spending, production systems, and destructive actions. If local provisioning proves impossible, it should explain the blocker and request only the approval needed to use a throwaway Neon branch.

# **Coding Agent Directive — Phase 0 Gate C and Prototype Execution**

## **Objective**

Continue OpenLevel Phase 0 from the completed Gate A+B baseline. Provision the safest available disposable PostgreSQL environment, then execute the real-PostgreSQL portions of P1 and P3, including the backpressure tests.

You have implementation autonomy within the boundaries below. Do not wait for the user to choose between equivalent local tooling options. Inspect the environment, choose the least-complex suitable approach, implement it, run the tests, and report evidence.

This is an execution directive, not an invitation to redesign the architecture.

## **1\. Accepted baseline**

Treat the following as recorded baseline evidence:

* Node.js `v22.23.5`; npm `10.9.9`, installed user-locally.  
* `npm ci` completed successfully with 202 packages after restoring 18 corrupted integrity hashes in the committed lockfile to registry-verified values.  
* The lockfile audit script is `/tmp/audit-lock.js`; it is outside the repository.  
* TypeScript typecheck: zero errors.  
* Vitest: 1,589 passed, 1 failed, in 724 seconds.  
* The single failure is the pre-existing `vault.test.ts` mixed-case versus uppercase secret-name mismatch. Application code was not modified. Keep this failure separately classified; do not silently change application behavior to make the baseline green.  
* `@dbos-inc/dbos-sdk@5.5.0` is pinned exactly.  
* The SDK compile gate is closed: `workflowIDReusePolicy` exists in the installed enqueue option types; `enqueueInTransaction(tx, options, ...args)` is confirmed; `DEFAULT_POOL_SIZE = 10` is confirmed in the installed source.  
* The prototype was corrected to use the actual `registerStep` API rather than the nonexistent `runAsStep`.  
* The Phase 0 prototype typechecks cleanly.  
* The recorded repository delta is `package.json`, `package-lock.json`, and `phase0/`. Existing architecture and planning documents remain byte-identical.

Do not repeat or alter the baseline without a reason. Re-run relevant checks after changes and compare against these results.

## **2\. Gate C: provision disposable PostgreSQL autonomously**

### **Preferred strategy**

Use a disposable local PostgreSQL instance. Do not ask the user to paste a database URL.

First inspect the environment:

1. Identify the operating system and available package managers.  
2. Check whether PostgreSQL binaries, an existing local server, or an already-running Docker daemon are available.  
3. Check whether an existing local PostgreSQL instance can safely host a dedicated temporary database without touching any other database.  
4. Prefer an already available local server or a user-local PostgreSQL installation over introducing additional infrastructure.

If Docker is already available, a temporary PostgreSQL container is acceptable. If not, use a user-local/native PostgreSQL installation when practical. Choose a supported PostgreSQL version and record its exact version. Do not substitute PGlite for this gate.

Do not install unrelated services, change global machine configuration unnecessarily, or require elevated privileges without approval. If local provisioning requires a privileged operation that cannot be completed safely under the current account, stop and report the precise blocker.

### **Isolation and credential handling**

The test database must be unmistakably disposable and non-production.

* Use a dedicated database and role for Phase 0\.  
* Bind a locally hosted database to loopback only.  
* Use a random temporary password and a restricted runtime role.  
* Use a separate bootstrap/migration role only where database/schema creation requires it.  
* Keep database data, temporary credentials, and logs outside the repository.  
* Pass connection details through environment variables or a permission-restricted temporary password file.  
* Never commit credentials, print complete connection strings, or include passwords in test output.  
* Redact host credentials, tokens, and sensitive provider payloads in evidence.  
* Add explicit test safeguards that reject production database targets.  
* Verify the database name and server identity before running destructive test setup or cleanup.  
* Use a separate database/schema namespace for these tests. Never reuse an existing application or customer database.

The preferred environment variable is `PHASE0_DATABASE_URL`. Keep it local to the agent's execution environment.

Do not use a real customer database, production Neon branch, or production provider credentials.

### **Cloud fallback**

Use a throwaway Neon branch only if a suitable local PostgreSQL instance cannot be provisioned safely.

Before creating a cloud branch:

1. Check whether an authenticated Neon CLI or supported account connection already exists.  
2. Establish the branch's disposable status and identify its parent.  
3. Estimate any incremental cost and record the intended cleanup policy.  
4. If the operation introduces external billing, requires new account authorization, or requires credentials not already available, stop and ask for the specific approval required.

Do not ask the user to paste a secret connection string into chat. The user should authenticate through the appropriate local CLI or secret-management mechanism.

Do not create multiple branches or cloud resources merely for convenience.

## **3\. P1 — execute atomic enqueue proof on real PostgreSQL**

Use the pinned SDK version `5.5.0` and the actual TypeScript types. Do not introduce type casts, declaration patches, or mock-only substitutes for the production API.

The test must exercise the actual transaction boundary involving the application business-event record and DBOS enqueue.

Required acceptance cases:

1. **Concurrent duplicate:** concurrent requests with the same event key and same payload hash converge to exactly one business event and one workflow. The losing request returns the existing status.  
2. **Post-completion duplicate:** a repeat after workflow completion returns the existing terminal status/result and does not create another workflow or provider operation.  
3. **Rollback:** an induced failure before commit leaves no committed business event, business mutation, or workflow enqueue.  
4. **Post-history-deletion duplicate:** remove or expire the DBOS history in the test environment while retaining the application event projection. A repeated event returns the stored projection without creating new work.  
5. **Post-tombstone-expiry duplicate:** after the explicitly defined application retention window expires, the event behaves according to the documented new-event policy.  
6. **Payload discrepancy:** the same key with a different payload hash returns HTTP `409 Conflict`, records the discrepancy, and performs no new mutation or enqueue.  
7. **SDK reuse behavior:** prove the pinned SDK behavior for the fixed workflow ID and the explicit `workflowIDReusePolicy` option. Do not assume public documentation overrides installed types/runtime behavior.  
8. **Status projection:** verify that the application can return a stable response if DBOS history has been pruned. If required history or projection is unexpectedly missing before retention expiry, the handler must alert and fail closed rather than enqueue another workflow.

Include a real concurrency test, not a sequential loop pretending to exercise a race. Where practical, coordinate concurrent transactions with explicit barriers so the test reliably exercises the conflict window.

The acceptance report must identify the actual database version, SDK version, test command, number of concurrent contenders, and observed row/workflow counts.

Do not switch to plain `enqueue()` as a workaround. Preserve the transactional enqueue design.

## **4\. P3 — execute wallet and provider-attempt safety tests**

Use a fault-injecting fake provider. Do not send real SMS, email, voice, payment, or model requests.

Implement and run the four required crash scenarios:

1. **Crash after reservation, before dispatch:** zero provider calls; the reservation is safely refunded or expired; the customer balance is exact.  
2. **Crash after durable `dispatching` state, provider contact unknown:** the attempt becomes `uncertain`; it is quarantined; no blind retry occurs.  
3. **Provider accepted, process crashed before settlement:** recovery inspects the persisted attempt first; it does not repeat the provider operation; the operation and billing/COGS reconciliation remain consistent.  
4. **Crash after settlement, before workflow completion:** recovery does not settle or charge twice; unique settlement keys preserve exactly one settlement.

For each case, assert and report:

* provider-side accepted-call/charge count;  
* stable `operation_id`;  
* unique `attempt_id` values and attempt state;  
* reservation count and final reservation state;  
* settlement count and unique settlement key;  
* final wallet balance;  
* whether recovery issued another provider request.

Use actual process termination or a controlled process boundary for crash behavior where practical. A test that only throws an exception and continues in the same process is not sufficient evidence for a process-crash claim.

Also execute:

* concurrent wallet exhaustion: multiple turns racing against one balance must never produce a negative balance; losing reservations must fail closed;  
* sweeper safety: dispatched and uncertain operations must not be refunded or expired merely because time elapsed;  
* replay safety: replaying a completed settlement must not create another debit.

A fake provider must expose its accepted operations in durable test state so the test can distinguish “the application attempted a request” from “the provider accepted a charge.”

## **5\. Enqueue-pool backpressure**

Implement and test bounded pool acquisition and request behavior.

Required behavior:

* Connection acquisition has an explicit timeout.  
* Concurrent requests cannot create unbounded waiting or exhaust the process.  
* A request that cannot safely obtain a connection returns an appropriate retryable failure.  
* Webhook acknowledgements occur only after the transaction commits.  
* A failed enqueue is never silently dropped or acknowledged as successful.  
* Public forms and webhook callers receive predictable failure behavior that permits safe retry.  
* Retrying the same event after a transient failure still converges through the P1 idempotency contract.

Run a real saturation test against the disposable PostgreSQL instance. Record pool size, number of concurrent requests, wait/acquisition timeout, response distribution, committed event count, and retry behavior.

Do not choose large concurrency defaults without measurement. Keep the wallet sweeper's five-minute cadence labeled provisional; do not represent it as a validated production interval.

## **6\. Repository and supply-chain discipline**

The unusual lockfile finding deserves an explicit audit trail.

The committed lockfile contained 18 corrupted integrity hashes with the same JF-to-AL substitution pattern. The hashes were restored to registry-verified values and `npm ci` then succeeded.

Before making further dependency changes:

* Verify that each restored integrity value corresponds to the exact package name, version, resolved tarball URL, and official registry artifact.  
* Preserve the audit evidence and the original-versus-restored comparison outside the production code path.  
* Do not perform broad dependency upgrades or `npm audit fix` as part of this task.  
* Do not add packages unless the implementation or test requires them.  
* Keep the exact DBOS SDK pin at `5.5.0` unless a demonstrated incompatibility requires a separately documented decision.

Do not change the unrelated vault behavior. Do not edit V1, V2, V2.1, `plan6`, or other planning documents.

All prototype code and test utilities stay under `phase0/`. Runtime data, temporary PostgreSQL files, secrets, and raw logs stay outside the repository. Generated evidence committed to the repository must be sanitized.

Permitted repository changes remain limited to the approved dependency/lockfile changes and `phase0/` artifacts. If a change outside that boundary becomes necessary, explain why and request approval before making it.

## **7\. Gate D and P2 are not authorized by Gate C**

Prepare the P2 scripts, Fly configuration proposal, health/readiness checks, and evidence-capture procedure inside the permitted Phase 0 area.

Do not deploy to Fly, create or modify a staging app, change production configuration, or use billable cloud resources as an assumed continuation of Gate C. Gate D requires its own staging authorization and available account access.

Do not add a Postgres advisory-lock fence unless a real staging test demonstrates overlapping executors. The P2 test must prove the actual worker replacement behavior, not just validate the configuration text.

## **8\. Evidence and report requirements**

Maintain a test matrix with one row per acceptance case:

| Field | Required content |
| ----- | ----- |
| Test ID | P1, P3, or backpressure case |
| Requirement | Exact behavior being proved |
| Environment | Local PostgreSQL version and relevant SDK version |
| Command | Exact reproducible command |
| Result | PASS, FAIL, BLOCKED, or NOT RUN |
| Evidence | Relevant sanitized output and database/provider counts |
| Notes | Failure diagnosis, limitations, or follow-up |

Do not claim a test passed because code was written or a test was added. It passes only after the command ran and the expected assertions were observed.

The final Phase 0 report must include:

1. Actual baseline and environment versions, including any new PostgreSQL installation.  
2. Exact lockfile integrity correction summary and verification method.  
3. P1 results, with concurrency and database evidence.  
4. P3 results, with provider/operation/attempt/settlement evidence.  
5. Backpressure results and measured pool behavior.  
6. P2 preparation status, clearly separated from staging proof.  
7. Repository diff and confirmation that protected documents and application code remain unchanged.  
8. Remaining failures, limitations, blocked gates, and owner decisions.  
9. A `PROCEED`, `FIX`, or `STOP` recommendation using the existing Phase 0 criteria.

Retain the known `vault.test.ts` baseline failure as a pre-existing issue unless a separate owner decision resolves it. Report any new regressions independently.

## **9\. Stop conditions**

Stop and request user input only when one of these conditions is true:

* local PostgreSQL provisioning requires a privileged or externally billable action not already authorized;  
* the only viable Gate C option is a new cloud resource requiring account approval;  
* the target database cannot be proven to be disposable and non-production;  
* a necessary change falls outside the approved repository boundary;  
* an implementation decision would change the V2.1 architecture rather than complete its proof;  
* the evidence exposes a genuine correctness, tenant-isolation, recovery, or security problem that cannot be corrected within the existing design.

When stopped, report the exact blocker, what has already been completed, and the smallest approval or decision required. Do not repeatedly ask broad questions or wait for the user to choose between routine engineering alternatives.

## **Final instruction**

Proceed autonomously with local Gate C provisioning and P1/P3 implementation and execution, subject to the boundaries above.

Optimize for correctness, reproducibility, security, and minimum operational complexity—not for the number of files produced or the appearance of a green report.

Do not begin Phase 1\. Do not reopen the architecture review. Do not rewrite V2.1. Prove the existing design, report what the evidence actually establishes, and recommend the next step.

**The intended authority boundary:** local disposable infrastructure and isolated Phase 0 implementation are delegated to the coding agent; new cloud spending, account permissions, production changes, and architecture changes are not. This gives the agent room to do real engineering without silently expanding the project's risk or cost.

