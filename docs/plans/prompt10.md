Absolutely. **We should test locally first and push only after the local tests pass.** We have been using GitHub Actions to discover problems that should ideally have been caught before a push. That is wasting time.

There is one environmental complication: your Mac was reported as macOS 12.7.6, which does not support the officially available Docker Desktop or Colima versions identified in the earlier investigation. However, the subsequent review reported that PostgreSQL 16.16 was already running locally at `127.0.0.1:5433`.

I would use that existing PostgreSQL installation.

## **The improved workflow**

Separate the tests into two concerns:

| Test | Where |
| ----- | ----- |
| TypeScript, unit tests, guard logic | Local Mac |
| P1 atomic enqueue and concurrency | Local PostgreSQL |
| P3 wallet, crash recovery and sweeper | Local PostgreSQL |
| Backpressure and connection limits | Local PostgreSQL |
| Repeated runs and SIGKILL tests | Local PostgreSQL |
| Testcontainers image identity and Docker networking | CI, unless a supported local container runtime becomes available |
| Fly worker replacement and Neon compatibility | Staging |

The crucial point: **use the same test suites and assertions, but allow different PostgreSQL provisioning methods.**

Local native PostgreSQL and CI Testcontainers can exercise the same integration tests. The only difference is how PostgreSQL is supplied.

## **Give the agent this directive**

# **OpenLevel — Local-First Verification Before Further GitHub Pushes**

## **Objective**

Stop using GitHub Actions as the first place to discover ordinary implementation and PostgreSQL integration defects.

Establish and execute a local-first verification cycle before any further push.

The owner's Mac was previously observed to have PostgreSQL 16.16 running on `127.0.0.1:5433`, with a disposable `phase0_proofs` database and SCRAM credentials.

First verify whether that environment is still available.

Do not assume Docker Desktop or Colima can be installed on the previously identified macOS 12.7.6 machine.

**Do not push any additional commits during this task.**

## **1\. Verify the available local environment**

Inspect the actual Mac:

* PostgreSQL server and client versions.  
* Existing server process and listening address.  
* Port 5433\.  
* Database `phase0_proofs`.  
* Restricted runtime role.  
* SCRAM authentication.  
* Existing ignored Phase 0 credentials.  
* Current branch, commit, and uncommitted changes.

Verify the database identity and permissions before running any destructive operation.

If the existing PostgreSQL instance is available and matches the safety requirements, reuse it.

Do not reinstall PostgreSQL or create another database unnecessarily.

If the existing database is absent or unsuitable, use the existing local PostgreSQL runbook. Do not install an unsupported Docker runtime.

## **2\. Provide an explicit native-PostgreSQL provisioning mode**

Inspect `phase0/test-env.ts`.

If it currently requires Testcontainers unconditionally, implement the smallest safe extension to support:

`PHASE0_PROVISIONER=native`

The native provisioning adapter must:

* Connect only to an explicitly configured disposable local PostgreSQL database.  
* Require a strict loopback connection.  
* Verify actual live server identity.  
* Enforce SCRAM authentication.  
* Use the restricted Phase 0 runtime role for integration tests.  
* Verify the PostgreSQL version.  
* Run existing Phase 0 database setup.  
* Execute the existing P1, P3, and backpressure suites unchanged.  
* Reconcile evidence before cleanup.  
* Clean only Phase 0-created database objects.  
* Never stop or remove the owner's existing PostgreSQL installation.  
* Never drop a database or role that was not explicitly created and verified for this run.

Keep the Testcontainers provisioning adapter unchanged for CI.

Do not create duplicate test implementations, alternative business logic, or separate assertions.

Both provisioning modes must execute the same integration suites and acceptance criteria.

If this adapter already exists, use it rather than implementing another one.

## **3\. Fix and verify the current image-provenance issue separately**

The missing `RepoDigests` failure is specific to container image verification.

Do not weaken image identity checks or accept mutable image tags.

Locally, verify all provenance decision logic and its regression tests.

If the Mac has no supported container runtime, mark actual Docker image startup and bridge-network verification as BLOCKED pending CI.

Do not claim native PostgreSQL tests prove Testcontainers behavior.

## **4\. Execute the local verification sequence**

Run:

1. Root TypeScript typecheck.  
2. Phase 0 TypeScript typecheck.  
3. All Phase 0 unit tests.  
4. Full application baseline comparison.  
5. Native PostgreSQL preflight.  
6. P1 complete integration suite.  
7. P3 complete integration suite.  
8. Backpressure suite.  
9. Complete Phase 0 run a second time against retained database state.  
10. Twenty consecutive SIGKILL iterations.  
11. Provider journal versus database ledger reconciliation.

Use the exact existing test assertions.

Do not weaken timeouts or concurrency tests to manufacture passing results.

Verify that the `host(inet_server_addr())` correction works with native PostgreSQL.

The container-interface acceptance path remains separately tested by the Docker/CI suite.

## **5\. Root-cause discipline**

For every failure:

* Identify the underlying cause.  
* Determine whether the failure belongs to application logic, PostgreSQL, DBOS, provisioning, networking, or the test harness.  
* Correct the underlying problem rather than bypassing the assertion.  
* Add a regression test that proves the intended invariant.  
* Rerun the affected suite and relevant complete suite.

Do not turn an infrastructure failure into an application test pass.

## **6\. Evidence**

Record:

* Actual PostgreSQL version and address.  
* Runtime role and authentication method.  
* SDK version.  
* Exact commands.  
* Per-suite results and timings.  
* P1 event/workflow counts.  
* P3 provider, operation, attempt, reservation, settlement, and balance assertions.  
* Backpressure measurements.  
* Second-run results.  
* Twenty SIGKILL results.  
* Reconciliation results.  
* Database cleanup result.

Mark Docker-specific tests BLOCKED where the actual container runtime is unavailable.

## **7\. Git boundaries**

Do not push or force-push.

Do not modify master.

Do not include existing unrelated working-tree changes.

Keep corrections within the approved Phase 0 implementation and testing infrastructure.

Report the local commit and exact pending changes.

## **8\. Completion decision**

When local verification finishes:

* **LOCAL PASS:** P1, P3, backpressure and required reliability tests pass against real PostgreSQL.  
* **LOCAL FIX:** a correctable test or implementation issue remains.  
* **LOCAL BLOCKED:** an actual host capability prevents execution.

Only after LOCAL PASS should the agent recommend another push.

The next CI run should then focus on the remaining container-specific acceptance, not rediscover failures that could have been found locally.

Do not begin Phase 1 or reopen architecture decisions.

**The objective is one reliable local verification cycle followed by one meaningful CI validation—not repeated push, fail, fix, push cycles.**

## **One important distinction**

The `RepoDigests` problem cannot be fully proven using native PostgreSQL. It belongs to the Testcontainers provisioning layer. We should test the application and DBOS behavior locally first, then use CI once to validate the exact Docker image and networking behavior.

That is a much better division of effort.

**Going forward, our rule should be: local verification first, CI second, staging third, production last.**

