Agreed. The coding agent should now own the complete local execution, including PostgreSQL installation, credential generation, database setup, test execution, remediation of Phase 0 defects, evidence collection, and cleanup.

**You should not need to copy commands, provision the database, or manually relay test output.** Give it this authorization:

# **OpenLevel Phase 0 — Full Autonomous Local Execution Authorization**

## **Authorization**

You are authorized to complete the remaining local Phase 0 work autonomously on the owner's Mac.

The owner has approved the SCRAM-only PostgreSQL configuration and authorized you to perform the remaining local execution without requiring manual intervention.

Your task is no longer to prepare instructions for the owner. Your task is to execute them, correct implementation defects within the approved scope, collect evidence, and deliver the final Phase 0 report.

Do not ask the owner to install PostgreSQL, create databases, set passwords, run commands, or paste logs. Use your available local environment and tools.

## **1\. Establish the actual environment**

Inspect the local environment before making changes.

Identify:

* Repository root and current branch/commit.  
* Current working-tree changes.  
* Node.js and npm versions.  
* Exact installed `@dbos-inc/dbos-sdk` version.  
* PostgreSQL binaries and versions, if already installed.  
* Available package manager and local installation paths.  
* Existing PostgreSQL processes, ports, data directories, and databases.

Do not assume the sandbox and the owner's Mac have the same capabilities.

Reuse an existing suitable PostgreSQL installation when possible.

If PostgreSQL 16 or later is unavailable, autonomously install a suitable pinned version using the least disruptive user-local method. Prefer an isolated installation such as Postgres.app or a user-local package installation.

Do not upgrade unrelated packages, start a system-wide database service, change global machine configuration unnecessarily, or modify existing PostgreSQL installations.

## **2\. Provision isolated PostgreSQL**

Use the current `phase0/LOCAL_POSTGRES_RUNBOOK.md` as the authoritative procedure.

Create a dedicated disposable environment:

* PostgreSQL 16 or later.  
* Dedicated `phase0_proofs` database.  
* Dedicated bootstrap and restricted runtime roles.  
* Random, independently generated passwords.  
* Unique temporary data directory.  
* Loopback-only TCP listener.  
* Explicitly verified port.  
* SCRAM-SHA-256 password authentication.

The database must be demonstrably separate from every existing application or production database.

Use the following authentication sequence:

1. Inspect the fresh installation's local authentication configuration.  
2. Use a one-time local bootstrap connection only to establish the random bootstrap password and configure the intended authentication policy.  
3. Do not permit remote or TCP `trust` authentication.  
4. Configure and verify SCRAM for subsequent bootstrap and runtime connections.  
5. Verify the stored password verifier uses SCRAM-SHA-256.  
6. Ensure the restricted runtime role is used for DBOS execution and P1/P3 tests.

The bootstrap exception must be local, limited, and immediately closed once password authentication is configured. Record the actual authentication method used. Do not silently leave a `trust` rule in the active configuration.

Verify the five runbook checks:

* Listener address.  
* Active socket/listener and port.  
* Database identity.  
* Authentication configuration and applicable `pg_hba.conf` rules.  
* Successful SCRAM runtime-role login.

Run all identity and safety checks against the actual connections used for tests, not only in a separate preflight process.

Never expose passwords or full connection strings in console output, logs, shell tracing, Git, or reports.

## **3\. Run the complete proof sequence**

After provisioning and successful preflight, execute the exact runbook setup and proof commands.

Run in this order:

1. Preflight and live database verification.  
2. Database/schema setup using the bootstrap role.  
3. Verify restricted runtime-role privileges and login.  
4. P1 complete suite.  
5. P3 complete suite.  
6. Backpressure suite.  
7. Complete `run-all.sh` against the retained database a second time.  
8. Execute the 20-iteration SIGKILL reliability loop.

Use the existing test-run isolation and cleanup design. Do not drop DBOS workflow history between the two full runs merely to manufacture a passing result.

Capture the actual PostgreSQL version, runtime identity, SDK version, test counts, execution timings, database row counts, provider-side journal counts, and sanitized failures.

### **P1 acceptance**

All eight cases must pass with observed PostgreSQL evidence:

* Barrier-coordinated concurrent duplicate delivery.  
* Correct losing-request status.  
* Exactly one event generation and workflow.  
* Transaction rollback leaves no business event, synthetic domain mutation, or DBOS workflow records.  
* DBOS workflow-ID reuse behavior against SDK 5.5.0.  
* Post-completion duplicate convergence.  
* History-deletion fallback through the retained projection.  
* Same-key/different-payload conflict mapped to HTTP 409\.  
* Tombstone expiry followed by atomic new-generation creation.  
* Concurrent requests after expiry converge on exactly one new generation and workflow.  
* Unexpectedly missing projection/history fails closed.

Keep the eight named acceptance cases distinct in the evidence matrix even when a test exercises more than one assertion.

### **P3 acceptance**

All required crash and safety cases must run against real PostgreSQL with independent fake-provider evidence.

Verify:

* Crash after reservation and before dispatch.  
* Crash after durable dispatch state while provider outcome is unknown.  
* Provider accepts the operation, then the application process is killed before settlement.  
* Crash after settlement but before workflow completion.  
* Stale dispatching attempts transition to uncertain during recovery.  
* Re-running recovery cannot redispatch a potentially accepted operation.  
* Same-operation reservation races cannot double-debit.  
* Concurrent wallet exhaustion cannot make the balance negative.  
* Sweeper races cannot refund dispatched or uncertain operations.  
* Concurrent sweepers cannot create duplicate refunds.  
* Settlement replay does not double-settle.  
* All financial and provider-call assertions reconcile exactly.

A process-crash test must kill the actual child process and then recover from persistent PostgreSQL state in a separate process.

Do not substitute exceptions, mocked in-memory state, or manual database state transitions for the real recovery path.

### **Backpressure acceptance**

Run the full saturation test against PostgreSQL.

Observe and record:

* Configured pool size.  
* Number of concurrent contenders.  
* Actual PostgreSQL backend count during the flood.  
* Acquisition wait and timeout behavior.  
* HTTP response distribution.  
* Successful committed event count.  
* Failed transaction count.  
* Retry convergence.  
* Evidence that no event was acknowledged before commit.  
* Evidence that the process did not accumulate unbounded DBOS clients or database connections.

Do not claim a bounded request path solely because one pool is bounded.

## **4\. Remediate defects autonomously**

You may correct defects found during actual execution within `phase0/`.

Use the smallest correct change that preserves the approved V2.1 design.

Permitted work includes:

* Correcting test synchronization and race conditions.  
* Fixing database guards and restricted-role permissions.  
* Correcting state transitions, leases, and retry handling.  
* Fixing wallet reservation and sweeper concurrency.  
* Completing assertions and evidence collection.  
* Correcting log redaction, shell error handling, and cleanup.  
* Making test execution reproducible.  
* Updating Phase 0 runbooks and evidence matrix.

After each correction, rerun the targeted test, then the affected complete suite.

Do not weaken assertions, increase timeouts to conceal races, mark skipped tests as passed, or manually adjust database records to make an assertion succeed.

Keep the following unchanged:

* Application source outside `phase0/`.  
* V1, V2, and V2.1 architecture documents.  
* Planning documents.  
* Approved DBOS SDK pin.  
* Existing architecture and deployment topology.

Do not introduce advisory-lock fencing, additional services, another worker, Conductor, or architecture changes.

If the evidence demonstrates a genuine structural problem that cannot be solved within Phase 0, document it and stop at that specific boundary. Do not silently redesign the system.

## **5\. Repeatability and reliability**

The complete run must be reproducible against the retained disposable database.

The second `run-all.sh` execution must pass independently.

Run the provider-accepted-then-SIGKILL test 20 consecutive times where practical. Record every result. Any intermittent failure is a failure requiring diagnosis, not a result to average away.

If the database process exits, restart the same disposable instance and continue only after verifying its identity and authentication configuration.

If tests fail, diagnose and fix the cause where it is within the approved scope. Do not stop at the first fixable test failure.

## **6\. P2 remains preparation-only**

Do not deploy to Fly or Neon staging as part of this authorization.

Keep P2 staging proofs marked BLOCKED pending Gate D authorization.

Do not create billable cloud resources, use production credentials, or alter any remote environment.

## **7\. Evidence, security, and cleanup**

Persist sanitized evidence under `phase0/evidence/`.

Deliver:

* Complete Phase 0 run logs.  
* PostgreSQL version and configuration evidence.  
* SCRAM authentication and role verification.  
* Per-suite PASS/FAIL/BLOCKED/NOT RUN results.  
* Actual P1/P3/backpressure assertion counts and timings.  
* Second-run results.  
* Twenty SIGKILL iteration results.  
* Provider-journal versus application-ledger reconciliation.  
* Updated `EVIDENCE_MATRIX.md`.  
* Updated `REMEDIATION_REPORT.md` with final dispositions.  
* Final repository diff and protected-file integrity audit.

Verify the redaction of both normal and failure/stack-trace output. Never include credentials in the deliverables.

Only clean up the disposable PostgreSQL database, roles, data directory, and process after the evidence has been safely persisted and verified. If a test failure requires retaining state for diagnosis, preserve the scratch database, stop its server safely, and document the remaining cleanup.

Verify that no existing database, role, installation, or unrelated process was changed or removed.

## **8\. Final Phase 0 decision**

Produce the nine-item Phase 0 report and a clear decision:

* **PROCEED:** the required P1, P3, and backpressure proofs pass and the applicable approvals are satisfied.  
* **FIX:** a correctable implementation or test defect remains.  
* **STOP:** evidence establishes an unresolved structural correctness, security, tenant-isolation, or recovery failure.

Separate executed evidence from design assertions and blocked Gate D work.

List only V2.1 corrections demonstrated necessary by actual evidence. Do not invent additional architectural changes.

## **9\. Stop conditions**

Do not request manual intervention for routine engineering tasks, package installation, local role creation, password generation, or test execution.

Stop only when:

* The local OS denies a required operation and no safe user-local alternative exists.  
* An action requires elevated privileges that cannot be obtained through the authorized account.  
* A safe isolated database cannot be provisioned.  
* An operation would affect an existing database, production resource, or unrelated system configuration.  
* External billing or account authorization becomes necessary.  
* A demonstrated structural defect requires an architecture or application-scope change outside this authorization.

When stopped, report exactly what failed, what has been completed, and the narrowest required owner decision. Do not ask broad or repetitive questions.

## **Final instruction**

Take ownership of the remaining Phase 0 execution.

Provision the local database, verify SCRAM, execute P1/P3/backpressure, correct defects within `phase0/`, repeat the required tests, collect sanitized evidence, and produce the final report.

The owner should not have to act as the command runner or manually shuttle logs between tools.

Do not begin Phase 1\. Do not reopen the architecture review.

**The next deliverable is the completed Phase 0 evidence package and the demonstrated PROCEED/FIX/STOP decision.**

One boundary remains: agent autonomy does not mean bypassing macOS security prompts, exposing credentials, or modifying unrelated databases. Within those limits, the agent should execute—not hand the work back to you as a runbook.

