# ChatGPT

I reviewed `plan_prompt4.md`.

Approved — ready for execution

This version resolves the outstanding inconsistencies from the previous review. I would no longer require another prompt-revision cycle.

### **What is now correct**

| Requirement | Status |
| ----- | ----- |
| Dynamic Git-root resolution; no hardcoded paths | Correct |
| Fifteen pg-boss inventory fields | Correct |
| Nine ADRs, eleven fields each | Correct |
| Eighteen security threat areas | Correct |
| Seventeen sequential methodology steps | Correct |
| Fourteen tenant-context trace points | Correct |
| Eleven migration-state items | Correct |
| Compatibility matrix before drafting | Correct |
| Three separate validation audits | Correct |
| DBOS versus pg-boss workload economics | Correct |
| Working-tree preservation | Correct |

The three most important improvements are the explicit migration matrix before document assembly, the complete external-operation failure analysis, and the separation of behavioral, migration, and cross-section consistency audits.

plan\_prompt4.md

### **My final assessment**

I especially approve three architectural safeguards:

1. **DBOS-only remains a hypothesis, not a predetermined decision.** Muse must justify retaining pg-boss using actual workload requirements and measurable benchmarks.  
2. **Tenant identity is traced through all fourteen boundaries.** This is essential for a multi-tenant CRM with autonomous agents and delayed workflows.  
3. **Migration compatibility is established before architecture documentation.** This reduces the risk of producing a beautiful target architecture without a safe path from the existing implementation.

### **What happens next**

Give Muse `plan_prompt4.md` and authorize execution.

Do not ask it to produce another planning document. The requested deliverable is now the actual:

`docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md`

When Muse finishes, bring me that document for an independent adversarial review.

**We are done designing the prompt. Now we need evidence, architectural decisions, and an implementation roadmap that can withstand production scrutiny.**

# Muse Review

\#\# Verdict

Plan\_prompt4 fixes almost everything the review of plan\_prompt3 asked for. The three counting errors are corrected, the absolute paths are gone, the Fly recommendation, blue-green, wait survival, ledger backfill, and final-report alignment are all added. Do not execute it as written yet. It introduces one blocking defect of its own: it tells the executor to follow a file, \`docs/plans/prompt4.md\`, that is not in this packet, and it introduces two new counting problems while claiming all counts are verified.

In this turn the container holds only \`plan\_prompt4.md\` and \`prompt3.md\`. \`prompt4.md\` is absent. That is the evidence for the blocker below, not an assumption.

\#\# What plan\_prompt4 fixes

\- \*\*Counts corrected:\*\* 15 pg-boss fields, 11 ADR fields, 18 threat areas, 17 steps, 11 migration items. Each list is now enumerated in Steps 5, 12, 8, and 14, and matches prompt3 §6, §20, §15, §23, and §19.  
\- \*\*Taxonomy split:\*\* Success Criteria list nine entities separately, including workflow definition and workflow execution as distinct entities, fixing the collapsed phrasing.  
\- \*\*ADRs:\*\* Exactly nine ADRs, with retention as ADR 1 and durable waits as ADR 9, not additional decisions. The nine are enumerated in Step 12 with all eleven fields.  
\- \*\*Steps:\*\* 17 sequential steps, matching prompt3 §23 order. The three audits are separate steps, 14, 15, 16, and final git status is its own step, 17\.  
\- \*\*Paths:\*\* No \`/Users\` path, no username, no pre-observed root or date. All paths are git-root-relative.  
\- \*\*Fly and waits:\*\* Step 7 explicitly recommends one Fly configuration with a reason, explains DBOS state survival across deployment and Machine replacement, and documents unavoidable setup steps without promising one-command deployment. Step 6 adds wait-survival criteria for restarts, Machine replacement, deployments, scaling, and DB interruptions, run-state reuse, blue-green version compatibility, and safe completion of old executions.  
\- \*\*Benchmarks:\*\* Step 10 says define benchmark procedures and measurable acceptance metrics, never invent figures, label unmeasured assumptions, and benchmark execution is not a prerequisite. That matches prompt3 §7, define benchmarks, rather than requiring benchmarks.  
\- \*\*Ledger:\*\* Step 3 backfills Step 2 findings before proceeding, fixing the timing gap.  
\- \*\*Final report:\*\* Success Criteria separate the two duties: final report delivers prompt3 §23 nine items, the document separately answers the five fundamental questions. Step 17 confirms the document answers the five.  
\- \*\*Strict constraints:\*\* Validation now cites the full prompt3 §3 set: no source, schema, migration, dependency, deployment, Fly, Neon, infrastructure, destructive, commit, secret, test-weakening, invented-detail, or planning-doc changes, plus inspect-before-testing and no production credentials.  
\- \*\*Open questions:\*\* Risks say no blocking open questions for execution, with unresolved decisions recorded in the document and ADRs, fixing the prior None wording.

\#\# Blocker: dangling prompt4.md reference

Goal says: Execute \`docs/plans/prompt3.md\` as the primary architecture assignment, corrected by \`docs/plans/prompt4.md\` (final consolidated instruction) and the attached review.

Three problems:

\- \*\*File missing:\*\* \`prompt4.md\` is not uploaded here. An executor in a fresh session that tries to open \`docs/plans/prompt4.md\` will fail. A plan cannot be executed against a correction that is not supplied.  
\- \*\*Hierarchy undefined:\*\* If prompt4 corrects prompt3, prompt4 should govern on conflict. The Goal says prompt3 is primary, corrected by prompt4, with no conflict rule. If prompt3 and prompt4 disagree on a count, a step, or a constraint, the plan gives no rule for which wins.  
\- \*\*Review unnamed:\*\* Attached review of the previous outline has no filename. It could mean \`OpenLevel\_Plan.md\_Review.md\`, the review of plan.md, or the adversarial review of plan\_prompt3 from the prior turn, which was delivered in chat, not as a file. An executor cannot resolve an unnamed attachment.

Approach compounds this by saying counts below are verified against prompt3/prompt4. Without prompt4, that verification claim is unverifiable. Fix by either attaching \`prompt4.md\` and stating prompt4 governs on conflict, or by removing the prompt4 reference and naming the review file explicitly, for example the review of plan\_prompt3, with its location.

\#\# Major defects introduced by plan\_prompt4

\#\#\# 1\. Migration five fields redefined

Prompt3 §19 requires, for every one of the 11 items: migration strategy, compatibility requirements, cutover behavior, recovery behavior, rollback behavior. That is five distinct fields.

Plan Step 8 says each entry carries: existing behavior and proposed DBOS equivalent; migration strategy and compatibility requirements; cutover behavior and ownership rule; recovery behavior; rollback procedure.

That is five semicolon entries, but not prompt3 five fields. It merges migration and compatibility into one entry, adds ownership to cutover, and adds existing/proposed mapping as if it were a field. Expanded, Step 8 lists eight concepts in five entries: existing behavior, proposed equivalent, migration strategy, compatibility, cutover, ownership, recovery, rollback.

Success Criteria and Validation then say 11 items carry five-field entries, which will be read against prompt3 five fields, not Step 8 five entries. Fix by separating mapping from fields: mapping is existing behavior to proposed DBOS equivalent, plus the five prompt3 fields exactly as listed, with ownership recorded inside cutover, not as a sixth field.

\#\#\# 2\. Side-effect considerations: 14 claimed, 12 in prompt3

Prompt3 §10, Consider, lists 12 items: provider-side idempotency support, stable operation IDs, transactional outbox, provider callback reconciliation, duplicate webhook deliveries, duplicate workflow enqueue attempts, provider timeout with uncertain outcome, database transaction failure, poison messages, retry classification, DLQ recovery, manual intervention.

Plan Step 9 says analyze all 14 considerations, adding application-level deduplication and crash after provider success but before checkpoint. Both additions are legitimate topics. Application-level deduplication is one of prompt3 five guarantee categories, and crash-after-success is the framing scenario in prompt3 §10 intro. But prompt3 does not list 14 considerations. The plan presents 14 as if it were prompt3 count, while Approach verified counts list never mentions 14 side-effect considerations. Fix by stating: the 12 prompt3 considerations, plus crash-after-success and application-level deduplication as two additional checks, for 14 total, with the source of each made explicit. Do not present 14 as a prompt3 count.

\#\#\# 3\. Threat extras versus exact validation

Step 12 says run the 18-area threat analysis, adding justified repo-specific threats without inventing a count. That correctly treats 18 as a minimum.

Validation says count audits: 18 threat areas, which reads as exact. If the executor adds a justified 19th threat, the exact audit fails. If the executor stays at exactly 18 to pass validation, the Step 12 permission is dead. Fix by changing Validation to at least 18, with the exact count reported, and by applying the same minimum logic to Step 9 side-effect considerations.

\#\#\# 4\. Gitignored DBOS SDK clone sentence

Approach says: A gitignored local DBOS SDK reference clone may be present for consultation; confirm at execution. It is not part of the repo and its contents are never OpenLevel evidence.

This is new, speculative, and risky:

\- May be present is not a verified fact. No location, version, or commit is given.  
\- Gitignored means it will not appear in git status, so the only-new-artifact check cannot audit it.  
\- Prompt3 §2 makes current official docs authoritative for framework capabilities, not a local clone. The plan says clone contents are never OpenLevel evidence, but does not say clone contents are never framework evidence. An executor could treat an outdated clone as framework evidence and contradict official docs.  
\- Confirm at execution is unactionable without a path or a version check.

Remove the sentence, or replace it with: no local clone is authoritative, official docs govern, if a clone is consulted, record its path, commit, and the official URL that confirms each claim taken from it.

\#\#\# 5\. Audit loop still unbounded

Step 16 still says correct until a full pass is clean, with no bound. That was fix 9 in the prior review. The plan adds degraded-success handling for missing dependencies and missing Postgres, which is good, but does not bound the audit loop. Add a bound: maximum two or three full passes, then escalate remaining items to needs-approval rather than looping.

\#\#\# 6\. The matrix is ambiguous

Success Criteria say the matrix is constructed before drafting. Approach says matrix before drafting. Step 8 builds the compatibility matrix before drafting. Step 14 builds the traceability matrix as an audit after assembly, per prompt3 §23 order, assemble then traceability audit.

Singular the matrix could be read as the traceability matrix, which would contradict Step 14\. Change Success Criteria and Approach to say compatibility matrix before drafting, traceability matrix as audit after assembly.

\#\#\# 7\. Cleanup wording still vague

Success Criteria say only newly generated temp/cache artifacts cleaned up where safe. Validation says never delete user files or alter config for a clean status. Where safe still leaves discretion. Define safe: only files created by this execution, in temp, cache, or gitignored locations, with no user content, and list them in the final report. As written, an executor could leave temp files and claim unsafe, violating the only-new-artifact rule, or delete a user file and claim safe.

\#\# Minor gaps

\- \*\*Validation count audits incomplete:\*\* Validation audits 15 pg-boss fields, 11 ADR fields times 9 ADRs, 18 threats, 11 migration items times 5 fields, five-column matrix over eight areas, 18 scenarios, 12 consistency items, 18 sections. It omits Approach verified counts for 14 metrics, 16 SaaS capabilities, 9 tenancy dimensions, 16 retention dimensions, 13 workloads, 5 recovery guarantees, 8 cost categories, 10 logging fields, 9 admin capabilities, 6 ledger fields, 14 trace points, 14 side-effect considerations, 6 test tiers, and 9 taxonomy entities. If those are verified counts, audit them. If they are not audited, do not claim verification.  
\- \*\*Unenumerated lists:\*\* Step 12 specifies 10 logging fields, 14 metrics, and 9 admin capabilities without listing them. Step 11 inventories 16 SaaS capabilities and builds an eight-category cost model without listing them. Step 9 assigns one of five recovery guarantees without listing them. Counts are correct and prompt3 sections are citable, so this is not a contradiction, but it is inconsistent with the plan otherwise enumerating pg-boss fields, ADR fields, threats, migration items, trace points, and resilience scenarios. Listing the remaining five would make audits deterministic.  
\- \*\*Migration audit omits shadow:\*\* Step 8 defines shadow execution never performs real external writes. Step 15 audits mutual exclusion, rollback, freeze/drain/migrate/verify/reactivate, and phase criteria, but never audits the shadow prohibition. Add shadow to Step 15\.

\#\# Fixes before execution

1\. Resolve the prompt4 reference: attach \`prompt4.md\`, state prompt4 governs on conflict with prompt3, and name the review file with its path. If there is no prompt4, delete the reference.  
2\. Correct Step 8 to prompt3 §19 five fields exactly: migration strategy, compatibility requirements, cutover behavior, recovery behavior, rollback behavior, with mapping and ownership handled separately.  
3\. Correct Step 9 to 12 prompt3 considerations plus two named additions, not all 14 as a prompt3 count.  
4\. Change Validation threat audit to at least 18, with exact count reported.  
5\. Remove or tighten the clone sentence: clone never authoritative, official docs govern, record path, commit, and confirming URL if consulted.  
6\. Bound Step 16: maximum passes, then escalate to needs-approval.  
7\. Specify compatibility matrix before drafting, traceability matrix after assembly, in Success Criteria and Approach.  
8\. Define safe cleanup: only files created by this execution, in temp/cache/gitignored locations, listed in the report.  
9\. Add shadow prohibition to Step 15 migration audit, and expand Validation count audits to cover all counts Approach claims as verified.

After those patches, plan\_prompt4 would be executable. The core design is now sound. The remaining work is resolving the missing file and tightening the new counts, not redesigning the plan.

# Final Prompt

The attached review identifies several genuine issues in `plan_prompt4.md`. I have incorporated all valid corrections into one final execution directive.

There is one important change in the instruction hierarchy: `prompt3.md` **remains the original technical specification, while the consolidated directive below contains all amendments and takes precedence wherever they conflict.** It does not depend on a missing `prompt4.md` or an ambiguously named review file.

I also resolved the migration-matrix ambiguity, distinguished the 12 original side-effect considerations from two additional checks, and made the validation counts auditable.

# **Final consolidated Muse instruction**

Ready for execution

# **FINAL EXECUTION DIRECTIVE**

## **OpenLevel Production Architecture: TypeScript \+ DBOS \+ Neon \+ Fly.io**

### **1\. Authority and mission**

Execute `docs/plans/prompt3.md` as the complete technical and architectural requirements specification.

This directive consolidates and amends the previous execution outline, incorporating all valid architectural decisions and corrections from the subsequent reviews.

**This directive is the controlling amendment to prompt3. Where this directive explicitly corrects or clarifies prompt3 or a previous execution outline, follow this directive. All other prompt3 requirements remain binding.**

Do not depend on a separate `docs/plans/prompt4.md` or an unnamed review file. All applicable corrections are contained here.

The existing planning documents are references only. Do not modify them.

Your role is principal software architect, senior TypeScript engineer, DBOS specialist, PostgreSQL architect, and production DevOps architect.

Your objective is to produce an evidence-based implementation architecture for evolving OpenLevel into a commercially viable, production-grade, multi-tenant SaaS platform using:

* TypeScript backend.  
* Existing Hono HTTP API.  
* DBOS Transact.  
* Neon PostgreSQL.  
* Fly.io.  
* Existing React/Vite frontend.  
* Existing mobile application, subject to verified compatibility.

This is a planning assignment, not an implementation assignment.

Think like the architect who must operate and financially sustain this platform after the first customer pays.

### **2\. Source-of-truth hierarchy**

Use the following hierarchy:

1. Actual local Git checkout and executable tests.  
2. Current official DBOS, Neon, and Fly.io documentation for framework and infrastructure capabilities.  
3. `docs/plans/prompt3.md` for the original technical requirements.  
4. This final consolidated directive for corrections and controlling clarifications.  
5. Existing planning documents, `deepwiki.md`, and reviews as preliminary material to verify.

Never treat previous AI-generated claims as verified facts.

When sources conflict, investigate the source code and tests, document the discrepancy, and explain the architectural implications.

For external capabilities, provide official documentation URLs and the exact behavior verified.

A local DBOS SDK clone, should one be present, is never authoritative over official documentation. If consulted, record its path and commit, and verify every framework claim against the official documentation. Do not use its contents as evidence of OpenLevel behavior.

### **3\. Strict working constraints**

Planning only.

Do not:

* Modify application source code.  
* Modify database schemas or migration files.  
* Install or upgrade dependencies.  
* Deploy applications.  
* Create or modify Fly applications.  
* Create or modify Neon databases or branches.  
* Modify infrastructure or external services.  
* Execute destructive commands.  
* Commit changes.  
* Expose credentials or secrets.  
* Weaken, skip, or delete existing tests.  
* Modify existing planning documents.  
* Invent implementation details, API capabilities, test results, prices, or architectural guarantees.

The only permitted new repository artifact is the requested architecture document.

Inspect test configuration and potential external side effects before running tests.

Never use production credentials or trigger real customer-facing operations.

Preserve all pre-existing tracked and untracked files byte-for-byte.

Tests may generate temporary, cache, coverage, or ignored artifacts. Clean up only artifacts demonstrably created by this execution, located in temporary, cache, or Git-ignored locations, and containing no pre-existing user content. Identify every cleaned artifact in the final report.

Never delete an existing user file or change configuration merely to obtain a clean Git status.

If dependencies or required infrastructure are unavailable, report the limitation. Never install anything to overcome it.

### **4\. Resolve the repository and output path**

At execution time:

1. Run `git rev-parse --show-toplevel`.  
2. Record the actual root, branch, commit SHA, and full Git status.  
3. Check whether `docs/architecture/` exists.  
4. Check whether the intended output file already exists.  
5. Capture the exact before-state.

Required output:

`docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md`

Relative to the dynamically resolved Git root.

If the target already exists, use a clearly named versioned alternative. Never overwrite it.

Do not hardcode absolute paths, usernames, previously observed roots, or directory-existence claims.

Do not ask for confirmation.

### **5\. Repository reconnaissance and testing**

Inspect the complete relevant application architecture:

* `package.json` and lockfile.  
* TypeScript and Vite configurations.  
* Server composition and initialization.  
* Database connection and repositories.  
* Schema and migration mechanism.  
* Authentication, sessions, middleware, authorization.  
* All API routes and contracts.  
* All repository SQL and tenant scoping.  
* Domain libraries and business logic.  
* External integration adapters.  
* Webhook implementations.  
* AI agent engine, tools, permissions, and approval behavior.  
* Background jobs and workflow execution.  
* React frontend API usage.  
* Expo/mobile contracts.  
* Docker and deployment files.  
* Environment and secret-resolution mechanisms.

Count actual source files, test files, and test cases.

Do not reuse previous claims of approximately 190 tests or 182 files without independent verification.

Inspect test setup, environment handling, and mocks before execution.

Discover actual commands from `package.json`.

Run available type-check and test commands without installing dependencies.

Record:

* Passing tests.  
* Failing tests.  
* Skipped tests.  
* Pending tests.  
* Runtime.  
* Flaky tests.  
* Fake-database tests.  
* PGlite tests.  
* Genuine PostgreSQL integration tests.  
* Coverage gaps.

If dependencies are missing, stop test execution and report the limitation.

If genuine PostgreSQL is unavailable, report which DBOS integration tests cannot be verified.

Never claim tests pass without executing them.

### **6\. Evidence ledger**

Maintain a six-field evidence ledger for every material repository-specific claim:

1. Source file.  
2. Symbol.  
3. Observed behavior.  
4. Corresponding tests.  
5. Evidence status.  
6. Architectural implication.

Backfill the initial repository and testing findings before proceeding to architectural recommendations.

Every later repository-specific finding must be added to the ledger.

For external framework capabilities, record:

* Official documentation URL.  
* Exact capability.  
* Verified behavior.  
* Relevant architectural implication.

Classify conclusions as verified facts, assumptions, recommendations, proposed changes, or decisions requiring human approval.

### **7\. Tenant model and identity propagation**

Explicitly distinguish nine entities:

1. Organization.  
2. Agency.  
3. SaaS tenant.  
4. Location/sub-account.  
5. Individual operator.  
6. Customer/contact.  
7. Workflow definition.  
8. Workflow execution.  
9. DBOS workflow execution.

Determine from the actual implementation whether `location_id` equals the SaaS tenant ID.

Do not assume equivalence.

Establish ownership of data, subscriptions, credentials, quotas, billing, and execution limits.

Trace tenant identity through fourteen distinct boundaries:

1. Authentication.  
2. HTTP authorization.  
3. Middleware.  
4. Repository access.  
5. SQL transactions.  
6. Job payloads.  
7. Workflow arguments.  
8. Workflow steps.  
9. Retries and recovery.  
10. Delayed execution.  
11. Scheduled execution.  
12. Inbound webhooks.  
13. Agent tools.  
14. Provider callbacks.

Identify the trusted source of tenant identity.

Never trust arbitrary tenant IDs from untrusted request bodies or webhook payloads.

Document every possible loss, forgery, confusion, or leakage point, especially across worker restarts and delayed execution.

### **8\. Existing pg-boss baseline**

Inspect:

* `server/jobs/boss.ts`.  
* `server/jobs/agent-reply.ts`.  
* `server/jobs/workflow-dispatcher.ts`.  
* `server/jobs/workflow-runner.ts`.

Inspect all other queue consumers, related source files, and tests discovered.

For every queue and job, record exactly fifteen fields:

1. Job name.  
2. Trigger.  
3. Payload.  
4. Tenant and location context.  
5. Retry behavior.  
6. Backoff.  
7. Concurrency.  
8. Ordering.  
9. Singleton/deduplication behavior.  
10. Delay and scheduling behavior.  
11. Failure handling.  
12. Dead-letter behavior.  
13. Idempotency assumptions.  
14. Database transaction boundaries.  
15. Existing workflow state and resumption behavior.

Verify the reported baseline:

* Four retries.  
* Exponential backoff.  
* Five-second initial delay.  
* Three-hundred-second maximum delay.  
* Batch size one.  
* Separate agent-reply and workflow-dispatch dead-letter queues.

Do not report any of these as verified without source-code or test evidence.

Investigate the current wait scheduler and its use of in-process timers.

### **9\. DBOS runtime and execution architecture**

Research the current official DBOS TypeScript SDK.

Verify:

* Initialization.  
* Workflow registration.  
* Launch and shutdown.  
* Steps and transactions.  
* Queues.  
* Scheduling.  
* Durable waits.  
* Recovery.  
* Serialization and replay.  
* Workflow versioning.  
* Concurrency.  
* Partitioning.  
* Rate limits.  
* Retention and deletion.

Verify whether separate Fly web and worker process groups can safely share DBOS's system database and workflow registry.

Investigate registration requirements, lifecycle, recovery, duplicate registration, graceful shutdown, and deployment compatibility.

Do not recommend a topology unsupported by the actual SDK.

Preserve business logic independently of DBOS orchestration.

Place nondeterministic operations inside appropriate steps or transactions.

Avoid placing large records, credentials, or unnecessary sensitive information in durable workflow arguments.

#### **Durable waits**

Investigate `DBOS.sleep()` versus workflow suspension.

Determine:

* Memory residency of sleeping workflows.  
* Whether suspension releases memory.  
* Which SDK edition supports suspension.  
* Enterprise licensing and cost.  
* Behavior with very large numbers of delayed journeys.

Verify wait survival across:

* Application restart.  
* Worker restart.  
* Fly Machine replacement.  
* Deployment.  
* Scaling.  
* Database interruption.

Determine whether existing workflow run IDs, execution positions, and wait states can be reused.

Address blue-green deployment, workflow-version compatibility, and safe completion of executions started under older code.

### **10\. DBOS workflow mapping**

Map at least thirteen workload categories:

1. Agent reply execution.  
2. Workflow event dispatch.  
3. Workflow execution and resumption.  
4. Long-running waits.  
5. Scheduled and recurring automations.  
6. Inbound webhooks.  
7. Outbound messaging.  
8. Appointment booking.  
9. Workflow cancellation and failure.  
10. Dead-letter inspection and replay.  
11. CSV imports.  
12. Nightly analytics.  
13. Other discovered background jobs.

For every workload, document:

* Existing behavior.  
* Proposed workflow and steps.  
* Queue and partition design.  
* Arguments and tenant context.  
* Idempotency.  
* Failure handling.  
* Retry.  
* Recovery.  
* Acceptance tests.

Preserve the existing workflow definition language and observable semantics.

### **11\. Side-effect correctness**

For every important operation involving Anthropic, Chatwoot, Twilio, SMS, email, Stripe, Square, social integrations, or other discovered providers, investigate twelve requirements from the original specification:

1. Provider-side idempotency support.  
2. Stable operation IDs.  
3. Transactional outbox.  
4. Provider callback reconciliation.  
5. Duplicate webhook deliveries.  
6. Duplicate workflow enqueue attempts.  
7. Provider timeout with uncertain outcome.  
8. Database transaction failure.  
9. Poison messages.  
10. Retry classification.  
11. Dead-letter recovery.  
12. Manual intervention.

Add two explicit checks:

13. Crash after provider success but before the DBOS checkpoint.  
14. Application-level deduplication.

These are fourteen total analysis checks, not fourteen items claimed by the original specification.

Assign every important external operation one of five recovery guarantee categories:

1. Provider-enforced idempotency.  
2. Application-level deduplication.  
3. Transactional outbox plus reconciliation.  
4. Best-effort retry.  
5. Manual recovery.

Verify provider capabilities before claiming they exist.

Never promise exactly-once external execution without a demonstrated mechanism.

### **12\. Migration compatibility matrix — construct before drafting**

This matrix is mandatory and must exist conceptually before drafting the final architecture document.

Cover all eleven migration-state categories:

1. Pending jobs.  
2. Running jobs.  
3. Failed jobs.  
4. Retry attempts.  
5. Dead-letter jobs.  
6. Delayed jobs.  
7. Long-running waits.  
8. Historical workflow run IDs.  
9. Retry history.  
10. Existing execution positions.  
11. Existing deduplication identifiers.

Map each existing behavior to its proposed DBOS equivalent.

For every migration-state item, provide exactly five distinct fields:

1. Migration strategy.  
2. Compatibility requirements.  
3. Cutover behavior.  
4. Recovery behavior.  
5. Rollback behavior.

Record the existing behavior and proposed DBOS equivalent as the mapping itself, separately from those five fields.

Record the ownership rule within cutover behavior, not as an additional migration field.

Define explicit mutual exclusion so pg-boss and DBOS cannot independently execute the same customer-facing operation.

Shadow execution must never send real messages, charge customers, book appointments, or perform external writes.

Preserve historical execution semantics wherever feasible. Identify data or state that cannot be transferred losslessly.

Provide freeze, drain, migrate, verify, and reactivate procedures.

### **13\. pg-boss retention architecture decision**

Evaluate three alternatives:

A. DBOS-only.

B. DBOS plus pg-boss.

C. DBOS orchestration plus pg-boss execution for selected batch workloads.

Use two concrete workloads:

* Importing 50,000 contacts from CSV.  
* Generating nightly analytics digests for multiple tenants.

Compare all sixteen dimensions:

1. Execution count.  
2. Checkpoint volume.  
3. PostgreSQL storage growth.  
4. Database transaction overhead.  
5. Write amplification.  
6. Worker throughput.  
7. Memory consumption.  
8. Database connection consumption.  
9. Tenant fairness.  
10. Retry semantics.  
11. Duplicate-execution risk.  
12. Recovery.  
13. Cost per 10,000 and 100,000 processed records.  
14. Operational complexity.  
15. Monitoring and cleanup.  
16. Deployment implications.

For option C, explicitly define transactional handoff, ownership, retries, reconciliation, and mutual exclusion.

Define benchmark procedures and measurable acceptance metrics.

Do not invent performance numbers.

Benchmark execution is not mandatory for the planning document. Label unmeasured assumptions explicitly.

**DBOS-only is the initial hypothesis, not the predetermined decision.**

Retain pg-boss only if a demonstrable operational, economic, or performance advantage justifies maintaining two execution engines.

Make this ADR number one.

### **14\. Neon database architecture**

Evaluate:

1. Separate schemas in the same Neon database.  
2. Separate databases in the same Neon project.  
3. Separate Neon projects.

Explain trade-offs and recommend one.

Distinguish application, DBOS system, migration, and administrative database connections.

Verify current pooled-versus-direct connection requirements, especially for the DBOS system database.

Include:

* Connection budget.  
* Database roles and privileges.  
* Schema separation.  
* Migration ordering.  
* Incremental migration tooling.  
* Rollback.  
* Neon branching.  
* Backup and point-in-time recovery.  
* DBOS system-state restoration.

Explain why reapplying a complete schema file may be insufficient for commercial production migrations.

Establish consistency between application migration ordering and DBOS system initialization.

### **15\. Fly.io deployment architecture**

Evaluate:

A. Web API and DBOS runtime together.

B. Separate web and worker process groups using one container image.

Explicitly recommend one configuration after verifying DBOS SDK compatibility, reliability, and operational economics.

Address:

* Node.js version.  
* Dockerfile.  
* Production build.  
* Runtime dependencies.  
* Startup commands.  
* Process groups.  
* HTTP service.  
* Ports.  
* Worker networking.  
* Health checks.  
* Liveness and readiness.  
* CPU and memory sizing.  
* Restart policies.  
* Minimum machine counts.  
* Scaling.  
* Graceful shutdown.  
* Secrets.  
* Deployment strategy.  
* Rollback.  
* Fly TOML.  
* Release commands.  
* Autostop/autostart.

Use `release_command` for appropriate one-time migration execution.

Never run migrations independently on every web or worker startup.

Migration failures must prevent unsafe releases.

Do not expose workers as unnecessary public services.

Investigate DBOS workflow registry and bundling restrictions. Do not blindly bundle DBOS through Vite, esbuild, Rollup, or another bundler.

Explain the exact operator prerequisites. Do not promise one-command deployment if external provisioning remains necessary.

The Dockerfile and `fly.toml` must be designed to preserve workflow state and compatibility across Machine replacement and blue-green deployment.

Make this ADR number two.

### **16\. Commercial tenancy and SaaS architecture**

Evaluate:

A. Shared Fly application and shared Neon database.

B. Shared Fly application with database-per-tenant.

C. Dedicated Fly application and dedicated Neon database.

Compare all nine dimensions:

1. Infrastructure cost.  
2. Development complexity.  
3. Operational burden.  
4. Tenant isolation.  
5. Backup and restoration.  
6. Migration complexity.  
7. Scaling.  
8. Customer support.  
9. Subscription-tier suitability.

Recommend an economical initial arrangement and a credible premium upgrade path.

Inventory these sixteen SaaS capabilities as existing versus must-build:

1. Customer registration.  
2. Organization provisioning.  
3. Agency provisioning.  
4. Location provisioning.  
5. Subscription plans.  
6. Our SaaS subscription billing.  
7. Usage metering.  
8. Plan enforcement.  
9. Resource quotas.  
10. Tenant suspension and reactivation.  
11. Customer onboarding.  
12. Customer offboarding.  
13. Data export.  
14. White-label branding.  
15. Custom domains.  
16. Per-tenant integration credentials.

Keep our SaaS subscription billing separate from OpenLevel's existing CRM customer invoicing and subscription functions.

Define the minimum commercially viable control plane.

### **17\. Day 2 operations, observability, and administration**

Specify ten structured logging fields:

1. Timestamp.  
2. Request ID.  
3. Tenant ID.  
4. Location ID.  
5. Workflow ID.  
6. Event ID.  
7. Provider.  
8. Execution status.  
9. Retry number.  
10. Error classification.

Specify fourteen operational metrics:

1. HTTP latency.  
2. HTTP error rates.  
3. Database connection utilization.  
4. Queue backlog.  
5. Workflow execution duration.  
6. Retry rate.  
7. Dead-letter count.  
8. Stuck workflows.  
9. Failed external operations.  
10. Provider API availability.  
11. AI token consumption.  
12. AI cost per tenant.  
13. SMS and voice consumption.  
14. Storage and data transfer.

Define alerts, severity, and response procedures.

Design nine operator administration capabilities:

1. Search workflow executions.  
2. Inspect failed workflows.  
3. Review dead-letter events.  
4. Retry eligible workflows safely.  
5. Cancel workflows.  
6. Identify noisy tenants.  
7. Investigate integration failures.  
8. Reconcile uncertain external operations.  
9. Investigate customer complaints.

Include backups, point-in-time recovery, RPO/RTO candidates, restoration testing, DBOS system-state recovery, secret recovery, migration recovery, and incident procedures.

Mark RPO/RTO targets as business decisions requiring approval.

### **18\. Security architecture**

Analyze at least these eighteen threat areas:

1. Cross-tenant SQL access.  
2. Location authorization.  
3. Organization ownership.  
4. Operator permissions.  
5. Session and cookie security.  
6. Webhook authentication.  
7. Provider credentials.  
8. Secret encryption and rotation.  
9. Database privileges.  
10. Workflow payload exposure.  
11. Prompt injection.  
12. Agent tool authorization.  
13. Rate limiting.  
14. Public booking endpoints.  
15. Public funnels.  
16. Data export.  
17. Abuse prevention.  
18. Tenant suspension.

Add justified repository-specific threats where appropriate.

Validation requires at least eighteen threats, not exactly eighteen.

Separate implemented protections from proposed controls. Do not invent threats merely to increase a count.

### **19\. Testing and behavioral conformance**

Produce the five-column traceability matrix:

Existing behavior \| Existing test \| Proposed implementation \| New test \| Acceptance criterion

Cover:

* Routes.  
* Repositories.  
* Domain logic.  
* Tenant scoping.  
* Integrations.  
* Agents.  
* Workflows.  
* Error handling.

Map all eighteen resilience scenarios:

1. Successful workflow completion.  
2. Process crash during execution.  
3. Restart and resume.  
4. Completed steps not repeated.  
5. Interrupted steps retry safely.  
6. Duplicate workflow submissions deduplicated.  
7. Duplicate webhooks handled.  
8. Provider success followed by worker crash.  
9. Transient failure invokes appropriate retry.  
10. Permanent failure follows the correct path.  
11. Dead-letter recovery.  
12. Tenant partition fairness.  
13. Per-tenant worker capacity protection.  
14. Wait survives deployment and restart.  
15. Correct workflow cancellation.  
16. Cross-deployment workflow-version compatibility.  
17. No cross-tenant execution-context leakage.  
18. No silent loss of acknowledged business events after database failure.

Evaluate PGlite versus genuine PostgreSQL for DBOS testing.

Use Testcontainers or another disposable PostgreSQL environment where necessary.

Separate six testing tiers:

1. Fast unit tests.  
2. Existing PGlite tests.  
3. Database integration tests.  
4. DBOS recovery tests.  
5. Provider contract tests.  
6. End-to-end acceptance tests.

Preserve existing tests. Do not weaken them to accommodate the new system.

### **20\. Architecture decision records**

Produce exactly nine ADRs:

1. DBOS-only versus pg-boss coexistence and complete replacement.  
2. One runtime process versus separate web/worker groups.  
3. Shared versus separate DBOS system database.  
4. Shared database versus database-per-tenant.  
5. Shared Fly application versus dedicated tenant applications.  
6. PGlite versus real PostgreSQL for DBOS integration testing.  
7. Incremental migration versus larger cutover.  
8. Transactional outbox versus direct workflow enqueueing.  
9. Durable waits versus alternative scheduling and suspension strategies.

Every ADR must include eleven fields:

1. Context.  
2. Options.  
3. Advantages.  
4. Disadvantages.  
5. Failure modes.  
6. Operational implications.  
7. Cost implications.  
8. Recommendation.  
9. Rejection rationale.  
10. Conditions for revisiting.  
11. Evidence and unresolved questions.

Do not create additional ADR counts for pg-boss retention or durable waits; they are already ADRs one and nine.

Explicitly identify decisions requiring human approval, including:

* Tenancy model.  
* DBOS system database placement.  
* RPO/RTO.  
* Quotas.  
* Pricing assumptions.  
* Premium isolation strategy.

### **21\. Unit economics and profitability**

Model eight cost categories:

1. Fixed infrastructure costs.  
2. Variable infrastructure costs.  
3. AI model expenses.  
4. SMS and voice expenses.  
5. Payment processing fees.  
6. External integration costs.  
7. Storage and data transfer.  
8. Operational and customer-support costs.

Use current official pricing where available, with citations.

Separate verified prices from estimates and assumptions.

Use the contribution margin formula:

Revenue per tenant  
minus infrastructure allocation  
minus AI and messaging consumption  
minus external provider charges  
minus payment fees  
equals contribution margin.

Design:

* Usage metering.  
* Initial quotas.  
* Cost warnings.  
* Hard limits.  
* Plan upgrades.  
* Per-tenant reporting.  
* AI budgets.  
* Campaign controls.  
* Capacity allocation.

Compare DBOS-only and hybrid cost for the two concrete workloads.

The architecture must be affordable for a small number of paying customers and protect gross margins.

### **22\. Final architecture document**

Create exactly one new architecture document:

`docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md`

Relative to the resolved Git root, or a clearly named versioned alternative if the target already exists.

Include all eighteen major sections required by prompt3:

1. Executive recommendation.  
2. Verified current architecture.  
3. Repository and test inventory.  
4. Behavioral compatibility requirements.  
5. Target architecture.  
6. DBOS workflow mapping.  
7. Tenant isolation design.  
8. Neon database architecture.  
9. Fly.io deployment architecture.  
10. Dockerfile and fly.toml design.  
11. Migration and cutover strategy.  
12. Testing and acceptance criteria.  
13. Observability and Day 2 operations.  
14. Security and disaster recovery.  
15. Commercial SaaS capabilities.  
16. Cost and profitability analysis.  
17. Phased implementation roadmap.  
18. Risks, unresolved questions, and architecture decisions.

Include Mermaid architecture and deployment diagrams, evidence references, matrices, ADRs, directory structure, configuration/secret inventory, deployment design, test acceptance checklist, production-readiness checklist, and operational procedures.

Clearly distinguish facts, assumptions, recommendations, proposed changes, and needs-approval decisions.

Estimate complexity and dependencies realistically. Do not invent precise delivery dates.

The architecture document must independently answer:

1. Behavioral fidelity.  
2. Tenant isolation.  
3. Durable execution.  
4. Operational simplicity.  
5. Commercial viability.

### **23\. Required seventeen-step methodology**

Execute these steps sequentially.

1. Resolve repository root and capture before-state Git status.  
2. Establish repository and test baseline.  
3. Build and backfill the evidence ledger.  
4. Trace tenant identity end-to-end.  
5. Capture exact pg-boss behavior.  
6. Verify DBOS runtime capabilities.  
7. Verify Neon and Fly deployment behavior.  
8. Construct the complete pg-boss-to-DBOS compatibility matrix before drafting.  
9. Analyze external side-effect correctness.  
10. Compare pg-boss retention alternatives.  
11. Establish commercial and economic assumptions.  
12. Create the nine ADRs.  
13. Assemble the eighteen-section architecture document.  
14. Conduct the behavioral traceability audit.  
15. Conduct the migration and rollback audit.  
16. Conduct the cross-section consistency audit.  
17. Capture final Git status and prepare the final report.

The compatibility matrix must precede drafting.

The behavioral traceability matrix must be assembled and audited after document assembly, preserving the original prompt3 sequence.

The migration audit must separately verify:

* Every migration item.  
* All five migration fields.  
* Mutual exclusion of pg-boss and DBOS.  
* Phase-specific rollback.  
* Freeze, drain, migrate, verify, reactivate.  
* Recovery of already-started DBOS executions.  
* Shadow execution never performing real external writes.  
* Measurable completion criteria for every phase.

The cross-section consistency audit must verify twelve areas:

1. DBOS runtime topology.  
2. Fly process groups.  
3. Database connection budget.  
4. Neon connection configuration.  
5. Migration ordering.  
6. Workflow versioning.  
7. Worker availability.  
8. Autostop/autostart policies.  
9. Cost model.  
10. Tenant concurrency controls.  
11. pg-boss retention decision.  
12. Recovery procedures.

Run no more than three full consistency-audit passes. If unresolved inconsistencies remain after the third pass, document them as blockers or decisions requiring human approval. Do not loop indefinitely.

### **24\. Deterministic validation and count audits**

Audit the required counts and definitions:

* 15 pg-boss profile fields.  
* 11 ADR fields across exactly 9 ADRs.  
* At least 18 security threat areas.  
* 14 tenant identity trace points.  
* 11 migration-state items, each with the five original migration fields.  
* Five-column behavioral traceability matrix across eight behavior areas.  
* 18 DBOS resilience scenarios.  
* 14 side-effect analysis checks: the 12 original considerations plus two explicitly identified additional checks.  
* 13 workflow workload categories.  
* 16 retention comparison dimensions.  
* 9 tenancy comparison dimensions.  
* 16 SaaS capabilities.  
* 14 operational metrics.  
* 10 logging fields.  
* 9 operator administration capabilities.  
* 8 cost categories.  
* 6 evidence-ledger fields.  
* 6 testing tiers.  
* 5 external-operation recovery categories.  
* 12 cross-section consistency checks.  
* 9 tenant taxonomy entities.  
* 18 major architecture-document sections.

Audit all enumerated lists, not merely their totals.

For other requirements, preserve the exact lists in prompt3.

### **25\. Cleanup and working-tree verification**

Capture full Git status before and after.

Only the architecture document may be a new persistent repository artifact.

All pre-existing files, including untracked user files and planning documents, must remain unchanged.

Cleanup is permitted only for artifacts demonstrably created by this execution, located in temporary, cache, or ignored directories, containing no pre-existing user content.

List cleaned artifacts in the report.

Do not delete user files or change existing configuration to obtain a clean status.

### **26\. Final report**

Report:

1. Files and tests inspected.  
2. Exact commands and observed test results.  
3. Verified architectural findings.  
4. Evidence-backed recommendations.  
5. Decisions requiring human approval.  
6. Production-readiness blockers and risks.  
7. Final pg-boss retention recommendation.  
8. Before-and-after Git status.  
9. Exact architecture document location.

Also state whether the architecture convincingly addresses behavioral fidelity, tenant isolation, durable execution, operational simplicity, and commercial viability.

### **27\. Final architectural standard**

Do not optimize for technological sophistication, theoretical scale, or the shortest path to a successful deployment.

Build the smallest reliable architecture that can:

* Preserve OpenLevel's proven behavior.  
* Enforce tenant isolation.  
* Recover from crashes.  
* Prevent duplicate external operations.  
* Protect customer data and credentials.  
* Control infrastructure and AI expenditure.  
* Support profitable subscriptions.  
* Be deployed, monitored, recovered, and upgraded by one operator.

The DBOS versus pg-boss decision must be evidence-based.

The Fly and Neon deployment strategy must be operationally coherent.

The migration must have a safe rollback procedure.

Do not confuse a successfully running application with a commercially ready SaaS business.

**Proceed with the repository investigation and produce the final architecture document. Do not implement the system. Do not initiate another planning or prompt-review cycle.**

## **Final recommendation**

This is the version I would use. It resolves the attached review's nine main fixes and its additional consistency concerns.

In particular:

* No dangling `prompt4.md` reference.  
* No ambiguous review-file dependency.  
* The migration mapping and its five required fields are separated correctly.  
* The 14 side-effect checks are explicitly identified as 12 original requirements plus two additions.  
* Threat coverage is a minimum of 18, allowing legitimate additional findings.  
* The compatibility matrix must precede drafting, while the traceability matrix remains a later audit.  
* The consistency audit is bounded to three passes.  
* Cleanup is restricted to demonstrably newly created artifacts.

**Muse should now move directly to repository investigation and deliver the architecture document.**

