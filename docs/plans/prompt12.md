The attached `EVIDENCE_MATRIX.md` is yesterday's snapshot. It still marks P1, P3, and backpressure as blocked, and records 111 passing unit tests. The newer Track B report supersedes those local results: **120/120 unit tests, P1/P3/backpressure passing against native PostgreSQL, 20/20 SIGKILL trials, and successful reconciliation.**

EVIDENCE\_MATRIX.md  
prompt11\_imp.md

So the next move is not another broad architecture review or another local test run. It is to **close the local evidence properly, resolve the remaining Testcontainers CI blocker, and prepare for P2 staging acceptance.** P2 is still approval-gated; we should not deploy to staging yet.

## **Agent prompt — Phase 0 closeout and CI blocker**

# **Mission: OpenLevel Phase 0 — Track B Closeout and CI Integration Proof**

You are continuing work in the OpenLevel repository:

`/Users/sherwin/Documents/openlevel/openlevel`

Branch: `phase0/automated-testing`

Act as the senior engineer responsible for completing the current Phase 0 reliability gates. Your priority is to close the remaining proof gaps with the least additional complexity.

## **1\. Objective and priorities**

We have already invested substantial effort in the Phase 0 architecture and test harness. Do not reopen the architecture or expand the scope.

Our immediate objectives, in order:

1. Reconcile the latest successful native PostgreSQL Track B execution into the canonical evidence matrix and runtime documents.  
2. Review and preserve the underlying code fixes that made the execution pass.  
3. Resolve the Testcontainers CI image-provenance blocker without weakening the security guarantees.  
4. Produce an accurate Phase 0 readiness assessment and the remaining work required before P2 Fly/Neon staging acceptance.

The objective is reliable proof, not more infrastructure or more documentation for its own sake.

## **2\. Evidence to treat as the latest execution**

The latest owner-side execution is:

`run-2026-11-15T03-19-34-525Z-29438`

The sanitized report records:

* Exit code 0; elapsed time 103 seconds.  
* Native PostgreSQL 16.16 through Postgres.app, on Apple Silicon.  
* DBOS SDK 5.5.0.  
* Node v22.23.5.  
* Phase 0 unit tests: 120/120.  
* P1: 9/9; repeat: 9/9.  
* P3: 11/11; repeat: 11/11.  
* Backpressure: 1/1; repeat: 1/1.  
* External SIGKILL recovery: 20/20 iterations passed.  
* Reconciliation: all four invariants passed.  
* Thirty provider charges checked against thirty corresponding provider log entries.  
* No negative wallet balance.  
* Zero settlement-versus-attempt-cost mismatches.  
* Native teardown completed successfully, removing its eleven prototype tables and ownership ledger.  
* PostgreSQL was intentionally left running; the database and local environment were not deleted or stopped.

The four reconciliation invariants were:

1. `journal-parseable`  
2. `no-negative-wallets`  
3. `charges-have-attempts`  
4. `settle-equals-attempt-cost`

Do not convert these facts into broader claims than the tests support.

The report also documents four substantive fixes:

1. Normalize PostgreSQL HBA query results at the database boundary instead of blindly casting `text[]`.  
2. Fix the P1 worker's nonexistent `workflowRunTag` dependency by using the durable DBOS workflow identity.  
3. Correct ambiguous PostgreSQL parameter types in the P3 wallet path.  
4. Preserve attempt evidence across fixture truncation using an archive and trigger, without weakening reconciliation invariants.

These changes were uncommitted when the report was generated. Verify their actual current status and implementation.

The original B-5 report and its detailed test artifacts are the source of truth. Inspect the actual repository artifacts under `phase0/evidence/` before changing recorded results.

## **3\. Workstream A — evidence reconciliation and local closeout**

First inspect:

* `git status --short`  
* `git branch --show-current`  
* `git log -5 --oneline --decorate`  
* Current evidence matrix.  
* `phase0/REMEDIATION_REPORT.md`  
* `phase0/EVIDENCE_MATRIX.md` or whichever file is the actual canonical matrix.  
* `phase0/evidence/`  
* `phase0/ENVIRONMENT.md`  
* `phase0/evidence/RUNTIME_VERDICT.md`, if present.

Do not create duplicate evidence matrices or competing verdict documents.

### **Reconcile the evidence accurately**

Update the canonical matrix to reflect the latest native Track B execution.

The matrix must distinguish:

* Native PostgreSQL local proof.  
* Testcontainers CI proof.  
* Fly/Neon staging proof.  
* Static/type/unit-test proof.

The new native execution supersedes the old BLOCKED results for live local P1, P3, and backpressure testing.

Update the unit-test count from 111 to 120, but preserve the earlier result as historical evidence where useful.

Do not erase the earlier restricted-sandbox provisioning failure. It describes a different execution environment. Record that the owner-side native PostgreSQL path subsequently succeeded, and distinguish the environments accurately.

Update the relevant rows for:

* Native PostgreSQL provisioning.  
* SCRAM authentication.  
* P1 atomic enqueue.  
* P3 wallet/provider safety.  
* Backpressure.  
* Repeat-suite behavior.  
* SIGKILL recovery.  
* Reconciliation.  
* Unit tests.

For each PASS, identify the actual report or artifact that supports it.

Keep these results unchanged unless new evidence proves otherwise:

* The full application test baseline still has its known deterministic `vault.test.ts` failure.  
* Testcontainers CI still has an observed image-provenance failure until a successful CI integration run proves otherwise.  
* P2 Fly/Neon staging acceptance remains blocked pending explicit staging authorization.

Do not silently turn an observed failure into a BLOCKED or PASS status.

### **Correct stale environment documents**

The previous environment and runtime verdict documents reportedly still claim that PostgreSQL cannot start in the current execution environment.

The successful native PostgreSQL run disproves that statement for the environment used in B-5.

Correct the stale conclusions, preserving the historical restricted-sandbox result and clearly recording the successful native environment.

Do not rewrite history or delete previous failure evidence.

### **Review the code fixes**

Perform an actual diff review of the uncommitted Track B changes.

Check that:

* The fixes address their underlying causes.  
* The implementation does not weaken database or financial invariants.  
* The archive preserves evidence rather than hiding failed operations.  
* The worker identity is durable and supplied by the actual DBOS execution context.  
* Teardown remains ownership-aware and foreign-key-safe.  
* Native mode does not inherit container verification privileges.  
* Secrets remain outside tracked files and evidence.  
* No unrelated user changes are included.

Do not make cosmetic refactors during this closeout.

Run relevant typechecks and unit tests to confirm the current working tree remains valid. Do not rerun the entire 20-iteration SIGKILL procedure merely to update documentation; the retained evidence is the basis for that result.

## **4\. Workstream B — resolve the Testcontainers CI image-provenance failure**

This is the next major unresolved automated-testing gate.

Yesterday's matrix records:

`CI-CONTAINER: FAIL — FATAL: no RepoDigests present to verify image identity`

Do not simply remove the check, accept any private IP, or treat a Docker image tag as immutable identity.

Investigate the actual Testcontainers and Docker execution path.

Inspect:

* `phase0/provisioners/container.ts`  
* `phase0/container-identity.ts`  
* `phase0/container-identity.test.ts`  
* `phase0/db-guard.ts`  
* The pinned PostgreSQL image reference.  
* The integration test orchestrator.  
* The GitHub Actions workflow.  
* Docker inspect output and the exact metadata returned by the CI environment.

### **Required security properties**

The solution must preserve all of the following:

1. The PostgreSQL image must have immutable, verifiable provenance.  
2. Image index/manifest digests, platform-specific manifest digests, configuration digests, and local Docker image IDs must not be confused or compared as though they were interchangeable.  
3. For multi-platform images, verify the selected platform and the cryptographic relationship between the selected manifest and the corresponding image configuration.  
4. Verify that the running container was created from the verified image.  
5. Verify the expected container run label and container identity.  
6. Verify the published database port is bound only to the intended host loopback interface.  
7. Verify the PostgreSQL server interface against the exact verified container interface.  
8. Native provisioner mode must remain strictly separate from container identity verification.

A missing `RepoDigests` field must be treated as a provenance problem to investigate, not as permission to accept an unverified image.

If a different Docker metadata source is needed, prove that it establishes the same or stronger immutable identity guarantee.

### **Required adversarial tests**

Add or update tests for:

* Missing RepoDigests.  
* Wrong platform.  
* Wrong manifest digest.  
* Wrong configuration digest.  
* Mismatched local image ID.  
* Container created from a different image.  
* Missing or wrong run label.  
* Public or wildcard port binding.  
* Arbitrary RFC1918 address not belonging to the verified container.  
* Missing, ambiguous, or malformed Docker inspection data.  
* Valid multi-platform image verification.

Every invalid or ambiguous identity case must fail closed.

### **Verify the fix**

First run unit tests and typechecks.

Then run the same integration harness through Testcontainers if a supported local container runtime is available.

Do not modify the native provisioner or its successful test results to compensate for a Testcontainers problem.

A successful local Testcontainers run is useful evidence, but it does not replace the required GitHub Actions execution.

If GitHub Actions requires a branch push to validate the fix, stop before pushing. Report the exact required push and wait for owner authorization.

Do not claim CI is fixed until a real CI integration run passes.

## **5\. Git and operational boundaries**

* Work only on `phase0/automated-testing`.  
* Never push to `master`.  
* Do not force-push.  
* Do not amend or rewrite existing commits.  
* Do not push to GitHub without explicit owner authorization.  
* Do not touch production databases or production secrets.  
* Do not run P2 Fly/Neon staging deployments without explicit owner authorization.  
* Do not stop the existing local PostgreSQL service.  
* Do not drop the local database or runtime role.  
* Do not alter `phase0/.env`.  
* Do not clean unrelated files or user changes.  
* Do not stage unrelated `.gitignore`, `deepwiki.md`, or `docs/` changes.

Inspect the configured Git author and compare it with established repository history. If the configured identity is a machine-local or otherwise inappropriate author identity, do not silently create a misleading commit or amend historical commits. Report the exact issue.

You may create narrowly scoped commits only when the author identity is appropriate and the relevant changes have been reviewed. Do not publish them.

## **6\. What not to do**

Do not:

* Revisit the V2.1 architecture.  
* Introduce a second queue or workflow engine.  
* Add custom DLQ infrastructure.  
* Introduce a new database or cloud service.  
* Expand Phase 0 with speculative reliability features.  
* Change the existing full-application vault test to make the baseline appear green.  
* Weaken provider-operation quarantine or wallet accounting.  
* Remove historical failure reports.  
* Mark unexecuted tests as passing.  
* Turn this assignment into a general codebase cleanup.

The guiding engineering principle is:

**Fix the cause, strengthen the system, and prove the solution—not merely silence the error.**

## **7\. Required final report**

Return a concise, evidence-based report with these sections:

### **A. Local Track B verdict**

State what is now proven by the native PostgreSQL execution and what remains unproven.

### **B. Evidence reconciliation**

List the matrix and runtime documents updated, and identify any evidence that could not be verified.

### **C. Code review**

Summarize the underlying defects corrected and any remaining risks. Identify the exact files changed.

### **D. Testcontainers CI**

Explain the actual root cause of the image-provenance failure, the durable fix, the adversarial cases added, and which real integration tests were executed.

### **E. Git state**

Report branch, HEAD, changed files, commits, uncommitted changes, and author identity. Confirm that nothing was pushed.

### **F. Phase 0 readiness**

Choose one:

* `LOCAL PASS — CI BLOCKED`  
* `PHASE 0 PASS — READY FOR P2 STAGING APPROVAL`  
* `FIX REQUIRED`  
* `BLOCKED`

Do not issue the second verdict unless the actual P1, P2, P3, and backpressure acceptance requirements have all been proven.

### **G. Next highest-impact action**

Recommend exactly one next engineering action, with its reason and acceptance criteria.

Keep the work bounded. We need to close the reliability foundation and get back to building the product, not create another endless engineering review.

## **What comes after this assignment**

The intended sequence remains:

1. **Now:** close local Track B evidence and resolve CI provenance.  
2. **Next:** obtain explicit approval for P2 staging and prove Fly/Neon deployment, worker restart, and recovery behavior.  
3. **Then:** stop expanding infrastructure and build the complete roofing lead-to-booked-inspection workflow.  
4. **After that:** onboard paying pilot customers and validate willingness to pay.

The key is not to let Phase 0 become an endless project. Once the required gates are proven, we move our engineering capacity toward the product customers will actually buy.

# Prompt

as additional requirement, I like a robust abstraction layer that will support all Posgres providers per [https\://www\.dbos.dev/partners](https://www.dbos.dev/partners) like Cockroach Labs, Supabase, Tiger Data, PlanetScale aside from Neon, would that be an overkill

Answer

**I strongly recommend this. It is not overengineering, provided we build the right kind of abstraction.** In fact, establishing database portability now is considerably cheaper than trying to remove Neon-specific assumptions after OpenLevel has accumulated hundreds of thousands of lines of application code and customer data.

However, I would make an important distinction:

> We should build a provider-independent application architecture, not a universal database abstraction that pretends every PostgreSQL provider behaves identically.

## **1\. DBOS already supports the direction you're proposing**

I checked the current DBOS partner directory and its documentation.

These five companies are explicitly categorized as PostgreSQL providers:

**Neon**

Current OpenLevel provider

Current  
[CockroachDB Logo PNG Vector (SVG) Free Download](https://images.openai.com/static-rsc-4/u8Y-CSfExQ-FOgacpMePBp7LdDxmEWsJOyavxKuQkOgzE8h6CgS2WHXrrRHSah2jKxnWQmnuOPd0J6MOkTjsLOXKSOuJ9xAebZyMfY6IJBre1_w-3ianFi4M3I3o-bElEWGq1kWsrz4t3EVXT-fMGDaNK5qwQPskpykMRbqL3QY?purpose=inline)

**Cockroach Labs**

Distributed SQL / PostgreSQL wire compatibility

[Supabase Logo PNG, Vector (AI, EPS, CDR, PDF, SVG) \- iconLogoVector](https://images.openai.com/static-rsc-4/ZWNEwueIa4jX7IEKpIW_ZvVuoMv7nOsWdPj6prThJJQ0b_Hdaj2TjpLMM3E--UH3DlZFvFuaW_7en80O46eYFmbPzAHBLTg5tC347p9Jxt-PfqHdXtVqQqYVLwjnGugv7sybOkq1Oxeuve_jUb8c_HhsjDpmewZufk8XjOfQcYc?purpose=inline)

**Supabase**

Managed PostgreSQL platform

[Timescale (now TigerData) (@TimescaleDB) on X](https://images.openai.com/static-rsc-4/XO7HSVAjV0YS5C8hjyoz-CTIwW3pDMNq8xs81H1-E7LfgJf8Bj2nbIVj-SfxV0LCj5IXKo9E4_dnvw4TQd5et7K9GuIA7lJnndUsO4-q4zHam2AKx1UPyhGjI4mt-fs1AEP0nyySKoe1dFbAKrpLcR9vn3Ro5TSni5z0E5W_QtU?purpose=inline)

**Tiger Data**

PostgreSQL / TimescaleDB platform

[PlanetScale Logo Vector Download \| Logowik](https://images.openai.com/static-rsc-4/zVu0lqVmJk5J5lx2w-QCK-SXhsP6l3FvKyqOIS8687GP5qOIvd2go-W7hWwLjeuo_cspKQy2HLQCjuZly7YB_H9pC7GdibIsmMYn7O1M_SmDptZeTncfy6vCrq7pstlNR8Vu4UTSdt9t4aNKcafKMOM0eEJx5wN44riGN6vm6Iw?purpose=inline)

**PlanetScale**

Managed PostgreSQL platform

All five are identified in DBOS's official partner directory.

DBOS+1

More importantly, DBOS's production checklist explicitly lists Supabase, Neon, PlanetScale, and TimescaleDB among its compatible PostgreSQL services. It also documents PostgreSQL connection-pooling requirements.

DBOS Docs

There are provider-specific details, however:

* CockroachDB does not support PostgreSQL `LISTEN/NOTIFY`; DBOS's TypeScript configuration can disable it through `useListenNotify: false`.  
   DBOS Docs  
* Supabase recommends a direct connection or session pooler for DBOS.  
   DBOS Docs  
* Neon recommends disabling connection pooling for DBOS connections.  
   DBOS Docs  
* Tiger Data has its own DBOS integration instructions.  
   DBOS Docs

This is exactly why a provider adapter is valuable.

## **2\. The architecture I recommend**

I would introduce a dedicated **Database Portability Layer** between OpenLevel's application services and the underlying database infrastructure.

**OpenLevel Application**

CRM · Workflows · Inbox · Booking · Billing · AI

**Database Access Layer**

Repositories · Transactions · SQL · Migrations

**PostgreSQL Provider Adapter**

Provider profile · Connection policy · Capability detection · Compatibility rules

Neon

Supabase

Tiger Data

PlanetScale

CockroachDB

PostgreSQL

The important thing is that application services should not know which provider is being used.

For example, a CRM service should not contain:

```
if (provider === "neon") {
  // ...
} else if (provider === "supabase") {
  // ...
}
```

Instead, provider-specific behavior belongs in one well-defined configuration and capability layer.

### **What the abstraction should actually own**

I would limit its responsibilities to six areas:

1. **Provider identification and configuration:** Resolve the provider, connection URLs, SSL requirements, and connection policies.  
2. **Connection management:** Application and DBOS connection pools, limits, timeouts, and pooling modes.  
3. **Database capabilities:** Identify which relevant PostgreSQL features are supported and how DBOS should operate.  
4. **Transaction behavior:** Preserve atomic business operations and transactional DBOS workflow enqueueing.  
5. **Schema and migrations:** Apply application migrations and DBOS system-schema migrations safely.  
6. **Health and diagnostics:** Identify the provider, version, connection status, and incompatibilities without exposing secrets.

I would not build a universal ORM or replace the existing SQL access pattern.

## **3\. The most important design decision: capability-based, not vendor-based**

This is where I would be particularly strict.

Providers may share PostgreSQL syntax without sharing identical operational behavior.

For example, CockroachDB is not simply Neon deployed differently. Its distributed transaction behavior and DBOS notification handling deserve explicit attention.

Rather than scattering provider checks everywhere, define a capability profile.

Illustrative TypeScript:

```
interface DatabaseCapabilities {
  listenNotify: boolean;
  sessionPoolingRequired: boolean;
  transactionalEnqueue: boolean;
  migrationCompatibility: string;
  transactionRetryStrategy: string;
}

interface DatabaseProviderProfile {
  id: string;
  capabilities: DatabaseCapabilities;
  createApplicationPool(): Pool;
  createDBOSConfiguration(): DBOSConfiguration;
  verifyCompatibility(): Promise<void>;
}
```

This is an architectural illustration, not a proposed drop-in implementation. The actual capabilities must be verified against each provider and the installed DBOS SDK.

In particular, I would make transactional enqueue an explicit compatibility gate. The fact that a provider accepts PostgreSQL SQL does not by itself establish that our P1 atomicity guarantees work correctly there.

## **4\. We need a real compatibility test strategy**

I would establish three levels of support.

| Level | Providers | Meaning |
| ----- | ----- | ----- |
| Primary | Neon | Actual production provider and continuously tested |
| PostgreSQL-compatible | Supabase, Tiger Data, PlanetScale | Provider-specific integration validation |
| Specialized compatibility | CockroachDB | Explicit handling of distributed database and DBOS differences |

Standard PostgreSQL should remain our reference implementation for the shared application SQL and local development.

The same important behavioral contracts should be tested against the providers we claim to support:

* Transactional DBOS enqueue and rollback.  
* Duplicate submissions and concurrent operations.  
* Wallet reservation and settlement races.  
* Workflow recovery after process termination.  
* Connection pool limits and exhaustion.  
* Schema migrations and DBOS startup.  
* Provider-specific transaction and notification behavior.

A provider should not be labeled supported simply because the application successfully connects to it.

## **5\. Does this belong in our current Phase 0 work?**

Here is my recommendation:

Approve as a long-term architecture requirement

Do not turn it into another Phase 0 implementation project.

I would sequence it this way:

| Timing | Work |
| ----- | ----- |
| Now | Preserve provider neutrality in the existing Phase 0 implementation. Document portability requirements and avoid Neon-specific coupling. |
| After CI proof | Close P2 Fly/Neon staging acceptance. |
| Before major commercial expansion | Implement the small provider abstraction layer and configuration profiles. |
| Before claiming additional provider support | Run the common compatibility tests against each actual provider. |
| Later | Add provider provisioning automation and optional migration tooling if customers justify them. |

One additional boundary: provider selection should initially be **deployment-wide**, not independently configurable for every tenant. One OpenLevel installation can run on Supabase, another on Neon, without introducing per-customer database routing and its associated complexity.

## **6\. Additional requirement for our coding agents**

I would append this to our engineering instructions and make it a permanent architecture constraint:

## **Additional Architecture Requirement: PostgreSQL Provider Portability**

OpenLevel must be designed to support multiple PostgreSQL providers without coupling application business logic to any particular database vendor.

The initial target providers are:

* Neon  
* Supabase  
* Tiger Data / TimescaleDB  
* PlanetScale PostgreSQL  
* CockroachDB  
* Standard PostgreSQL deployments

DBOS is the durable workflow engine and must remain compatible with the selected provider.

### **Architectural requirements**

1. Establish a well-defined PostgreSQL provider abstraction responsible for provider identification, connection configuration, connection pooling, database capabilities, migrations, compatibility checks, and health diagnostics.  
2. Keep application services and business logic provider-independent. Vendor-specific behavior must be isolated within provider profiles, adapters, or capability implementations.  
3. Prefer standard PostgreSQL SQL and semantics wherever possible. Do not introduce a universal ORM or unnecessary query abstraction.  
4. Explicitly account for provider differences, including:  
   * Session versus transaction pooling.  
   * LISTEN/NOTIFY availability and DBOS notification behavior.  
   * Transaction isolation and serialization retries.  
   * Transactional DBOS workflow enqueueing.  
   * Schema migration compatibility.  
   * JSONB, indexes, constraints, and other relied-upon PostgreSQL capabilities.  
   * Connection limits and pool configuration.  
5. Application database connections and DBOS system-database connections must have separately configurable connection policies, even when they use the same underlying database.  
6. Maintain the current Neon deployment as the primary reference implementation. Do not change its behavior or introduce additional database providers during the current Phase 0 closeout.  
7. Establish a shared provider compatibility contract. A provider must pass the relevant integration and reliability tests before OpenLevel claims it as supported.  
8. CockroachDB must have an explicit compatibility profile rather than being treated as interchangeable with standard PostgreSQL.  
9. Provider selection is deployment-wide initially. Do not introduce per-tenant database routing.

### **Scope and prioritization**

This requirement must not delay the current Phase 0 closeout, Testcontainers CI resolution, or P2 Fly/Neon staging acceptance.

During current work, review code changes for accidental Neon-specific coupling and document any portability concerns. Do not refactor unrelated application code to achieve hypothetical portability.

After Phase 0 is complete, implement the smallest robust abstraction that satisfies these requirements before expanding the commercial product substantially.

### **Acceptance principle**

Changing the configured provider must not require rewriting business services, modifying workflow definitions, or weakening transactional, billing, or recovery guarantees.

Provider compatibility must be demonstrated through executed tests, not inferred from PostgreSQL wire-protocol compatibility.

The governing principle is:

**One application architecture, multiple verified PostgreSQL backends, explicit provider-specific behavior, and no compromise to data integrity or workflow durability.**

## **My final recommendation**

I would absolutely pursue this.

It gives OpenLevel a valuable strategic property: **database independence without sacrificing the benefits of DBOS.**

It also strengthens our positioning as a serious SaaS platform rather than an application permanently tied to a single database vendor.

But I would not spend the current sprint implementing five adapters. First close the reliability gates we have already invested in. Then build the portability seam once, properly, and certify providers incrementally.

That strikes the right balance between long-term architectural quality and the immediate commercial objective of getting OpenLevel into paying customers' hands.

