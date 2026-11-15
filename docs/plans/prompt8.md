You're right. **We have made the testing process considerably more complicated than it needs to be.** Some of the engineering safeguards are justified, but the way we arranged the work created unnecessary operational complexity.

If I were designing this from scratch, I would not ask a coding agent to install PostgreSQL, bootstrap local roles, manage passwords, verify a local installation, execute tests, reconcile logs manually, and then remove a database and eject a disk image.

I would make the test environment disposable and self-managing.

## **1\. Why the process became complicated**

Four concerns became entangled:

1. **The sandbox limitation:** the coding agent cannot open sockets or create PostgreSQL shared memory. This is an execution-environment restriction, not an OpenLevel defect.  
2. **The proof requirement:** we correctly insisted on real PostgreSQL for DBOS integration tests rather than accepting PGlite or mocks as evidence.  
3. **Security requirements:** disposable database isolation, SCRAM authentication, restricted roles, and protection against accidentally targeting production.  
4. **Autonomy:** we tried to give an agent operating inside an isolated environment responsibility for infrastructure running outside that environment.

The fourth problem is the fundamental one. We kept adding procedures to bridge two environments that the agent could not actually control.

We should change the execution model instead of adding more procedures.

## **2\. What industry practice recommends**

The established pattern is **ephemeral infrastructure for integration tests**.

A test run should create its own database, execute migrations and tests, save its results, and destroy the database automatically.

This is especially relevant to DBOS. Its documentation distinguishes unit testing, which can mock DBOS and does not require PostgreSQL, from integration testing, which requires a real PostgreSQL database. It also demonstrates resetting the test database between integration tests.

DBOS Docs+1

There are two common ways to achieve this.

**Testcontainers:** the test process starts a real PostgreSQL container, waits until it is ready, obtains its connection details, runs the tests, and stops the container. The Node.js PostgreSQL module supports this lifecycle directly.

Testcontainers for NodeJS+1

**CI service containers:** GitHub Actions starts a PostgreSQL service for a job. The runner waits for its health check, executes the tests, and discards the environment after the job.

GitHub Docs

Neither requires the developer to install a separate PostgreSQL server, create databases manually, or eject a DMG.

## **3\. What I would build for OpenLevel**

I'd separate testing into four layers.

**Layer 1 — Unit tests**

Every commit

Pure TypeScript logic, mocked external providers, wallet calculations, state transitions, validation, and error handling.

No PostgreSQL or Docker required.

**Layer 2 — PostgreSQL integration**

Every pull request

An ephemeral, real PostgreSQL instance with DBOS 5.5.0. Run P1, P3, concurrency, backpressure, migrations, and the workflow recovery tests.

Automatically provisioned and destroyed.

**Layer 3 — Reliability tests**

Nightly / on demand

Repeated SIGKILL tests, retained-database reruns, concurrency stress, recovery and race-condition tests.

Preserve detailed failure artifacts.

**Layer 4 — Deployment acceptance**

Staging only

Actual Fly Machine replacement, DBOS worker recovery, Neon connectivity, rolling deployments, health checks, and operational monitoring.

This is the only layer that needs actual Fly and Neon infrastructure.

This separation is important. A local PostgreSQL test should not require a Fly deployment. A Fly deployment test should not require manually repeating every unit test.

### **3.1 My preferred implementation: GitHub Actions first, Testcontainers locally**

Because the current agent sandbox cannot start PostgreSQL, I would make GitHub-hosted CI the primary execution environment.

The workflow would:

1. Start a pinned PostgreSQL 16 or 17 service container.  
2. Generate disposable credentials.  
3. Configure SCRAM authentication.  
4. Install dependencies using `npm ci`.  
5. Run the Phase 0 typecheck and unit tests.  
6. Create the test database and restricted runtime role.  
7. Run P1, P3 and backpressure against real PostgreSQL.  
8. Run the second execution and reliability tests.  
9. Save sanitized reports and logs as downloadable CI artifacts.  
10. Destroy the environment automatically.

GitHub documents PostgreSQL service containers and health checks as a standard workflow pattern.

GitHub Docs

For developers running locally, I would use Testcontainers with the same pinned PostgreSQL image. One command should start the database, run the suites, and clean up afterward.

Testcontainers for NodeJS

The official PostgreSQL Docker image supports SCRAM authentication; PostgreSQL 14 and later use SCRAM by default for host authentication unless configured otherwise. We can explicitly enforce it rather than implement a custom bootstrap-auth procedure.

GitHub+1

### **3.2 What the single command should look like**

The target developer experience should be:

```
npm run test:phase0
```

Internally, the script handles everything:

```
Check Docker availability
        |
Start pinned PostgreSQL container
        |
Wait for PostgreSQL readiness
        |
Generate credentials
        |
Create test database and roles
        |
Apply application and DBOS schemas
        |
Run P1 tests
        |
Run P3 tests
        |
Run backpressure tests
        |
Repeat selected recovery tests
        |
Reconcile provider journal and wallet ledger
        |
Write sanitized evidence
        |
Stop and remove PostgreSQL container
        |
Exit with correct status
```

On success, the container disappears. On failure, the script can preserve the container temporarily with an explicit debugging option.

There should be no Postgres.app installation, embedded PostgreSQL package, manual role creation, manual database cleanup, or DMG management in the normal testing workflow.

One important detail: use a separate database or isolated test identity for each full run, so DBOS workflow histories from one execution cannot contaminate another. Testcontainers should not be allowed to make the database disappear before the evidence has been saved.

## **4\. Where Neon and Fly still fit**

I would not use Neon for every integration test.

A container running actual PostgreSQL is sufficient to prove the core transactional behavior, DBOS enqueue semantics, rollback, wallet concurrency, and recovery logic against the selected PostgreSQL major version.

Neon has its own characteristics worth validating: pooled versus direct connections, TLS, connection limits, and hosted infrastructure behavior. Those should be covered by a smaller, separate staging smoke suite.

Neon's own branching workflow supports isolated database branches for individual pull requests or test runs, with automatic deletion after the run.

Neon+1

Fly deployment tests are different again. You cannot conclusively simulate Fly Machine replacement by killing a local Node process. P2 must run against an actual staging Fly application.

So the infrastructure requirements become:

| Environment | Purpose |
| ----- | ----- |
| Local Testcontainers | Developer integration tests |
| GitHub Actions \+ PostgreSQL | Repeatable CI and Phase 0 P1/P3 proofs |
| Neon branch | Hosted PostgreSQL compatibility checks |
| Fly \+ Neon staging | Actual deployment and worker recovery proof |
| Production | Real customer workloads only |

## **5\. What I would simplify in the existing Phase 0 work**

I would retain the valuable engineering work already completed:

* Database-target safety.  
* Restricted runtime roles.  
* SCRAM authentication.  
* Atomic enqueue implementation.  
* Provider-attempt state machine.  
* Wallet reservation and settlement protections.  
* Sweeper concurrency protections.  
* SIGKILL recovery tests.  
* Evidence matrix and lockfile audit.

But I would stop treating the manual local runbook as the primary product of this work.

It becomes a fallback diagnostic procedure. The automated test harness becomes the primary interface.

I would also simplify evidence collection. One JSON test report, one sanitized execution log, and a small reconciliation report are sufficient for a successful run. We should not need to manually assemble a large collection of logs and SQL output every time.

For the twenty-iteration SIGKILL loop, I would run a short version on every pull request and reserve the full reliability loop for nightly or release verification. This gives fast feedback without making every code change wait for a long stress run.

## **6\. The bigger architectural lesson**

I think this lesson applies beyond Phase 0\.

We are building a SaaS that will eventually have a lot of moving parts: Neon, Fly, DBOS, AI providers, messaging integrations, billing, and multiple tenants.

**We should not make the operator responsible for coordinating all those moving parts manually.**

The platform's own tooling should provision, validate, test, deploy, observe, and clean up as much as possible.

That is part of making this product commercially viable. A system that only its original developer can safely operate is not a good SaaS foundation.

The engineering objective should be:

* One command to run tests.  
* One command to start the development environment.  
* One repeatable deployment pipeline.  
* Automated database migrations.  
* Automated health checks.  
* Automated evidence and diagnostics.  
* Explicit approval only for genuinely risky or billable operations.

This is consistent with the reason we chose DBOS in the first place: replace fragile, hand-managed operational behavior with durable, explicit, verifiable mechanisms.

## **7\. What I recommend doing now**

I would make one infrastructure improvement before allowing Phase 0 to consume more manual effort:

**Have the coding agent implement a self-contained GitHub Actions Phase 0 integration-test workflow using an ephemeral PostgreSQL service.**

Keep the existing local runbook, but stop making the Mac-local PostgreSQL procedure the only way to execute the tests. The workflow should use the exact pinned SDK and PostgreSQL major version, preserve all existing assertions, and upload sanitized evidence.

Do not rewrite the tests or discard the remediation work. Adapt the execution harness around it.

One qualification: the sandbox restriction may still prevent the agent from pushing workflow changes or accessing GitHub directly. In that case, a GitHub-hosted runner can still execute the workflow once the change is committed through the normal repository process. We should not attempt to defeat the sandbox restrictions.

**My guiding principle from here:** automate the environment, not just the application. We have spent enough effort manually preparing a database to prove that the database-backed application works. The next version of this process should make that preparation invisible to the developer.

# Prompt

I would ask the implementation agent for a **concrete implementation plan, not another architecture review**. The key objective is to make PostgreSQL provisioning, testing, evidence collection, and cleanup automatic while preserving the work already completed.

Give it this prompt:

# **OpenLevel — Plan the Automated Testing and Infrastructure Workflow**

## **Objective**

Develop an implementation plan to eliminate manual infrastructure provisioning and test orchestration from OpenLevel's development workflow.

The guiding principle is:

**Automate the environment, not just the application.**

A developer or coding agent should be able to run one command, obtain a real and reproducible PostgreSQL/DBOS test environment, execute the required tests, collect trustworthy evidence, and have the environment cleaned up automatically.

The current Phase 0 work has required excessive manual intervention because the coding agent sandbox cannot bind network sockets or create PostgreSQL shared memory. We must stop treating a manually installed PostgreSQL server as the primary way to execute integration tests.

Your task is to inspect the actual repository and existing Phase 0 implementation, then produce an actionable implementation plan.

**Planning only. Do not modify source code, dependencies, GitHub Actions, infrastructure, or configuration yet.**

## **1\. Inspect the actual implementation first**

Inspect:

* `package.json` and `package-lock.json`.  
* Existing TypeScript and Vitest configurations.  
* Everything under `phase0/`.  
* `LOCAL_POSTGRES_RUNBOOK.md`.  
* `SAFEGUARDS.md`.  
* `EVIDENCE_MATRIX.md`.  
* `REMEDIATION_REPORT.md`.  
* `ADVERSARIAL_REVIEW.md`.  
* Current database setup, connection guards, P1/P3 test harnesses, fake provider, crash runner, evidence generation, and cleanup scripts.  
* Existing GitHub Actions workflows, if any.  
* Current repository status and approved changes.

Do not assume the previous reports describe the current checkout accurately. Verify actual files and current implementation.

Record the current baseline and preserve all existing Phase 0 work.

## **2\. Design the automated testing architecture**

Plan a four-layer testing strategy.

### **Layer 1 — Fast unit tests**

Run on every commit and pull request.

Examples:

* Pure business logic.  
* Validation and tenant-context checks.  
* Wallet calculations and state transitions.  
* Idempotency and conflict mapping.  
* Provider adapter behavior using fakes.  
* Retry and error handling.

These should not require PostgreSQL or Docker.

### **Layer 2 — Real PostgreSQL integration tests**

Run automatically on every pull request.

The environment must use:

* Real PostgreSQL, not PGlite.  
* A pinned PostgreSQL major/minor or image tag, compatible with the intended Neon deployment.  
* The exact pinned `@dbos-inc/dbos-sdk@5.5.0`.  
* SCRAM authentication.  
* Disposable database and runtime credentials.  
* Restricted runtime role.  
* Real transaction behavior and concurrent database connections.

Compare two approaches:

**Option A — Testcontainers for Node.js**

The test process creates PostgreSQL, waits for readiness, obtains its connection string, runs the tests, collects evidence, and destroys the container.

**Option B — GitHub Actions PostgreSQL service container**

GitHub Actions provisions PostgreSQL for the job. The existing test harness connects to the service using the job's environment variables.

Evaluate operational complexity, reproducibility, security, cost, developer experience, and compatibility with the current test harness.

Recommend the simplest architecture that supports both local development and CI without creating two different test implementations.

Prefer one test entrypoint and one shared test harness. Differences between local and CI should be limited to how PostgreSQL is provisioned.

### **Layer 3 — Reliability and recovery tests**

Run nightly, on demand, or before release.

Include:

* Repeated P1 concurrency tests.  
* P3 crash tests.  
* Provider-accepted-then-SIGKILL recovery.  
* Twenty consecutive SIGKILL iterations.  
* Wallet and sweeper race tests.  
* Backpressure and connection saturation.  
* Repeated complete test execution against retained database state.  
* Provider journal versus application ledger reconciliation.

Do not make every pull request wait for the full reliability suite if a smaller representative test set can provide fast feedback. Define which tests run on every PR and which run on the extended schedule.

### **Layer 4 — Deployment acceptance**

Keep actual Fly.io \+ Neon deployment acceptance separate.

This layer must test:

* Fly Machine replacement.  
* Single-worker executor identity and overlap.  
* Worker readiness and heartbeat.  
* SIGTERM drain.  
* DBOS recovery after replacement.  
* Neon direct versus pooled connection behavior.  
* Deployment and migration behavior.

Do not pretend Testcontainers can prove Fly deployment semantics. Do not introduce staging resource creation into ordinary pull-request tests.

## **3\. Define the ideal developer experience**

The target interface should be:

```
npm run test:phase0
```

The command should orchestrate the entire integration-test lifecycle.

Plan the internal sequence:

1. Verify required local tooling.  
2. Provision or connect to an isolated disposable PostgreSQL instance.  
3. Generate temporary credentials.  
4. Enforce loopback/network isolation and SCRAM authentication.  
5. Verify database identity and runtime-role privileges.  
6. Apply application and DBOS schemas.  
7. Execute the P1 suite.  
8. Execute P3 and backpressure suites.  
9. Repeat the required retained-database tests.  
10. Execute the configured reliability tests.  
11. Reconcile provider-side journal entries against database operations, attempts, reservations, and settlements.  
12. Produce sanitized evidence.  
13. Destroy the temporary environment on success.  
14. Preserve sufficient diagnostic information on failure.

The script must have deterministic exit codes.

A failed test must not be disguised by later successful cleanup. A cleanup failure must be reported separately from test success.

The environment must never use production credentials or production database targets.

The existing manual PostgreSQL runbook remains a fallback diagnostic procedure, not the normal development workflow.

## **4\. Design local and CI provisioning consistently**

The plan must explain how local developers and GitHub Actions obtain the same PostgreSQL environment.

Preferred direction:

* Local developers use Testcontainers with Docker, if available.  
* GitHub Actions uses an ephemeral PostgreSQL environment on a hosted runner.  
* Both use the same pinned database image/version and the same test harness.  
* No developer has to install Postgres.app, create roles manually, generate database passwords manually, or eject DMGs during normal testing.

Consider whether one Testcontainers implementation can serve both environments with minimal configuration differences.

If GitHub Actions service containers are simpler or more reliable, explain why. Do not choose Testcontainers merely because it is fashionable.

Identify all required packages, scripts, environment variables, workflow files, permissions, and image pins. Do not install anything now.

## **5\. Evidence must survive automatic cleanup**

Preserve the existing evidence requirements.

A successful run should produce a compact evidence package containing:

* PostgreSQL version and image digest.  
* DBOS SDK version.  
* Test command and execution identity.  
* Per-suite counts, timings, and outcomes.  
* P1 row/workflow counts.  
* P3 operation, attempt, provider, reservation, and settlement counts.  
* Final wallet balances.  
* Backpressure and connection-census measurements.  
* Provider journal versus application ledger reconciliation.  
* Sanitized failure excerpts.  
* Cleanup result.

Prefer machine-readable JSON plus a concise Markdown summary.

Do not require manually copying SQL output or log fragments.

Capture reconciliation results while the database is still available. Persist the evidence before destroying the environment.

On failure, support an explicit diagnostic mode that retains the disposable database/container temporarily. It must never retain credentials in logs or commit them to Git.

## **6\. Security and safety design**

The plan must preserve:

* Disposable-target validation.  
* SCRAM authentication.  
* Restricted runtime role.  
* Separate bootstrap privileges.  
* Explicit database identity verification.  
* No untrusted connection-string overrides.  
* No production credentials.  
* Redacted logs and stack traces.  
* Unique test-run identities.  
* Safe cleanup that cannot drop unrelated databases or resources.

Temporary credentials should be generated inside the test process or CI job.

Do not introduce manual secret handling where no external secret is required.

GitHub Actions should use no production secrets for PostgreSQL integration tests. The database credentials should be generated for the job and discarded when the runner is destroyed.

## **7\. CI workflow and branch protection**

Plan a GitHub Actions workflow that:

* Runs on relevant pull requests and pushes.  
* Uses pinned Node.js 22 and `npm ci`.  
* Runs the root typecheck and separate Phase 0 typecheck.  
* Runs fast unit tests.  
* Runs real PostgreSQL integration tests.  
* Uploads sanitized artifacts even when tests fail.  
* Uses deterministic job status and clear failure summaries.

Plan a separate scheduled or manually triggered reliability workflow for extended crash/recovery testing.

Recommend which checks should be required branch-protection gates. Account for test duration and CI cost.

Do not make CI dependent on a Fly or Neon account for ordinary test execution.

## **8\. Preserve existing proof requirements**

The automated harness must not weaken or replace the current Phase 0 acceptance criteria.

All eight P1 cases, the P3 crash and safety cases, backpressure, retained-database reruns, and SIGKILL reliability scenarios must remain traceable.

Do not rewrite tests merely to fit a CI framework. Adapt the environment around the tests.

Explicitly identify any existing tests that are not yet suitable for automated execution and explain the smallest necessary change.

Keep the known pre-existing `vault.test.ts` failure separately classified until its own disposition is approved.

## **9\. Deliverables**

Create `phase0/AUTOMATED_TESTING_PLAN.md`.

The plan must include:

1. Current-state inspection and findings.  
2. Recommended architecture and a concise rationale.  
3. Comparison of Testcontainers versus GitHub Actions service containers.  
4. Local developer workflow.  
5. Pull-request CI workflow.  
6. Extended reliability workflow.  
7. Deployment acceptance boundary.  
8. Proposed package scripts and dependencies.  
9. Proposed GitHub Actions workflow files and permissions.  
10. Evidence and artifact lifecycle.  
11. Security and automatic cleanup behavior.  
12. Expected test execution time and CI cost estimates, clearly marked as estimates.  
13. Migration steps from the current manual runbook.  
14. Risks, assumptions, and acceptance criteria.  
15. An ordered implementation backlog with dependencies and definitions of done.

For proposed files, identify exact paths. Include a proposed command sequence and Mermaid architecture diagram if useful.

Distinguish actual repository findings from recommendations and assumptions.

## **10\. Constraints**

* Planning only: no source changes or dependency installation.  
* Do not modify V1, V2, V2.1, or prior plans.  
* Do not modify the existing Phase 0 implementation.  
* Do not change the DBOS/Fly/Neon architecture.  
* Do not introduce PostgreSQL mocks or PGlite as substitutes for integration tests.  
* Do not require manual database setup as the normal testing path.  
* Do not create cloud resources or incur additional billing.  
* Keep the plan focused on reducing operational complexity.

## **Final question the plan must answer**

**How do we get from the current manually provisioned Phase 0 test process to a one-command, reproducible, disposable PostgreSQL/DBOS test workflow that works both locally and in CI, with automatic evidence collection and cleanup?**

Deliver the plan, inspect the resulting repository delta, and stop. Do not implement it until the plan has been reviewed and approved.

**My preference:** the agent should recommend one shared test harness, with PostgreSQL provisioning abstracted behind it. That prevents us from building separate test logic for local development and CI. The implementation decision between Testcontainers and GitHub Actions service containers should be based on the actual repository and runner constraints—not preference or fashion.

