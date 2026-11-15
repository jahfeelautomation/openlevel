# **Independent Adversarial Code Review — OpenLevel Phase 0 Implementation**

## **Objective**

Adversarially review the completed Phase 0 implementation before the owner executes it against local PostgreSQL.

Assume the implementation contains defects until the code and tests demonstrate otherwise.

This is strictly an implementation review. Do not reopen V2.1, challenge approved architecture decisions, expand scope, or redesign the system.

**Review only. Do not modify files until findings have been reported and dispositioned.**

## **Scope**

Inspect every relevant file under `phase0/`, particularly:

* `db-guard.ts`  
* `setup-db.ts`  
* `preflight.ts`  
* `run-all.sh`  
* `LOCAL_POSTGRES_RUNBOOK.md`  
* P1 atomic-enqueue implementation and tests  
* P3 wallet/provider-attempt implementation and tests  
* Backpressure implementation and tests  
* SIGKILL worker/recovery harness  
* `EVIDENCE_MATRIX.md`  
* `evidence/LOCKFILE_AUDIT.md`

Inspect the exact SDK types and installed implementation for `@dbos-inc/dbos-sdk@5.5.0` where relevant.

## **1\. Database safety — highest priority**

Try to identify every way the scripts could connect to or modify the wrong database.

Verify:

* Database identity is checked before every destructive setup or cleanup operation.  
* Only explicitly recognized disposable database names are accepted.  
* URL parsing cannot be bypassed through case changes, URL encoding, alternate hosts, IPv6, query parameters, or unexpected connection options.  
* Production-like hosts and database names are rejected.  
* The runtime role has only the privileges required by the tests.  
* Bootstrap privileges are not accidentally retained by the runtime role.  
* SQL identifiers and passwords are handled safely.  
* Schema creation and cleanup cannot affect unrelated databases or schemas.  
* No cleanup command can drop a database, role, or schema outside the intended Phase 0 target.  
* Loopback-only binding and authentication requirements in the runbook are accurate.

Identify any time-of-check/time-of-use gap between preflight and actual database connection.

## **2\. P1 atomic enqueue correctness**

Attempt to disprove all eight P1 acceptance cases.

Pay particular attention to:

* Whether the business-event insert, domain mutation, and DBOS enqueue truly share one PostgreSQL transaction.  
* Whether concurrent contenders really synchronize at the intended race boundary.  
* Whether rollback leaves no partially committed business state or workflow.  
* Whether fixed workflow IDs and `workflowIDReusePolicy` behave as expected on SDK 5.5.0.  
* Whether the losing duplicate receives the correct existing status.  
* Whether status projection remains authoritative after DBOS workflow history deletion.  
* Whether missing history fails closed rather than silently recreating work.  
* Whether same key with a different payload hash produces HTTP 409 and an auditable discrepancy.  
* Whether tombstone expiry creates a new event generation atomically.  
* Whether concurrent requests after expiry converge on exactly one new generation and one workflow.  
* Whether the tests could pass falsely because they mock the transaction boundary or reuse one database connection sequentially.

Check the actual `deleteWorkflow` API and its test semantics against the installed SDK. Do not assume the deletion test simulates retention expiry correctly.

## **3\. P3 wallet and provider-attempt correctness**

Attempt to disprove the crash-safety claims.

Verify:

* The SIGKILL test terminates the actual child process executing the operation.  
* Recovery starts in a separate process and reads persisted PostgreSQL state.  
* The fake provider records accepted operations independently of the application ledger.  
* The provider-accepted-then-crash scenario cannot be passed by a mock that forgets the provider accepted the request.  
* An expired `dispatching` lease becomes uncertain, not automatically retryable.  
* The sweeper cannot refund dispatched or uncertain operations.  
* Settlement uniqueness prevents double settlement after replay.  
* Concurrent wallet exhaustion cannot produce a negative balance.  
* Every test asserts the required provider count, operation/attempt identity, reservation/settlement counts, final balance, and repeat-call count.

Look for race conditions between the worker, wallet sweeper, and recovery process.

## **4\. Backpressure and retry correctness**

Try to produce:

* A connection-pool exhaustion condition.  
* A request that is acknowledged before commit.  
* A request that is silently dropped after an acquisition timeout.  
* Multiple retries creating duplicate event generations.  
* A retry storm that defeats the bounded pool.  
* A failure response that is not retryable by the intended webhook caller.

Verify that pool waits, timeouts, HTTP responses, committed rows, and retry convergence are measured rather than inferred.

## **5\. Shell scripts, credentials, and evidence integrity**

Review:

* `run-all.sh` error handling, exit codes, traps, child-process lifecycle, and cleanup.  
* Whether failure in one suite can accidentally mark later suites successful.  
* Whether logs can expose passwords, connection strings, tokens, or sensitive payloads.  
* Whether redaction works on error output and stack traces, not just ordinary application logs.  
* Whether test output distinguishes PASS, FAIL, BLOCKED, and NOT RUN correctly.  
* Whether timestamps, counts, and command records are reproducible.  
* Whether the lockfile audit maps every restored hash to the correct package, version, resolved URL, and registry artifact.  
* Whether the repository diff is genuinely limited to the approved dependency changes and `phase0/`.

## **6\. Required review output**

Produce `phase0/ADVERSARIAL_REVIEW.md`.

For every finding provide:

1. Severity: BLOCKER, MAJOR, MINOR, or INFORMATIONAL.  
2. Exact file and line reference.  
3. Concrete failure scenario or exploit path.  
4. Why the current implementation does not prevent it.  
5. The smallest correction necessary.  
6. A test that would demonstrate the correction.

Do not report hypothetical concerns as confirmed defects. Separate confirmed defects from unverified assumptions and suggestions.

## **7\. Stop and disposition rules**

* Any BLOCKER means do not ask the owner to execute the local runbook until fixed.  
* MAJOR findings affecting database safety, atomicity, recovery correctness, or evidence validity must be fixed or explicitly resolved before execution.  
* MINOR and INFORMATIONAL findings should not delay the PostgreSQL proof unless they directly compromise test validity.  
* Do not introduce advisory-lock fencing, new services, additional infrastructure, or architecture changes without demonstrated need.  
* Do not modify application code, V1/V2/V2.1, or planning documents.

After completing the review, report one of:

* **SAFE TO EXECUTE:** no unresolved blocker or material proof-validity issue.  
* **FIX BEFORE EXECUTION:** specific findings must be corrected.  
* **STOP:** the current approach cannot safely produce trustworthy evidence.

The goal is to protect the local environment and ensure the subsequent Phase 0 evidence is credible—not to achieve another cycle of architectural perfection.

