I recommend an **independent, read-only adversarial review before authorizing the branch push**. The most important area to challenge is the new Docker image-provenance verification: the report presents a plausible fix, but we need to establish that it actually proves the container was created from the pinned immutable image—not merely that several Docker metadata fields happen to agree.

The review should also scrutinize the P3 evidence archive and the remaining HBA parsing risk. Cosmetic issues should not delay the next milestone.

## **Adversarial code review prompt**

# **Independent Adversarial Code Review — OpenLevel Phase 0 Closeout**

## **Role**

Act as an independent principal engineer, database reliability specialist, distributed-systems engineer, and application security reviewer.

Your assignment is to conduct a skeptical, evidence-driven adversarial review of the latest OpenLevel Phase 0 implementation.

You are not the implementation agent. Do not accept the implementation report's conclusions at face value. Independently inspect the repository, actual code, tests, diffs, execution evidence, and relevant dependency APIs.

Your responsibility is to determine whether the latest implementation is safe to advance to the next milestone: an authorized feature-branch push followed by a real GitHub Actions Testcontainers integration run.

Repository:

`/Users/sherwin/Documents/openlevel/openlevel`

Branch:

`phase0/automated-testing`

Reported HEAD:

`dd40238`

## **1\. Primary objective**

Determine whether the latest Phase 0 implementation has any material correctness, security, reliability, data-integrity, or portability defect that should prevent us from proceeding.

Prioritize findings by their potential impact on:

1. Workflow durability and atomicity.  
2. Financial correctness and prevention of duplicate provider charges.  
3. Database isolation and destructive-operation safety.  
4. Docker image provenance and container identity verification.  
5. Reliability of the automated integration test harness.  
6. Accurate recording and reconciliation of test evidence.

Do not spend disproportionate effort on naming conventions, formatting, stylistic preferences, or hypothetical future abstractions.

We need to close the reliability foundation and return engineering attention to the OpenLevel commercial product.

## **2\. Evidence and reported implementation state**

The latest owner-side native PostgreSQL execution:

`run-2026-11-15T03-19-34-525Z-29438`

Reported environment:

* Node v22.23.5  
* PostgreSQL 16.16, Postgres.app  
* DBOS TypeScript SDK 5.5.0  
* Native PostgreSQL provisioner  
* Exit code 0; 103 seconds

Reported results:

* P1: 9/9, identical repeat.  
* P3: 11/11, identical repeat.  
* Backpressure: 1/1, identical repeat.  
* External SIGKILL recovery: 20/20.  
* Unit tests: latest matrix count 131/131.  
* Four reconciliation invariants passed.  
* Thirty provider charges corresponded to thirty provider log entries.  
* No negative wallet balances.  
* Zero settlement-versus-attempt-cost mismatches.  
* SCRAM authentication demonstrated using server configuration, HBA rules, verifier evidence, and restricted runtime-role login.  
* Ownership-aware teardown removed eleven prototype tables and the execution's ownership ledger.

Do not assume all these claims remain valid merely because the report says they were reverified. Inspect the artifacts and relevant implementation.

The current report says:

`LOCAL PASS — CI BLOCKED`

The Testcontainers CI fix has been implemented and unit-tested locally, but has not yet been validated by a real GitHub Actions integration run.

No commits were created for the latest work, and nothing was pushed.

## **3\. Review priorities**

### **PRIORITY 1 — Docker image provenance and container identity**

This is the highest-impact review area because the next operational milestone depends on a successful CI run.

Relevant files include:

* `phase0/container-identity.ts`  
* `phase0/container-identity.test.ts`  
* `phase0/provisioners/testcontainers.ts` or the current container provisioner implementation  
* `phase0/db-guard.ts`  
* `phase0/test-env.ts`  
* Relevant GitHub Actions workflows  
* Installed Testcontainers and Dockerode dependency types

#### **Reported root cause**

The previous implementation attempted to read `RepoDigests` from Docker container inspection data.

The implementation report says that this was fundamentally incorrect:

* Container inspection information does not expose the image's `RepoDigests` field.  
* Image inspection information does.  
* Dockerode's installed type declarations confirm the distinction.

Independently verify the exact Docker API behavior and the relevant installed dependency types.

#### **Reported new solution**

The new implementation reportedly:

1. Resolves the image by its immutable pinned digest reference.  
2. Inspects the image by ID.  
3. Inspects the image by reference.  
4. Requires the container's image ID to equal both resolved image IDs.  
5. Checks the platform against the executing runner.  
6. Retains container run-label checks.  
7. Retains loopback-only published-port checks.  
8. Retains exact container-interface matching for PostgreSQL's server address.  
9. Treats `RepoDigests` as a consistency signal when present, rather than requiring it to exist.  
10. Relies on the Docker daemon's content-addressed image verification rather than performing independent registry calls.

This approach may be sound, but do not assume it is.

#### **Critical adversarial question**

**Does this implementation genuinely prove that the running container uses the image represented by the pinned immutable digest, even when `RepoDigests` is absent?**

Trace the complete chain of trust from:

Pinned image reference  
→ image pull/resolution  
→ image object registration  
→ container creation  
→ container image ID  
→ image inspection by ID and immutable reference  
→ platform verification  
→ database connection identity.

Do not stop after checking that three strings are equal.

Establish exactly what each Docker API field proves and what it does not prove.

In particular, investigate:

* Whether `container.Config.Image` is merely the requested image string or independent proof of the image's actual content.  
* Whether inspecting an image by an immutable digest reference establishes that the local image content is associated with that digest.  
* Whether matching image IDs by ID and reference proves the required relationship.  
* Whether Docker's image ID represents a configuration digest rather than a manifest digest.  
* Whether manifest index digests, platform-specific manifest digests, configuration digests, and local image IDs are correctly distinguished.  
* Whether the code verifies the requested platform against the actual selected image platform.  
* Whether a multi-platform image is handled correctly.  
* Whether locally cached, preloaded, retagged, stale, or unexpectedly substituted images can satisfy the checks incorrectly.  
* Whether a container created before the current run can be mistaken for the current execution.  
* Whether the Docker daemon is explicitly part of the trust boundary and whether the resulting guarantee is accurately documented.

If independent registry verification is deliberately excluded, establish whether the local Docker daemon's behavior supplies the intended integrity guarantee.

Do not demand additional registry calls simply for the appearance of stronger security. They must solve an actual trust gap.

#### **Port-binding and network identity**

Verify that:

* The PostgreSQL port is bound only to the intended host loopback address.  
* Wildcard and public bindings fail closed.  
* An arbitrary RFC1918 address cannot pass as a valid container server address.  
* The server IP reported by PostgreSQL must match the verified container's actual interface.  
* The PostgreSQL port corresponds to the actual verified container port.  
* The database guard does not accept a different server or container merely because it has a private IP.  
* Native provisioner mode cannot inherit container verification privileges.  
* Missing or ambiguous Docker inspection results never silently degrade to a permissive path.

#### **Required adversarial attack cases**

Independently evaluate whether the implementation rejects:

* Missing pinned digest.  
* Mutable tag instead of digest.  
* Wrong digest.  
* Wrong platform.  
* Wrong configuration digest.  
* Mismatched local image ID.  
* Container created from an unexpected image.  
* Container with wrong or absent execution label.  
* Existing container reused from another run.  
* Public or wildcard port binding.  
* Unrelated private server address.  
* Missing Docker inspection data.  
* Malformed or ambiguous inspection responses.  
* A multi-platform image resolving to an unexpected platform.

The existing report mentions eleven adversarial cases and 26/26 tests in the relevant test file. Verify what those tests actually prove. Test names and passing counts alone are insufficient.

Look particularly for circular tests where the fixture simply repeats the same incorrect assumptions as the implementation.

**Severity rule:** if immutable image provenance cannot be established, classify the defect as MAJOR and recommend fixing it before the branch push.

### **PRIORITY 2 — P3 wallet, provider attempts, and reconciliation**

Relevant files include:

* `phase0/p3/wallet.ts`  
* `phase0/p3/runner.ts`  
* `phase0/p3/provider.ts`  
* P3 schema/migrations  
* P3 tests  
* Archive trigger and reconciliation implementation

The latest fixes include:

* Explicit PostgreSQL parameter casts `$2::text` and `$3::bigint`.  
* `p3_attempt_archive`.  
* A `BEFORE TRUNCATE` trigger to preserve attempt history.  
* Reconciliation against live and archived attempts.  
* Existing reservation, settlement, refund, uncertainty, and retry-safety mechanisms.

The objective is to ensure that external provider actions cannot create unaccounted financial exposure or duplicate charges.

#### **Challenge the archive design**

The archive was added because individual test fixtures truncate `p3_attempt`, while the run-wide reconciliation requires preserving provider-attempt evidence.

Determine whether this is a correct evidence-preservation mechanism or whether it can produce misleading reconciliation results.

Specifically investigate:

1. Does the archive preserve the exact attempt data needed for financial reconstruction?  
2. Does the trigger execute transactionally with the TRUNCATE operation?  
3. Can a rollback leave inconsistent archive and live records?  
4. Can concurrent tests or operations create missing or duplicate archive records?  
5. Does `ON CONFLICT DO NOTHING` conceal an attempt-ID collision or preserve an outdated attempt version?  
6. Are archive records scoped to their originating run?  
7. Can evidence from a previous execution make a later execution appear successful?  
8. Can an attempt exist in neither the live table nor archive without reconciliation detecting it?  
9. Can an archive record falsely satisfy a provider charge that belongs to a different operation?  
10. Does reconciliation independently establish the relationship between operation, attempt, provider charge, and settlement?

Pay particular attention to whether the evidence invariant is truly:

**Every provider charge in this execution corresponds to the correct durable provider attempt and operation.**

It must not merely be:

**An attempt with some matching identifier exists somewhere in the combined live/archive data.**

If archive scoping or attempt identity is insufficient, identify the exact failure scenario and a regression test that reproduces it.

#### **Verify financial invariants**

Adversarially examine:

* Concurrent wallet reservation.  
* Duplicate operation submissions.  
* Concurrent settlement.  
* Refund races.  
* Sweeper versus active dispatch.  
* Stale `dispatching` recovery.  
* Provider timeout.  
* Process termination before dispatch.  
* Process termination during dispatch.  
* Process termination after provider success but before local settlement.  
* Uncertain outcome quarantine.  
* Any route that can blindly retry an operation with an unknown external outcome.

Ensure the code never converts uncertainty into an unsafe retry or automatic refund.

Validate actual affected database rows and balances, not only returned application responses.

### **PRIORITY 3 — P1 atomic enqueue and workflow identity**

Relevant files include:

* `phase0/p1/worker.ts`  
* P1 enqueue implementation  
* DBOS client/transaction integration  
* P1 tests

The latest fix removed the phantom `workflowRunTag` input and uses the durable `DBOS.workflowID` supplied by the execution context.

Verify that:

* The workflow identity actually comes from the authoritative DBOS context.  
* No caller-supplied or mutable identifier can replace it.  
* A missing identity fails closed.  
* The worker cannot silently associate execution with the wrong business event.  
* The same idempotency key cannot produce multiple executions.  
* Rollback leaves no partial business event or workflow registration.  
* The workflow reuse behavior remains correct after business-row deletion.  
* Concurrent duplicate submissions converge on the same durable outcome.  
* A different payload hash for the same key produces the intended conflict response.  
* Expired tombstones cannot create multiple next-generation records.

Do not accept a test that merely checks an HTTP response while ignoring DBOS workflow state and domain records.

### **PRIORITY 4 — Native provisioner, database guards, and ownership-scoped teardown**

Relevant files include:

* `phase0/provisioners/native.ts`  
* `phase0/provisioners/types.ts`  
* `phase0/setup-db.ts`  
* `phase0/db-guard.ts`  
* Teardown implementation and tests

Review the following:

* Native and Testcontainers provisioner isolation.  
* Disposable database verification.  
* Host, port, database, and role identity verification.  
* SCRAM authentication verification.  
* HBA rule parsing and first-match behavior.  
* Ownership ledger correctness.  
* Foreign-key-aware teardown.  
* Protection of pre-existing database objects.  
* Protection of non-owned database records.  
* State-file permissions and cleanup.  
* Failure behavior halfway through provisioner setup or teardown.

The report identifies a possible HBA matching defect involving comma-bearing database or role names and a join-then-split parser.

Determine whether this is a genuine parsing weakness.

If PostgreSQL HBA configuration allows such values and the current implementation could make an incorrect authentication decision, identify the minimal safe correction.

Do not automatically expand the scope into generalized PostgreSQL configuration parsing.

The report also says the native `down()` operation leaves a mode-600 state file behind. Establish whether this creates a meaningful operational or security issue, whether it can affect later runs, and whether cleanup is safely idempotent.

### **PRIORITY 5 — Evidence quality and automated testing**

Review:

* `phase0/EVIDENCE_MATRIX.md`  
* `phase0/evidence/ENVIRONMENT.md`  
* `phase0/evidence/RUNTIME_VERDICT.md`  
* Relevant run summaries and reconciliation JSON  
* GitHub Actions workflows  
* Test entrypoints and teardown behavior

Verify that:

* Every PASS has actual execution evidence.  
* Native PostgreSQL, Testcontainers, and Fly/Neon staging evidence are not conflated.  
* Historical failed executions remain preserved.  
* The current 131/131 unit-test count corresponds to the current code.  
* The older 120/120 native execution is not misrepresented as 131/131.  
* CI-CONTAINER remains FAIL/BLOCKED according to the actual observed state until a real integration run passes.  
* P2 remains blocked pending explicit staging approval.  
* The known full-application `vault.test.ts` failure is not silently excluded or modified.  
* Secrets are absent from tracked files and generated evidence.  
* Teardown does not destroy resources not owned by the current execution.

Pay special attention to the distinction between a test-harness pass and actual application/deployment acceptance.

## **4\. Cross-cutting review: portability without scope expansion**

OpenLevel has an additional long-term architectural requirement to support:

* Neon  
* Supabase  
* Tiger Data / TimescaleDB  
* PlanetScale PostgreSQL  
* CockroachDB  
* Standard PostgreSQL

Do not implement provider adapters as part of this review.

Instead, identify material accidental Neon-specific assumptions that have already entered application or Phase 0 code.

Distinguish:

* Test-harness-only PostgreSQL-specific implementation.  
* Application behavior that relies on standard PostgreSQL semantics.  
* DBOS operational requirements.  
* Provider-specific capabilities or differences.  
* Genuine incompatibilities that require a provider adapter.

In particular, do not confuse standard PostgreSQL compatibility with CockroachDB compatibility.

The current native HBA and SCRAM verification approach is not automatically suitable for managed providers that do not expose the underlying server's authentication configuration.

Do not require the application to use a universal ORM or vendor-independent query language.

Report only portability concerns that materially affect the current implementation or would cause expensive structural coupling later.

This review must not delay the current Phase 0 closeout with speculative multi-provider implementation work.

## **5\. Review method**

Be independent and skeptical.

1. Inspect `git status`, current branch, HEAD, and recent history.  
2. Inspect all relevant diffs against the correct baseline commit.  
3. Read complete implementations rather than relying on change summaries.  
4. Trace important data paths from caller to database and back.  
5. Inspect actual dependency source/types where implementation claims depend on library behavior.  
6. Compare code, tests, evidence artifacts, and documentation.  
7. Challenge tests with concrete counterexamples.  
8. Execute safe, relevant static and unit-test checks when the environment permits.  
9. Distinguish executed tests from source inspection.  
10. Record exact file paths and line numbers for every finding.

Use the existing implementation as the subject of review. Do not rewrite it before you have established a defect.

### **Important: independent proof**

Do not accept these as proof on their own:

* A test name that says "rejects invalid digest".  
* A passing test count.  
* A developer's explanation of a Docker guarantee.  
* A typecheck.  
* A mocked Docker response.  
* A reconciliation summary without inspecting its underlying data.  
* A successful connection to PostgreSQL.  
* A report that claims an invariant is preserved.

For every major security or integrity claim, state:

1. The invariant.  
2. The implementation enforcing it.  
3. The attacker, race, crash, or failure scenario that could violate it.  
4. The evidence that the scenario is prevented.  
5. Any remaining unproven assumption.

If a behavior cannot be proven in the available environment, mark it UNVERIFIED rather than guessing.

## **6\. Review boundaries**

This is a review-only assignment.

* Do not modify source files.  
* Do not modify tests.  
* Do not rewrite documentation.  
* Do not change evidence-matrix statuses.  
* Do not create commits.  
* Do not amend commits.  
* Do not push anything.  
* Do not use Git credentials.  
* Do not change Git author identity.  
* Do not touch `.env` or secrets.  
* Do not start, stop, drop, or alter the owner's PostgreSQL database.  
* Do not run destructive database tests.  
* Do not perform Fly or Neon staging operations.  
* Do not modify unrelated `.gitignore`, `deepwiki.md`, or `docs/` files.  
* Do not delete historical evidence artifacts.

You may execute non-destructive typechecks and database-independent unit tests if they do not change repository state or external resources.

If a live integration check is necessary, identify the exact test and required environment instead of performing an unauthorized operation.

## **7\. Finding severity**

Use these classifications:

**CRITICAL** — Potential data loss, unauthorized destructive operation, uncontrolled duplicate external charges, or a security boundary that can be bypassed.

**MAJOR** — A broken core invariant, unreliable image provenance, incorrect workflow execution, unsafe recovery, financial reconciliation weakness, or a defect that makes an important acceptance test misleading.

**MINOR** — A limited defect with a safe workaround and no immediate material threat to the core objectives.

**INFO** — Documentation, observability, maintainability, or future portability concerns that do not justify delaying the next milestone.

For every finding, include:

* Severity.  
* Exact file and line range.  
* Underlying root cause.  
* Concrete failure scenario.  
* Likely business or operational consequence.  
* Whether the defect is reproducible or logically demonstrated.  
* Smallest durable correction.  
* Required regression test.  
* Whether the issue blocks the next branch push.

Do not inflate minor concerns into major findings.

Do not hide material defects inside a general discussion section.

## **8\. Final verdict**

Choose exactly one:

### **APPROVE FOR PUSH**

No unresolved CRITICAL or MAJOR issue was discovered in the reviewed changes. The implementation is ready for the owner to confirm Git author identity and authorize the feature-branch push.

This does not mean CI has passed. CI must still validate the real Testcontainers integration path.

### **FIX BEFORE PUSH**

At least one reproducible or convincingly demonstrated CRITICAL or MAJOR defect remains in the code being prepared for publication.

Identify the minimum required remediation.

### **BLOCKED — INSUFFICIENT EVIDENCE**

The review cannot establish a critical invariant because required source, environment, dependency, or execution evidence is unavailable.

Explain exactly what evidence is missing. Do not invent a failure.

## **9\. Final report format**

### **A. Executive verdict**

One of the three verdicts above, with the most important reason.

### **B. Findings ranked by material impact**

List only substantiated findings. Separate blockers from deferred concerns.

### **C. Docker provenance assessment**

Give an explicit answer to the central question: Does the new implementation establish the required pinned-image-to-running-container identity chain when RepoDigests is absent?

State what is proven, what relies on Docker daemon trust, and what remains unverified.

### **D. Financial and workflow integrity**

Summarize the P1 and P3 invariants and any weaknesses in archive reconciliation, operation identity, or recovery.

### **E. Database safety**

Report provisioner, HBA, authentication, ownership, and teardown findings.

### **F. Portability assessment**

Identify material provider-specific coupling only. Do not propose a broad new implementation.

### **G. Evidence and test coverage**

List executed checks, exact outcomes, and checks that could not be run.

### **H. Minimum remediation plan**

If fixes are required, list the smallest sequence of changes needed to resolve the blocking findings.

Do not turn deferred MINOR and INFO items into a new project.

### **I. Next decision**

State whether the owner should authorize the branch push, fix identified defects first, or obtain missing evidence.

## **Final guiding principle**

**Fix the cause, strengthen the system, and prove the solution—not merely silence the error.**

Our goal is not to achieve theoretical perfection in Phase 0\. It is to establish a trustworthy reliability foundation, pass real CI integration, complete the authorized staging acceptance, and return our engineering capacity to the commercially valuable OpenLevel lead-to-booking product.

Prioritize material correctness over completeness of review prose.

## **What I would pay particular attention to**

Three things deserve special scrutiny:

1. **Docker provenance:** Is the pinned digest genuinely bound to the running image, or is the implementation only checking consistent metadata? This is the most important push gate.  
2. **P3 archive reconciliation:** Does the archive preserve evidence in a way that cannot let historical attempts accidentally satisfy the current run's financial invariants?  
3. **HBA comma parsing:** The reported join-then-split behavior may be a small defect, but authentication-policy parsing should fail closed rather than misidentify a database or role.

I would not delay the push for the state-file cleanup or other minor issues unless the review establishes a material consequence.

**Decision rule:** only authorize the branch push after the review returns `APPROVE FOR PUSH`. Then validate the actual GitHub Actions run. A successful review is not a substitute for CI evidence.

