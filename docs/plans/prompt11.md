**I approve the two-track approach. This is the right way to avoid wasting another cycle on GitHub CI failures.**

Track A develops and validates the native PostgreSQL provisioner. Track B uses that provisioner to obtain actual database evidence on the Mac. The Testcontainers implementation remains intact for CI.

I would authorize the work with four additional safeguards.

## **Four conditions before implementation**

**1\. One test harness, two provisioning adapters.**

Keep the P1, P3, and backpressure tests completely unchanged in their business assertions.

The provisioner should supply a database connection and an environment-cleanup strategy. The test suites should not need to know whether PostgreSQL came from Testcontainers or an existing native installation.

**2\. Explicit ownership of native PostgreSQL resources.**

This is important because the native provisioner connects to an existing database server.

| Resource | Native mode cleanup |
| ----- | ----- |
| Owner's PostgreSQL server | Never stop |
| Existing database | Never drop |
| Existing PostgreSQL installation | Never modify or uninstall |
| Pre-existing roles | Never drop |
| Phase 0 schemas/tables created by this run | Clean only when ownership is established |
| Phase 0 test records | Clean according to run identity |

In particular, do not interpret the name `phase0_proofs` as proof that the agent owns the database.

**3\. SCRAM must be demonstrated, not inferred.**

Verify the applicable `pg_hba.conf` rule, runtime-role login, and SCRAM password verifier. A successful TCP connection alone does not establish that SCRAM was used.

**4\. Keep container provenance separate.**

Native mode must not set or inherit the verified-container environment variables. It must use strict loopback verification. The container adapter must retain exact image, container, network-interface, and port-binding checks.

The failed `RepoDigests` CI issue remains a separate Docker-specific task.

## **Approved coding-agent directive**

# **OpenLevel Phase 0 — Execute Track A and Prepare Track B**

## **Authorization**

Approved to implement the two-track plan.

### **Track A — This execution environment**

Implement the native PostgreSQL provisioning adapter, verify provenance decision logic, execute static gates, and prepare the complete owner-side execution package.

### **Track B — Owner Mac execution**

Provide a ready-to-run command sequence using the native PostgreSQL adapter. Once actual sanitized evidence is supplied, reconcile it against the acceptance matrix and issue the final Phase 0 verdict.

Do not push to GitHub, modify master, or start Phase 1\.

## **1\. Root-cause objective**

Do not merely introduce a switch that makes the current PostgreSQL command execute.

Solve the underlying environment portability problem:

* PostgreSQL provisioning must be independent from test logic.  
* Native PostgreSQL and Testcontainers must exercise the same P1/P3/backpressure suites.  
* Neither provisioning path may weaken database safety.  
* Resource ownership and cleanup must be explicit.  
* Evidence collection and reconciliation must be independent of provisioning method.

The goal is a portable test harness, not two separate testing systems.

## **2\. Native provisioner implementation**

Inspect `test-env.ts`, `db-guard.ts`, `setup-db.ts`, `preflight.ts`, and all existing suite entrypoints.

Implement an explicit `PHASE0_PROVISIONER` selection:

* `testcontainers`: preserve existing Testcontainers behavior.  
* `native`: connect to an explicitly configured, verified local PostgreSQL instance.

Default behavior must be explicit and documented. Do not silently switch provisioners when one fails.

The native adapter must:

* Require a PostgreSQL URL explicitly supplied for Phase 0\.  
* Enforce strict loopback client destination.  
* Verify the actual database and server identity.  
* Verify PostgreSQL version compatibility.  
* Verify listener address and port.  
* Verify SCRAM authentication through the applicable configuration and role credential.  
* Verify the restricted `phase0_rt` role is the actual test runtime identity.  
* Reject unknown or mismatched databases and roles.  
* Ensure container-verification environment variables cannot leak into native mode.  
* Execute the existing setup and suite entrypoints without duplicating business test logic.

## **3\. Resource ownership and cleanup**

Treat an existing native PostgreSQL server as owner-controlled infrastructure.

Never stop it, restart it, uninstall it, change its global configuration, or drop an existing database or role.

Track ownership explicitly for any Phase 0 object created by this run.

Cleanup may remove only resources proven to have been created by the current Phase 0 execution.

Use per-run identity and explicit ownership records. Database naming alone does not prove ownership.

Preserve the database state for the required retained-database rerun. Perform final cleanup only after the complete evidence and reconciliation have been persisted.

If ownership cannot be proven, do not delete the resource. Report it as retained.

## **4\. Provisioner isolation**

Implement the adapter as a clean lifecycle boundary:

`provision → verify → prepare → execute → reconcile → persist evidence → teardown`

The Testcontainers adapter retains its existing image-provenance and network-verification behavior.

The native adapter must not reuse or bypass container-identity assertions. Each mode should have independent provisioning-specific checks, while sharing the same test suites and business invariants.

Do not let a native-mode pass count as evidence of Docker image provenance or container-network security.

## **5\. Track A static validation**

Execute:

* Root TypeScript typecheck.  
* Phase 0 TypeScript typecheck.  
* All Phase 0 unit tests.  
* Provenance unit tests.  
* Native-provisioner guard tests.  
* Native-mode no-database dry-run and failure tests.  
* Test-env lifecycle and cleanup ownership tests.  
* Full application baseline comparison.  
* Git diff and repository-boundary inspection.

The native dry-run can prove configuration validation and refusal behavior. It cannot prove live PostgreSQL connectivity, SCRAM, atomic enqueue, or wallet transaction correctness.

Do not claim database acceptance from static tests.

## **6\. Track B owner execution package**

Create a concise execution procedure using the native provisioner.

It must include:

1. Environment and database identity preflight.  
2. Runtime-role and SCRAM verification.  
3. Database setup.  
4. P1 integration suite.  
5. P3 integration suite.  
6. Backpressure suite.  
7. Retained-database complete rerun.  
8. Twenty-iteration SIGKILL reliability test.  
9. Provider journal versus database ledger reconciliation.  
10. Evidence persistence and safe cleanup.

Use one primary command where practical, with individual commands available for diagnosis.

Record the exact expected artifacts and sanitization requirements.

Never ask for credentials to be pasted into chat.

## **7\. Evidence and final decision**

Preserve the existing seven-column acceptance matrix.

Keep Docker-specific rows BLOCKED until actual container execution and image-provenance verification succeed.

When Track B output arrives, reconcile the actual:

* PostgreSQL version and address.  
* Server and client identities.  
* Runtime role and SCRAM verification.  
* DBOS SDK version.  
* P1 event/workflow and transaction results.  
* P3 provider, operation, attempt, reservation, settlement, and balance results.  
* Backpressure connection measurements.  
* Retained-database rerun.  
* SIGKILL iteration results.  
* Cleanup ownership and results.

Classify each result as PASS, FAIL, BLOCKED, or NOT RUN.

Apply root-cause discipline to failures: identify the mechanism, correct the underlying defect, add regression coverage, and rerun the affected and complete suites. Never weaken assertions or hide failures.

## **8\. Git boundaries**

Commit only approved Phase 0 implementation changes locally on `phase0/automated-testing`.

Exclude `.gitignore`, `deepwiki.md`, existing `docs/`, and unrelated changes.

Do not push. Do not contact master. Do not force-push.

Report the local commit SHA and complete pending delta.

## **Final deliverable**

Produce:

* Native provisioner implementation.  
* Updated test execution instructions.  
* Static verification evidence.  
* Updated acceptance matrix.  
* Explicit container-specific BLOCKED status.  
* Local commit SHA.  
* Track B command package.

Stop after Track A is complete and ready for owner-side execution.

Do not begin Phase 1 or reopen architecture decisions.

## **My final recommendation**

Proceed with Track A.

I especially want the agent to solve **resource ownership and lifecycle separation properly**, because those decisions will benefit every future OpenLevel test—not just this Phase 0 exercise.

The longer-term developer experience should remain:

```
npm run test:phase0
```

The provisioner decides how to obtain PostgreSQL. The tests should not care. The evidence should be consistent. Cleanup should be automatic and safe.

That's the infrastructure standard we should aim for across OpenLevel.

