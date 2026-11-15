OpenLevel Prompt 3

I consolidated the original architecture assignment, the DBOS-versus-pg-boss discussion, the ten amendments, and the valid findings from the attached review into **one authoritative prompt for Muse**.

I incorporated the review's most important corrections: mandatory migration and rollback planning, explicit tenant taxonomy, complete architecture decision records, detailed Fly.io and Neon requirements, the five-column test traceability matrix, and deterministic validation.

I also corrected the resilience-test count to **18, not 19**, removed hardcoded repository-path assumptions, and made the pg-boss retention decision a formal architecture decision rather than a predetermined outcome.

OpenLevel Plan.md Review.md

## **Consolidated prompt for Muse**

# **OpenLevel Production Architecture: Consolidated Architecture Assignment**

## **1\. Your role and mission**

Act as the principal software architect, senior TypeScript engineer, DBOS specialist, PostgreSQL architect, and production DevOps architect responsible for turning OpenLevel into a commercially viable, production-grade, multi-tenant SaaS platform.

Think like an architect who will personally be accountable for this system's reliability, operating costs, customer data, and profitability over the next three years.

The target architecture:

* TypeScript backend.  
* Existing Hono HTTP API retained wherever possible.  
* DBOS Transact for durable workflow execution and background processing.  
* Neon PostgreSQL for application and DBOS system persistence.  
* Fly.io for application hosting and execution.  
* Existing React/Vite frontend retained.  
* Existing mobile application retained unless investigation identifies a justified compatibility issue.

The objective is to preserve OpenLevel's existing business behavior and tested semantics while introducing durable execution, operational reliability, enforceable multi-tenant isolation, and an economical deployment architecture.

**This is a planning assignment. Do not implement the architecture.**

Produce a comprehensive, evidence-based implementation plan that can subsequently undergo independent adversarial review before any engineering changes begin.

## **2\. Source-of-truth hierarchy**

Inspect these sources when available:

1. `docs/plans/prompt1.md` — original requirements and deliverables.  
2. `docs/plans/prompt2.md` — subsequent mandatory amendments.  
3. `docs/plans/plan.md` and other existing planning documents — previous execution proposals, to be evaluated rather than blindly trusted.  
4. `deepwiki.md` — preliminary repository analysis.  
5. The actual local Git checkout — authoritative source for implementation and testing behavior.  
6. Current official DBOS, Neon, and Fly.io documentation — authoritative source for framework and infrastructure capabilities.

The attached review of `OpenLevel Plan.md` identifies important omissions in previous planning drafts. Incorporate its valid criticisms, especially the missing migration design, tenant taxonomy, commercial architecture, ADRs, testing conformance, deployment details, and evidence discipline.

Do not treat claims from previous AI analyses or planning documents as verified repository facts.

When sources conflict, investigate the current source code and tests. Document discrepancies and their implications.

Do not stop for clarification. Resolve what can be resolved through repository inspection and official documentation. Record remaining assumptions and decisions requiring human approval.

## **3\. Strict operating constraints**

Planning only.

* Do not modify application source files.  
* Do not modify database schemas or migrations.  
* Do not install or upgrade dependencies.  
* Do not deploy anything.  
* Do not create or alter Fly applications.  
* Do not create or alter Neon databases or branches.  
* Do not change infrastructure or external services.  
* Do not execute destructive commands.  
* Do not commit changes.  
* Do not modify existing planning documents.  
* Do not expose credentials or secrets.  
* Do not weaken, delete, or skip existing tests to improve reported results.  
* Do not invent test results, API capabilities, code symbols, implementation details, pricing, or architectural guarantees.

The only permitted repository artifact is the requested new architecture document.

Preserve every pre-existing tracked and untracked file.

If dependencies are missing, do not install them. Record which verification steps could not be executed and why.

Before testing, inspect the test configuration and potential external side effects. Never use production credentials or trigger real customer-facing operations.

## **4\. Mandatory Phase Zero: repository reconnaissance**

First resolve the repository root dynamically:

`git rev-parse --show-toplevel`

Record the actual:

* Repository root.  
* Git branch.  
* Current commit SHA.  
* Full Git status.  
* Existing target document and directory status.

Do not assume a repository-root prefix or claim that a directory is absent without checking.

The required deliverable is:

`docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md`

relative to the Git root.

If the target already exists, select a clearly named, versioned alternative. Never overwrite it.

### **Application inventory**

Inspect the actual repository:

* `package.json` and lockfile.  
* TypeScript configuration.  
* Vite configuration and build scripts.  
* Server initialization and composition.  
* Database connection and repository implementation.  
* Database schema and migration mechanism.  
* Authentication, authorization, session management, and middleware.  
* All API routes and their request/response contracts.  
* All repositories and SQL queries.  
* Domain libraries and business logic.  
* Integration adapters and webhook implementations.  
* Agent engine, tool permissions, approval behavior, and provider configuration.  
* Background jobs and workflow execution.  
* React frontend API usage.  
* Expo/mobile application contracts.  
* Docker and deployment artifacts.  
* Environment variables and secret-resolution mechanisms.

Identify the real implementation architecture, not merely what the README claims.

### **Tenant taxonomy**

Explicitly identify the meaning and relationship of:

* Organization.  
* Agency.  
* SaaS tenant.  
* Location or sub-account.  
* Individual operator.  
* Customer/contact.  
* Workflow definition.  
* Workflow execution.  
* DBOS workflow execution.

Do not assume `location_id` equals the SaaS tenant ID.

Determine which entity owns data, subscriptions, credentials, quotas, billing, and execution limits.

Trace the actual ownership model through the source code.

## **5\. Repository and testing baseline**

Count the actual source and test files. Do not repeat the claimed figures of approximately 190, 182, or any other number without verifying them.

Determine:

* Test files by subsystem.  
* Total test cases.  
* Passing, failing, skipped, and pending tests.  
* Existing test execution time.  
* Flaky tests.  
* Fake database tests.  
* PGlite-backed integration tests.  
* Genuine PostgreSQL integration tests.  
* Frontend and mobile testing gaps.  
* Authentication and authorization coverage.  
* Tenant-isolation coverage.  
* Workflow and failure-recovery coverage.

Inspect test configuration, setup, environment handling, and external mocks before execution.

Discover the actual commands from package scripts. Do not assume commands.

Run the available type-check and test commands without installing dependencies.

Record exact commands and observed results.

If the environment prevents execution, report the limitation rather than claiming success.

The original test suite is an executable behavioral specification and must be preserved.

## **6\. Existing pg-boss behavior: establish the baseline**

Investigate the actual:

* `server/jobs/boss.ts`  
* `server/jobs/agent-reply.ts`  
* `server/jobs/workflow-dispatcher.ts`  
* `server/jobs/workflow-runner.ts`

Include related files, tests, and every other queue consumer discovered.

The preliminary analysis reports the following pg-boss settings. Verify all of them:

* Four retries.  
* Exponential backoff.  
* Five-second initial delay.  
* Three-hundred-second maximum delay.  
* Batch size one.  
* Separate dead-letter queues for agent replies and workflow dispatch.

For every queue and job, document:

* Job name.  
* Trigger.  
* Payload.  
* Tenant and location context.  
* Retry behavior.  
* Backoff.  
* Concurrency.  
* Ordering.  
* Singleton/deduplication behavior.  
* Delay and scheduling behavior.  
* Failure handling.  
* Dead-letter behavior.  
* Idempotency assumptions.  
* Database transaction boundaries.  
* Existing workflow state and resumption behavior.

Identify what the current implementation actually guarantees and what it merely attempts.

In particular, examine the existing workflow wait scheduler and its use of in-process timers.

## **7\. DBOS architecture and pg-boss retention decision**

This is a mandatory architecture decision.

Do not automatically assume pg-boss must be removed, and do not automatically assume it must remain.

Evaluate three alternatives.

### **Option A: DBOS-only**

DBOS handles:

* CRM automation workflows.  
* AI agent execution.  
* Long-running journeys.  
* Scheduled jobs.  
* CSV imports.  
* Bulk processing.  
* Analytics generation.  
* Nightly reports.  
* Other independent background work.

### **Option B: DBOS \+ pg-boss**

DBOS owns durable, stateful business workflows.

pg-boss handles specifically identified independent, high-volume, short-lived jobs.

### **Option C: DBOS orchestration \+ pg-boss execution**

DBOS owns the parent business workflow and coordinates selected batch work executed by pg-boss.

The systems require explicit handoff, transaction, retry, reconciliation, and mutual-exclusion rules.

### **Evaluate concrete workloads**

Use these workloads for comparison:

**Workload A:** Importing 50,000 contacts from a CSV file.

**Workload B:** Generating nightly analytics digests for multiple tenants.

For each alternative evaluate:

* Workflow execution count.  
* Checkpoint volume.  
* PostgreSQL storage growth.  
* Database transactions.  
* Write amplification.  
* Worker throughput.  
* Memory requirements.  
* Connection consumption.  
* Tenant fairness.  
* Retry semantics.  
* Duplicate execution risk.  
* Recovery procedures.  
* Cost per 10,000 and 100,000 processed records.  
* Operational complexity.  
* Monitoring and cleanup requirements.  
* Deployment implications.

Do not invent performance numbers. Define benchmarks and assumptions where actual measurements are unavailable.

### **DBOS long-delay behavior**

Investigate the distinction between durable `DBOS.sleep()` and workflow suspension.

Verify:

* Whether a sleeping workflow remains resident in worker memory.  
* Whether suspension releases that memory.  
* The availability of suspension in the relevant SDK edition.  
* Enterprise licensing and cost implications.  
* Behavior with very large numbers of delayed CRM journeys.  
* Recovery after worker and Fly Machine replacement.

Do not assume that an Enterprise capability is included in the self-hosted SDK.

### **Default position**

DBOS-only is the preferred starting hypothesis.

However, the final recommendation must follow actual code inspection, official documentation, and workload economics.

Retain pg-boss only when a measurable advantage justifies operating a second execution engine.

Document this as a dedicated architecture decision record.

## **8\. DBOS execution architecture**

Research the current official TypeScript SDK and verify the actual API names and supported behavior.

Investigate:

* SDK initialization.  
* Workflow registration.  
* Application launch and shutdown.  
* Worker execution.  
* Steps and transactions.  
* Queues.  
* Scheduling.  
* Durable waits.  
* Workflow recovery.  
* Workflow versioning.  
* Serialization.  
* Replay.  
* Concurrency.  
* Partitioning.  
* Rate limiting.  
* Workflow retention and deletion.

Do not invent DBOS API signatures.

### **Runtime topology**

Determine whether separate Fly.io web and worker process groups can safely use the same DBOS system database and workflow registry.

Verify:

* Initialization requirements in each process.  
* Workflow registration requirements.  
* Shared workflow definitions.  
* Database coordination.  
* Worker lifecycle.  
* Workflow recovery.  
* Duplicate registration concerns.  
* Graceful shutdown.  
* Version compatibility during deployments.

Do not recommend separate process groups until the official SDK documentation supports the proposed topology.

### **Domain separation**

Keep business logic independent of DBOS orchestration.

Preserve the Hono routes, repository contracts, domain services, provider adapters, and business rules wherever possible.

DBOS should provide execution durability, not become an unnecessary dependency of every business function.

### **Workflow determinism**

Identify nondeterministic operations:

* Time.  
* Random identifiers.  
* Database reads and writes.  
* External API requests.  
* Provider responses.  
* Configuration lookups.

Ensure these are executed in appropriate durable steps or transactions.

Respect DBOS serialization and replay requirements.

Use stable identifiers rather than placing large customer records, sensitive credentials, or unnecessary payloads in workflow arguments.

## **9\. DBOS workflow mapping**

Design the mapping for:

1. Agent reply execution.  
2. Workflow event dispatch.  
3. Workflow execution and resumption.  
4. Long-running wait steps.  
5. Scheduled and recurring automations.  
6. Inbound webhooks.  
7. Outbound messaging.  
8. Appointment booking.  
9. Workflow cancellation and failure handling.  
10. Dead-letter inspection and manual replay.  
11. CSV imports.  
12. Nightly analytics.  
13. Other background jobs discovered in the repository.

For every workload document:

* Current implementation.  
* Existing behavior.  
* Proposed DBOS workflow.  
* Proposed steps.  
* Queue and partition design.  
* Input arguments.  
* Tenant context.  
* Idempotency.  
* Failure handling.  
* Retry policy.  
* Recovery.  
* Acceptance tests.

Preserve existing workflow definition language and observable semantics.

## **10\. External side effects and correctness**

This is one of the highest-risk sections.

Never claim that DBOS checkpointing guarantees exactly-once execution of external operations.

A provider may successfully execute an operation before the worker crashes and before its DBOS checkpoint is committed.

Analyze this situation for every important integration:

* Anthropic.  
* Chatwoot.  
* Twilio.  
* SMS and email providers.  
* Stripe.  
* Square.  
* Social integrations.  
* Other external providers discovered.

Consider:

* Provider-side idempotency support.  
* Stable operation IDs.  
* Transactional outbox.  
* Provider callback reconciliation.  
* Duplicate webhook deliveries.  
* Duplicate workflow enqueue attempts.  
* Provider timeout with uncertain outcome.  
* Database transaction failure.  
* Poison messages.  
* Retry classification.  
* DLQ recovery.  
* Manual intervention.

For each operation, explicitly state whether its recovery guarantee is:

* Provider-enforced idempotency.  
* Application-level deduplication.  
* Transactional outbox plus reconciliation.  
* Best-effort retry.  
* Manual recovery.

Do not represent a mechanism as available without verifying it.

An outbox alone does not guarantee exactly-once delivery to an external provider.

## **11\. Tenant isolation and fairness**

Trace tenant context through:

* Authentication.  
* HTTP authorization.  
* Middleware.  
* Repository queries.  
* SQL transactions.  
* Background job payloads.  
* DBOS workflow arguments.  
* Workflow steps.  
* Retries and recovery.  
* Delayed execution.  
* Scheduled jobs.  
* Webhooks.  
* Agent tools.  
* Provider callbacks.

Identify every point where context could be lost, forged, confused, or leaked.

Establish a trusted tenant-identity source. Do not trust arbitrary tenant identifiers in untrusted request bodies or webhook payloads.

Design tenant-aware execution controls using supported DBOS capabilities:

* Global concurrency.  
* Worker concurrency.  
* Partition concurrency.  
* Partition rate limiting.  
* Queue fairness.  
* Noisy-neighbor prevention.

Consider AI agents, SMS campaigns, voice, workflow fan-out, social publishing, imports, and analytics.

A single tenant must not be able to exhaust worker capacity, database connections, or AI budgets for all other tenants.

Include proposed limits and explain which values require production load testing.

## **12\. Neon PostgreSQL architecture**

Research the current official Neon and DBOS documentation.

Evaluate:

1. Separate schemas in the same Neon database.  
2. Separate databases within the same Neon project.  
3. Separate Neon projects.

Explain their trade-offs and recommend an initial design.

### **Connection architecture**

Explicitly distinguish:

* Application database connections.  
* DBOS system database connections.  
* Migration connections.  
* Administrative connections.

Investigate pooled versus direct Neon connections.

The official DBOS Neon guidance has discussed disabling Neon connection pooling for DBOS system-database connections. Verify the current recommendation and the exact requirements rather than blindly applying one connection string to every component.

Propose a connection budget covering:

* Web machines.  
* DBOS workers.  
* Migration execution.  
* Administration.  
* Database limits.  
* Connection pooling.

### **Database operations**

Address:

* Database roles and least privilege.  
* System-table placement.  
* Schema separation.  
* Migration ordering.  
* Incremental migration tooling.  
* Migration rollback strategy.  
* Neon branching for development and testing.  
* Backup and point-in-time recovery.  
* Restoration of DBOS state.  
* Application-data consistency.

Inspect the existing migration mechanism.

If it re-applies a complete schema file, explain why that may be inadequate for a commercial production deployment.

Investigate ordering between application migrations and DBOS system database initialization.

## **13\. Fly.io deployment architecture**

Fly.io is the target hosting platform.

Evaluate at least two deployment configurations:

A. Web API and DBOS runtime together.

B. Separate web API and DBOS worker processes using Fly process groups and one container image.

Recommend one after verifying DBOS runtime support and operational trade-offs.

### **Deployment specification**

Address:

* Node.js version.  
* Dockerfile architecture.  
* Build process.  
* Runtime dependencies.  
* Startup commands.  
* Process groups.  
* HTTP service.  
* Internal port.  
* Worker networking.  
* Health checks.  
* Liveness and readiness.  
* Machine sizing.  
* CPU and memory.  
* Machine restart policies.  
* Minimum running machines.  
* Scaling.  
* Graceful shutdown.  
* Secret injection.  
* Deployment strategy.  
* Rollback.

### **fly.toml**

Design a native Fly TOML configuration that makes deployment straightforward.

Evaluate:

* Process groups.  
* HTTP service configuration.  
* Internal ports.  
* Release commands.  
* Health checks.  
* Machine sizing.  
* Autostart and autostop.  
* Minimum machine counts.  
* Deployment strategy.  
* Restart behavior.

Use `release_command` appropriately for one-time migrations.

Never execute migrations independently on every web or worker startup.

A migration failure must stop an unsafe release.

Ensure the worker is not exposed as an unnecessary public HTTP service.

Explain how DBOS workflow state survives deployment and machine replacement.

Do not automatically disable autostopping everywhere without analyzing the reliability and cost implications.

### **DBOS build and bundling**

Investigate DBOS workflow registration and bundling restrictions.

Do not blindly bundle DBOS workflow registries through Vite, esbuild, Rollup, or another bundler.

Verify the official recommended production build arrangement for TypeScript DBOS applications.

Keep the frontend build and backend DBOS runtime concerns appropriately separated.

### **Deployment usability**

The intended operator experience should be approximately:

1. Configure Fly and Neon.  
2. Set required secrets.  
3. Deploy using `fly deploy`.

Document all unavoidable setup steps, prerequisites, and manual operations.

Do not promise one-command deployment if additional provisioning is required.

## **14\. Day 2 operations**

Design operations as part of the first production release.

### **Structured logging**

Include:

* Timestamp.  
* Request ID.  
* Tenant ID.  
* Location ID.  
* Workflow ID.  
* Event ID.  
* Provider.  
* Execution status.  
* Retry number.  
* Error classification.

Never expose credentials or sensitive customer data in logs.

### **Metrics and alerting**

Include at least:

* HTTP latency.  
* HTTP error rates.  
* Database connections and utilization.  
* Queue backlog.  
* Workflow execution duration.  
* Retry rate.  
* Dead-letter count.  
* Stuck workflows.  
* Failed external operations.  
* Provider API availability.  
* AI token consumption.  
* AI cost per tenant.  
* SMS and voice consumption.  
* Storage and resource consumption.

Define useful operational alerts, severity levels, and suggested responses.

### **Administrative operations**

Design the minimum operator capabilities needed to:

1. Search workflow executions.  
2. Inspect failed workflows.  
3. Review dead-letter events.  
4. Retry eligible workflows safely.  
5. Cancel workflows.  
6. Identify noisy tenants.  
7. Investigate integration failures.  
8. Reconcile uncertain external operations.  
9. Investigate customer complaints.

An operator-only administrative interface may be proposed, but avoid unnecessary frontend work in the initial migration.

### **Recovery and disaster preparedness**

Specify:

* Neon backups.  
* Point-in-time recovery.  
* Recovery point objective.  
* Recovery time objective.  
* Restoration tests.  
* DBOS system-state restoration.  
* Application-data consistency.  
* Secret recovery.  
* Migration rollback.  
* Incident procedures.

Do not invent approved RPO/RTO targets. Propose reasonable candidates and label them as decisions requiring business approval.

A backup that has never been restored is not a verified backup.

## **15\. Security architecture**

Conduct a tenant-isolation and application-security threat analysis.

Investigate:

* Cross-tenant SQL access.  
* Location authorization.  
* Organization ownership.  
* Operator permissions.  
* Session and cookie security.  
* Webhook authentication.  
* Provider credentials.  
* Secret encryption and rotation.  
* Database privileges.  
* Workflow payload exposure.  
* Prompt injection.  
* Agent tool authorization.  
* Rate limiting.  
* Public booking endpoints.  
* Public funnels.  
* Data export.  
* Abuse prevention.  
* Tenant suspension.

Distinguish implemented protections from proposed controls.

Identify high-impact security failures and the tests required to prevent them.

## **16\. Commercial SaaS architecture**

The platform must support a real revenue-generating business, not merely demonstrate technical functionality.

Evaluate three tenancy approaches.

### **A. Shared Fly application and shared Neon database**

### **B. Shared Fly application with database-per-tenant**

### **C. Dedicated Fly application and dedicated Neon database**

For every approach analyze:

* Infrastructure cost.  
* Development complexity.  
* Operational burden.  
* Tenant isolation.  
* Backup and restoration.  
* Migration complexity.  
* Scaling.  
* Customer support.  
* Suitability for subscription tiers.

Recommend the most economical initial arrangement and a credible upgrade path for premium customers.

### **SaaS capabilities inventory**

Verify which capabilities exist and which require new development:

* Customer registration.  
* Agency provisioning.  
* Location provisioning.  
* Organization ownership.  
* SaaS subscription billing.  
* Usage metering.  
* Plan enforcement.  
* Resource quotas.  
* Tenant suspension.  
* Reactivation.  
* Customer onboarding.  
* Customer offboarding.  
* Data export.  
* White-label branding.  
* Custom domains.  
* Per-tenant integration credentials.

Distinguish our SaaS subscription billing from existing CRM customer invoicing and subscription management.

These are different business functions.

Design a minimum commercially viable control plane.

## **17\. Unit economics and profitability**

Evaluate the actual cost structure.

Use current documented Fly.io and Neon prices when researching estimates. Cite official pricing sources and distinguish estimates from verified prices.

Model:

1. Fixed infrastructure costs.  
2. Variable infrastructure costs.  
3. AI model costs.  
4. SMS and voice costs.  
5. Payment processing.  
6. External integrations.  
7. Storage and data transfer.  
8. Operational and customer-support costs.

Use:

Revenue per tenant  
minus infrastructure allocation  
minus AI and messaging consumption  
minus external provider costs  
minus payment fees  
equals contribution margin.

Design usage metering to prevent unprofitable tenants.

Include:

* Initial usage quotas.  
* Cost warnings.  
* Hard limits.  
* Plan upgrades.  
* Per-tenant consumption reporting.  
* AI usage budgets.  
* Campaign and messaging controls.  
* Worker capacity allocation.

Evaluate the cost of DBOS-only versus DBOS \+ pg-boss.

Include cost-per-workload comparison for CSV import and nightly analytics.

Do not fabricate performance or cost figures. Label every assumption.

The architecture must be economical for a small number of paying customers, not merely capable of theoretical scale.

## **18\. Testing and behavioral conformance**

Create a five-column traceability matrix:

| Existing behavior | Existing test | Proposed implementation | New test | Acceptance criterion |
| :---: | :---: | :---: | :---: | :---: |

Cover existing route contracts, repository behavior, domain logic, tenant scoping, integrations, agents, workflows, and error handling.

Preserve existing tests wherever possible.

Add the following 18 DBOS resilience scenarios:

1. Workflow completes successfully.  
2. Process crashes during execution.  
3. Process restarts and resumes.  
4. Completed steps are not repeated during recovery.  
5. Interrupted steps retry safely.  
6. Duplicate workflow submissions are deduplicated.  
7. Duplicate webhook delivery is handled safely.  
8. Provider succeeds but the worker crashes before checkpointing.  
9. Transient provider failure invokes the correct retry behavior.  
10. Permanent provider failure reaches the correct failure path.  
11. Dead-letter recovery works.  
12. Tenant partitioning enforces fairness.  
13. One tenant cannot exhaust worker capacity.  
14. Workflow wait survives deployment and restart.  
15. Workflow cancellation behaves correctly.  
16. Workflow versions remain compatible across deployments.  
17. Tenant context cannot leak across concurrent executions.  
18. Database failure does not silently lose acknowledged business events.

Investigate whether PGlite is appropriate for DBOS integration testing.

Do not assume PostgreSQL compatibility guarantees complete compatibility with DBOS internals.

Use disposable genuine PostgreSQL environments, such as Testcontainers, where necessary.

Separate:

* Fast unit tests.  
* Existing PGlite tests.  
* Database integration tests.  
* DBOS recovery tests.  
* External provider contract tests.  
* End-to-end acceptance tests.

Do not weaken the old tests to accommodate the new implementation.

## **19\. Migration and cutover strategy**

This is mandatory. The final architecture must contain a safe implementation path, not just a target-state diagram.

Design phases 0 through 7:

**Phase 0 — Baseline**

Repository inventory, test baseline, architecture map, behavior specification.

**Phase 1 — DBOS foundation**

Initialize DBOS, validate system database configuration, registration, execution, recovery, and a minimal vertical slice.

**Phase 2 — Execution abstractions**

Separate domain operations from orchestration and introduce stable event and workflow identity contracts.

**Phase 3 — Workflow dispatch**

Migrate event dispatch, execution, resumption, delayed steps, and scheduling.

**Phase 4 — Agent execution**

Migrate customer-facing agents, provider operations, tools, retries, and approval behavior.

**Phase 5 — Operational hardening**

Observability, DLQ administration, tenant controls, secrets, recovery, and cost monitoring.

**Phase 6 — Fly.io production deployment**

Dockerfile, TOML, process groups, release commands, health checks, rollout, and rollback.

**Phase 7 — Commercial readiness**

Provisioning, billing, usage metering, onboarding, quotas, and support operations.

Revise the order if repository evidence justifies it.

### **Migration compatibility matrix**

Map every pg-boss job and workflow state to the proposed DBOS behavior.

Explicitly cover:

* Pending jobs.  
* Running jobs.  
* Failed jobs.  
* Retry attempts.  
* Dead-letter jobs.  
* Delayed jobs.  
* Long-running waits.  
* Historical workflow run IDs.  
* Retry history.  
* Existing execution positions.  
* Existing deduplication identifiers.

For every item, define:

* Migration strategy.  
* Compatibility requirements.  
* Cutover behavior.  
* Recovery behavior.  
* Rollback behavior.

### **Mutual exclusion**

Never permit pg-boss and DBOS to independently execute the same customer-facing side effect.

Define an explicit ownership mechanism for each execution type.

Transactional handoff and reconciliation must be specified.

Shadow mode may inspect or replay harmless inputs, but must never send real messages, charge customers, create appointments, or perform other external writes.

### **Rollback**

Provide a precise rollback strategy for each migration phase.

Address the consequences of DBOS executions already started when rolling back to pg-boss.

Do not assume DBOS state can be automatically translated back into pg-boss state.

Document freeze, drain, migration, verification, and reactivation procedures.

Every phase must have measurable completion criteria.

## **20\. Architecture decision records**

Challenge the proposed design instead of simply validating it.

Create ADRs for at least these nine decisions:

1. DBOS-only versus pg-boss coexistence and complete replacement.  
2. One runtime process versus separate Fly web and worker groups.  
3. Shared versus separate DBOS system database.  
4. Shared database versus database-per-tenant.  
5. Shared Fly application versus dedicated tenant applications.  
6. PGlite versus real PostgreSQL for DBOS integration testing.  
7. Incremental migration versus larger cutover.  
8. Transactional outbox versus direct workflow enqueueing.  
9. Durable waits versus alternative scheduling and suspension strategies.

Also include the three specific pg-boss alternatives and the two concrete workload evaluations.

Each ADR must contain:

* Context.  
* Options.  
* Advantages.  
* Disadvantages.  
* Failure modes.  
* Operational implications.  
* Cost implications.  
* Recommendation.  
* Rejection rationale.  
* Conditions that would justify revisiting the decision.  
* Evidence and unresolved questions.

Identify decisions requiring explicit business-owner approval, including tenancy model, RPO/RTO, usage quotas, pricing assumptions, and DBOS system-database placement.

Do not present these as already-approved policies.

## **21\. Cross-section architectural consistency**

Before finalizing, verify that these decisions agree with one another:

* DBOS runtime topology.  
* Fly process groups.  
* Database connection budget.  
* Neon connection configuration.  
* Migration ordering.  
* Workflow versioning.  
* Worker availability.  
* Autostop/autostart policies.  
* Cost model.  
* Tenant concurrency controls.  
* pg-boss retention decision.  
* Recovery procedures.

A configuration that works in one section but contradicts another is not an acceptable design.

Include a final consistency audit.

## **22\. Required final document**

Create:

`docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md`

relative to the dynamically resolved Git root.

The final document must contain these 18 major sections:

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

Include:

* Executive diagrams using Mermaid where useful.  
* Verified repository paths and actual symbols.  
* Existing-to-proposed behavior traceability matrix.  
* pg-boss/DBOS compatibility matrix.  
* Architecture decision records.  
* Proposed directory structure.  
* Configuration and secret inventory.  
* Fly deployment design.  
* Testing acceptance checklist.  
* Production-readiness checklist.  
* Operational procedures.  
* Explicit unresolved decisions.

Distinguish verified facts, assumptions, recommendations, proposed changes, and decisions requiring human approval.

Provide realistic complexity estimates and sequencing, but do not invent precise delivery dates.

## **23\. Working methodology and final validation**

Do not draft the architecture document in one unverified pass.

Use this sequence:

1. Resolve repository root and capture before-state Git status.  
2. Establish the repository and test baseline.  
3. Build the source evidence ledger.  
4. Trace tenant identity end-to-end.  
5. Capture exact pg-boss behavior.  
6. Verify DBOS runtime capabilities.  
7. Verify Neon and Fly deployment behavior.  
8. Build the workflow compatibility matrix.  
9. Analyze external side-effect correctness.  
10. Compare pg-boss retention alternatives.  
11. Establish commercial and economic assumptions.  
12. Create architecture decision records.  
13. Assemble the 18-section document.  
14. Perform the five-column testing traceability audit.  
15. Perform a migration and rollback completeness audit.  
16. Perform a cross-section consistency audit.  
17. Capture final Git status.

### **Evidence ledger**

For repository-specific findings, record:

* Source file.  
* Symbol.  
* Actual observed behavior.  
* Corresponding tests.  
* Evidence status.  
* Architectural implication.

For external framework claims, record the official documentation URL and the exact capability verified.

### **Validation rules**

Verify that:

* All 18 major sections are present.  
* All requirements from prompt1 and prompt2 are satisfied.  
* Every valid criticism in the attached review has been addressed.  
* All 18 DBOS resilience scenarios are accounted for.  
* Every queue and workflow has a migration mapping.  
* Every important external side effect has a recovery mechanism.  
* Tenant identity cannot silently disappear during delayed execution or recovery.  
* Every material ADR includes alternatives and rejection rationale.  
* All important costs have evidence or clearly labeled assumptions.  
* The Fly deployment configuration is internally consistent.  
* The Neon connection architecture is internally consistent.  
* The final document contains no unsupported repository claims.

Capture `git status` before and after.

The only new repository artifact must be the requested architecture document. Preserve all existing files and untracked items.

If the target already exists, use a versioned alternative and explain why.

### **Final report to the user**

At completion, report:

1. Files and tests inspected.  
2. Exact tests and commands executed, with observed results.  
3. Verified architectural findings.  
4. Evidence-backed recommendations.  
5. Decisions requiring human approval.  
6. Production-readiness blockers and risks.  
7. Final pg-boss retention recommendation.  
8. Before-and-after Git status.  
9. Exact architecture document location.

## **Final architectural standard**

The objective is not to create the most sophisticated architecture or to integrate DBOS merely because it is a modern framework.

The objective is to build the smallest, most reliable, economically defensible architecture that can support a real paying multi-tenant SaaS business.

It must preserve OpenLevel's tested behavior, protect tenant data, recover from crashes, prevent duplicate external operations, control variable costs, and remain straightforward for one person to deploy and operate.

**Do not confuse technical sophistication with commercial readiness.**

A successful architecture must answer five questions convincingly:

1. Behavioral fidelity: can we demonstrate that the new system preserves existing behavior?  
2. Tenant isolation: can customers ever access each other's data, workflows, or credentials?  
3. Durable execution: can the system recover without losing business events or accidentally repeating external operations?  
4. Operational simplicity: can one operator deploy, monitor, troubleshoot, restore, and upgrade the platform?  
5. Commercial viability: can the architecture serve paying customers economically while protecting gross margins?

Produce the evidence-based implementation plan. Do not implement anything.

**My recommendation:** Use this consolidated prompt as the single instruction to Muse. Retire the earlier short amendments rather than sending them separately; otherwise Muse may interpret them as overlapping assignments.

The next deliverable should be the actual architecture document, not another meta-plan describing how to prepare one.

