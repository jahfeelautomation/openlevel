Prompt 1

# **OpenLevel: recommended porting strategy**

My recommendation is to pursue **TypeScript \+ DBOS \+ Neon \+ Fly.io**, retaining the existing React frontend and treating the OpenLevel backend as the behavioral specification for the new execution architecture.

I would not approach this as a conventional backend rewrite. I would approach it as building a commercially deployable, multi-tenant SaaS platform whose reliability, tenant isolation, and operational simplicity are designed into the first release.

The most important principle:

**Preserve OpenLevel's externally observable behavior; improve the reliability and operational architecture underneath it.**

That means the existing approximately 190 backend test files described in `deepwiki.md` are not merely tests to port. They are an executable behavioral contract. The new implementation must demonstrate equivalent behavior, particularly around tenant isolation, authentication, integrations, automation execution, and agent actions.

There is one important deployment finding already worth incorporating: DBOS's official Neon integration recommends disabling Neon connection pooling for the DBOS system-database connection. We should not blindly reuse the application's pooled database URL for DBOS.

DBOS Docs+1

## **Architecture decisions I would give Muse**

**1\. Preserve the existing application**

Keep Hono, the React SPA, the domain logic, repositories, PostgreSQL schema, provider adapters, and HTTP contracts. Do not rewrite working domain functionality merely to introduce DBOS.

**2\. Replace the background execution architecture**

Evaluate replacing pg-boss with DBOS workflows, steps, queues, scheduling, recovery, and workflow versioning. Keep the business operations themselves independent of the orchestration framework.

**3\. Separate web and worker capacity**

Use one container image with separate Fly.io process groups for the public API and DBOS workers. This gives independent scaling, resource limits, and operational controls without creating separate applications for every customer.

**4\. Start with shared multi-tenancy**

Retain the existing location-scoped data model, but strengthen tenant isolation, tenant-aware queue partitioning, quotas, rate limits, and secrets management. Design an upgrade path to dedicated databases or deployments for premium customers.

**5\. Treat deployments as production operations**

Use `fly.toml`, health checks, controlled migrations, graceful shutdown, workflow-version compatibility, observability, recovery procedures, and backup restoration tests from the beginning.

There are three particularly important technical details that the plan must not overlook.

* DBOS steps have at-least-once execution semantics when a step fails before its checkpoint is recorded. A successful external SMS or payment operation followed by a crash before checkpointing can therefore be repeated. DBOS does not magically guarantee exactly-once delivery to third-party providers. Design explicit idempotency and reconciliation around external side effects.  
   DBOS Docs+2  
* DBOS supports globally and per-partition controlled workflow concurrency and rate limiting. This is useful for preventing one customer's automation storm from consuming the capacity of everyone else.  
   DBOS Docs+1  
* DBOS workflow versioning matters during deployments. Its documentation recommends blue-green deployment patterns that allow old workflow executions to finish on compatible code.  
   DBOS Docs+1

I would also correct one potentially misleading assumption in the original DeepWiki discussion: moving the agent-reply job into DBOS does not, by itself, eliminate duplicate SMS, email, or payment operations. That must be an explicit architectural requirement.

## **Prompt for Muse**

Paste the following into Muse while its working directory is the local OpenLevel repository.

# **Architecture Assignment: OpenLevel → TypeScript \+ DBOS \+ Fly.io \+ Neon**

## **Your role**

Act as a principal software architect, senior TypeScript engineer, DBOS specialist, and production DevOps architect.

You are responsible for designing the production architecture of OpenLevel, an open-source, AI-first CRM and automation platform intended to become a commercially viable, multi-tenant SaaS business.

Think like an architect responsible for the platform's success over the next three years, not an engineer trying to get a demo running.

Your priorities, in order:

1. Behavioral fidelity: preserve the semantics and guarantees of the existing application and its test suite.  
2. Multi-tenant security: prevent cross-tenant data access, execution leakage, resource starvation, and credential exposure.  
3. Extreme deployment usability: a developer should be able to deploy and operate the platform on Fly.io using a well-designed `fly.toml` and a small set of secrets.  
4. Operational reliability: build for recovery, upgrades, observability, backups, and incident response from day one.  
5. Commercial viability: minimize infrastructure costs while protecting gross margins and ensuring the architecture can support paying customers.

## **1\. Mission**

Produce a detailed, technically grounded implementation plan to evolve this codebase into:

* TypeScript backend.  
* Hono HTTP API, retaining existing application contracts wherever possible.  
* DBOS Transact for durable workflows and background execution.  
* Neon PostgreSQL as the persistent application and DBOS system database infrastructure.  
* Fly.io as the application deployment and execution platform.  
* React/Vite frontend retained as the existing user interface.

The primary objective is to replace or progressively migrate the existing pg-boss-based execution architecture to DBOS without unnecessarily rewriting proven business logic.

This is an architectural migration, not an excuse to redesign everything.

**Do not implement anything yet. Your assignment is to investigate, reason, and write the implementation plan.**

## **2\. Starting context**

The accompanying DeepWiki analysis describes the following existing application characteristics. Treat these as preliminary findings, NOT verified facts. Verify every relevant assertion against the actual local repository.

### **Existing architecture**

* `server/`: Hono backend.  
* `src/`: React/Vite frontend.  
* `openconnector/`: Expo/React Native mobile client.  
* PostgreSQL database and repository abstractions.  
* Existing multi-tenancy based heavily on `location_id` scoping.  
* Existing authentication, authorization, integrations, and agent infrastructure.  
* Existing background execution through pg-boss.  
* Existing tests reportedly number approximately 190, comprising unit, repository, and route integration tests.

### **Existing domain functionality**

CRM, contacts, opportunities, pipelines, conversations, tasks, calendars, appointments, workflows, campaigns, templates, messaging, voice, reviews, invoices, subscriptions, payments-related functionality, courses, communities, social integrations, affiliates, reporting, and AI agents.

### **Existing asynchronous execution**

The DeepWiki analysis identifies:

* `server/jobs/boss.ts`  
* `server/jobs/agent-reply.ts`  
* `server/jobs/workflow-dispatcher.ts`  
* `server/jobs/workflow-runner.ts`

There are two primary queue responsibilities:

* Agent reply dispatch.  
* Workflow event dispatch.

The existing queue configuration reportedly includes:

* Four retry attempts.  
* Exponential backoff.  
* Five-second initial retry delay.  
* Three-hundred-second maximum retry delay.  
* Batch size one.  
* Separate dead-letter queues for agent replies and workflow dispatch.

The workflow runner also reportedly supports resumption through run IDs and execution positions, but its current wait scheduler uses in-process timers. Investigate precisely what is implemented and what remains incomplete.

### **Existing testing**

The DeepWiki analysis claims:

* Approximately eighty unit tests.  
* Approximately fifty repository tests.  
* Approximately fifty route integration tests.  
* Repository tests verifying SQL generation and tenant scoping.  
* PGlite-backed integration tests using production schema definitions.

Do not accept these numbers without counting the actual files and running the test suite.

The existing suite is the most valuable asset in this migration.

It must become the behavioral reference for the new architecture.

## **3\. Mandatory Phase Zero: Repository reconnaissance**

Before proposing architecture, perform a systematic investigation of the actual checkout.

Do not infer implementation details from README files, previous AI analyses, or online repository documentation when the source code is available.

Inspect:

* Git branch, commit, working tree, and uncommitted changes.  
* `package.json`, lockfile, `tsconfig.json`, Vite configuration, and build scripts.  
* Server initialization and application composition.  
* Database connection and repository implementation.  
* Database schema and migration scripts.  
* Authentication, sessions, middleware, and authorization.  
* Every route and its HTTP contract.  
* All repositories and their tenant-scoping mechanisms.  
* All domain libraries and business logic.  
* All external integrations and provider adapters.  
* AI agent configuration, execution, tool permissions, and approval behavior.  
* All background jobs and workflow execution logic.  
* All existing tests and their actual execution status.  
* Docker-related files, existing deployment documentation, and environment configuration.

Produce a complete inventory.

Pay particular attention to the distinction between:

* Organization or agency.  
* Location or sub-account.  
* Individual operator.  
* Customer/contact.  
* Workflow execution.  
* DBOS workflow execution.

Do not assume `location_id` and SaaS tenant ID are necessarily identical.

### **Testing baseline**

Run the existing test and type-check commands when the local environment permits.

Record:

* Number of test files.  
* Number of tests.  
* Passing, failing, skipped, and pending tests.  
* Runtime.  
* Any existing flaky tests.  
* Database requirements.  
* Which tests use fake databases.  
* Which tests use PGlite.  
* Which tests verify real PostgreSQL behavior.

Never weaken, delete, skip, or rewrite an existing test merely to make the proposed migration look easier.

Identify gaps between claimed and actual test coverage.

## **4\. Proposed architectural direction: TypeScript \+ DBOS**

Investigate the current DBOS TypeScript SDK and its actual capabilities. Do not assume its APIs or behavior from memory.

Evaluate `@dbos-inc/dbos-sdk` and the appropriate officially maintained integrations.

Determine how DBOS should be integrated with the existing Hono application.

### **Preserve the existing application**

Unless your investigation establishes an unavoidable reason otherwise, preserve:

* Hono routes.  
* Request and response schemas.  
* Authentication and session behavior.  
* Database repositories.  
* Existing domain services.  
* Integration adapters.  
* Existing business rules.  
* Frontend API compatibility.  
* Existing tests.

Keep orchestration concerns separate from domain logic.

The objective is for DBOS to execute business operations reliably, not to turn every existing function into a DBOS-specific function.

### **Design the DBOS execution layer**

Map the current pg-boss responsibilities to DBOS.

For every queue and job, document:

* Current behavior.  
* Trigger conditions.  
* Input payload.  
* Tenant context.  
* Existing retry semantics.  
* Existing failure handling.  
* Dead-letter behavior.  
* Execution ordering.  
* Concurrency requirements.  
* Existing idempotency assumptions.  
* Proposed DBOS workflow.  
* Proposed DBOS steps.  
* Proposed DBOS queue.  
* Retry and recovery behavior.  
* Acceptance tests.

Explicitly investigate:

1. Agent reply execution.  
2. Workflow event dispatch.  
3. Workflow execution and resumption.  
4. Long-running waits.  
5. Scheduled and recurring automations.  
6. Inbound webhooks.  
7. Outbound messaging.  
8. Appointment booking.  
9. Workflow cancellation and failure handling.  
10. Dead-letter inspection and manual replay.

Do not simply translate a pg-boss `send()` call into a DBOS `startWorkflow()` call.

Preserve the actual business semantics.

### **Critical DBOS correctness requirements**

DBOS steps have at-least-once execution semantics when an interrupted step has not yet been checkpointed.

Never claim that checkpointing alone guarantees exactly-once SMS, email, payments, or other external side effects.

Design explicitly for:

* Stable workflow IDs.  
* Idempotency keys.  
* Duplicate webhook delivery.  
* Duplicate workflow enqueue attempts.  
* Crash after provider success but before checkpoint.  
* Provider timeout with uncertain outcome.  
* Database transaction boundaries.  
* Transactional outbox where appropriate.  
* Side-effect reconciliation.  
* Retry classification.  
* Poison messages.  
* Dead-letter retention and recovery.

Pay particular attention to Stripe, Twilio, Chatwoot, Anthropic, and other external provider operations.

The resulting system must not accidentally send duplicate messages, create duplicate appointments, or execute duplicate financial operations.

### **Workflow determinism**

Identify every nondeterministic operation in proposed workflows:

* Database reads and writes.  
* HTTP calls.  
* Random ID generation.  
* Current time.  
* External provider responses.  
* Configuration lookups.

Place these inside appropriate durable steps or transactions.

Investigate DBOS workflow serialization and replay requirements.

Avoid passing large customer records or unnecessary sensitive data into durable workflow arguments.

Prefer stable identifiers and retrieve the required business data within properly scoped steps.

### **Tenant-aware execution**

Design tenant-aware queue controls.

Evaluate DBOS features for:

* Global concurrency.  
* Per-process concurrency.  
* Partition concurrency.  
* Per-tenant rate limits.  
* Partitioned queue scheduling.  
* Workflow IDs and deduplication.

A noisy tenant must not starve other paying customers.

Give particular attention to expensive operations:

* AI agent execution.  
* SMS and voice.  
* Workflow fan-out.  
* Campaign execution.  
* Social publishing.

Propose reasonable initial concurrency settings, but explicitly identify which values need load testing before production.

### **Durable wait semantics**

The current workflow runner reportedly uses in-process timers for wait steps.

Investigate the actual runner implementation.

Design a DBOS approach that supports waiting through:

* Application restarts.  
* Fly Machine replacement.  
* Deployments.  
* Worker scaling.  
* Database interruptions.

Preserve the existing workflow definition language and its meaning.

Document whether the existing workflow run state can be reused or requires a migration.

Do not accidentally change how existing users' automations behave.

## **5\. Database architecture: Neon**

Design the production database arrangement.

Evaluate:

* Application database connections.  
* DBOS system database connections.  
* Pooled versus direct Neon connections.  
* Connection budgeting.  
* Database roles and privileges.  
* Schema separation.  
* Migration ordering.  
* Database backup and recovery.

Important: DBOS's official Neon integration recommends disabling connection pooling for its system database connection.

Investigate the correct connection arrangement instead of assuming one connection string works for all purposes.

Propose clearly named configuration variables, such as:

`DATABASE_URL`

`DBOS_SYSTEM_DATABASE_URL`

`SESSION_SECRET`

`ENCRYPTION_KEY`

`NODE_ENV`

`PORT`

Only include configuration that is actually necessary after inspecting the codebase.

Determine whether application data and DBOS system state should initially reside in:

1. Separate schemas in the same Neon database.  
2. Separate databases in the same Neon project.  
3. Separate Neon projects.

Explain the trade-offs.

Include a connection budget for one web machine, one or more worker machines, migrations, and administrative operations.

Investigate Neon branching for development, preview, testing, and recovery.

Design versioned, incremental application migrations.

The current migration mechanism must be inspected. If it merely reapplies an idempotent schema file, explain why this may be insufficient for a commercial production system.

## **6\. Multi-tenant SaaS architecture and business model**

We are building a commercial SaaS business, not just deploying an open-source application.

Evaluate three deployment and tenancy approaches:

### **A. Shared Fly application \+ shared Neon database**

Multiple customers share application infrastructure, with strict tenant-level logical isolation.

### **B. Shared Fly application \+ database-per-tenant**

Application infrastructure is shared, but individual tenants have separate databases or Neon projects/branches.

### **C. Dedicated Fly application \+ dedicated Neon database**

Premium customers receive dedicated deployments.

For each approach document:

* Infrastructure cost.  
* Development complexity.  
* Operational burden.  
* Tenant isolation.  
* Backup and restoration.  
* Migration complexity.  
* Scaling characteristics.  
* Customer support implications.  
* Suitability for different subscription tiers.

Recommend the best starting architecture for a pre-revenue or early-revenue SaaS business.

It should be inexpensive to operate, without creating architectural debt that makes future isolation prohibitively expensive.

### **Commercial gaps**

Explicitly determine which SaaS capabilities are already implemented and which must be built.

Investigate:

* Customer registration.  
* Organization provisioning.  
* Agency and location ownership.  
* Subscription plans.  
* Billing for access to our SaaS.  
* Usage metering.  
* Plan enforcement.  
* Resource quotas.  
* Tenant suspension and reactivation.  
* Customer onboarding.  
* Customer offboarding.  
* Data export.  
* White-label branding.  
* Custom domains.  
* Per-tenant integration credentials.

Important distinction: existing customer invoice or subscription-management features do not automatically constitute billing for our own SaaS subscriptions.

Identify this gap explicitly.

Propose the minimum commercially viable control plane without unnecessarily expanding the initial porting scope.

## **7\. Fly.io deployment architecture**

The deployment must be Fly.io-first.

Design the application around a single production container image and clearly separated process responsibilities.

Evaluate at least two configurations:

1. Web API and DBOS runtime running together.  
2. Separate web and DBOS worker processes using Fly process groups.

Recommend one and explain the reason.

The preferred architecture should support independent web and worker scaling without introducing unnecessary infrastructure.

### **Required deployment deliverables in the plan**

Specify:

* Dockerfile architecture.  
* Node.js production runtime.  
* Build strategy.  
* Runtime dependencies.  
* Production startup scripts.  
* Fly process groups.  
* `fly.toml`.  
* Internal application port.  
* Public HTTP service configuration.  
* Worker networking restrictions.  
* Health checks.  
* Readiness and liveness behavior.  
* Machine restart policies.  
* Minimum machine counts.  
* CPU and memory recommendations.  
* Deployment strategy.  
* Graceful shutdown.  
* Secret management.  
* Database migration execution.  
* Log collection.  
* Rollback procedures.

Keep the React/Vite build separate from the DBOS backend runtime.

Investigate DBOS's restriction regarding bundling its workflow registry. Do not blindly bundle DBOS through Vite, esbuild, Rollup, or another bundler.

Prefer a production build arrangement that keeps the DBOS runtime and workflow registration intact.

### **fly.toml requirements**

The goal is to make deployment extremely straightforward.

A future developer should ideally execute:

`fly deploy`

after configuring the application and secrets once.

Use Fly's native TOML configuration for:

* Process groups.  
* HTTP service.  
* Worker process.  
* Machine sizing.  
* Health checks.  
* Release command.  
* Deployment strategy.  
* Restart behavior.

Use Fly's `release_command` where appropriate for one-time database migrations.

Do not execute migrations independently on every web or worker startup.

Ensure migration failures stop deployment rather than leaving a partially upgraded application.

Investigate how application migration ordering interacts with DBOS's own system database initialization.

Do not expose the worker process as an unnecessary public HTTP service.

### **Production availability**

Determine appropriate initial policies for:

* Web API availability.  
* Worker availability.  
* Fly autostop/autostart.  
* Minimum running machines.  
* Graceful shutdown and workflow recovery.

Do not automatically disable machine autostopping everywhere without evaluating its cost and reliability implications.

Background work must not be silently delayed because all workers are stopped.

Explain the operational and financial trade-offs.

## **8\. Day 2 operations: mandatory from the outset**

Do not treat operational concerns as future enhancements.

Design the system so that one person can realistically operate it without constantly babysitting deployments and customer workflows.

### **Observability**

Define structured logging and correlation fields:

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

Avoid exposing customer secrets or sensitive data in logs.

Specify metrics for:

* HTTP latency and errors.  
* DB connection utilization.  
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

Recommend an appropriate lightweight monitoring stack.

### **Operational administration**

Design the future administrative capabilities required to:

* Search workflow executions.  
* Inspect failed workflows.  
* Review dead-letter events.  
* Retry eligible workflows.  
* Cancel workflows safely.  
* Identify tenants generating excessive load.  
* Inspect integration failures.  
* Reconcile uncertain external operations.  
* Investigate customer complaints.

Consider an operator-only administrative surface, but do not introduce unnecessary UI work in the initial migration.

### **Backups and disaster recovery**

Specify:

* Neon backup and recovery strategy.  
* Point-in-time recovery requirements.  
* Recovery point objective.  
* Recovery time objective.  
* Restore testing.  
* DBOS system-state recovery.  
* Application data consistency.  
* Secrets recovery.  
* Database migration rollback.  
* Incident procedures.

A backup that has never been restored is not a verified backup.

### **Security**

Perform a tenant-isolation threat analysis.

Investigate:

* Cross-tenant SQL access.  
* Location authorization.  
* Operator access.  
* Session and cookie security.  
* Webhook authentication.  
* Provider credentials.  
* Secret encryption and rotation.  
* DB connection privileges.  
* Workflow payload exposure.  
* Prompt injection and tool authorization.  
* Rate limiting.  
* Public booking and funnel endpoints.  
* Abuse prevention.

Distinguish security guarantees already present from new guarantees that must be implemented and tested.

## **9\. Testing and behavioral conformance**

This section is critical.

The goal is not merely to have a DBOS implementation that starts and passes a handful of new tests.

The goal is to preserve the semantics of the original implementation.

Create a traceability matrix:

Existing behavior → Existing test → Proposed DBOS implementation → New test → Acceptance criterion.

Keep the existing tests intact wherever possible.

Add a dedicated DBOS resilience test layer.

Test at minimum:

1. Workflow successfully completes.  
2. Process crashes during a workflow.  
3. Process restarts and resumes.  
4. A completed step is not repeated.  
5. An interrupted step safely retries.  
6. Duplicate workflow submissions are deduplicated.  
7. Duplicate webhook delivery is handled safely.  
8. Provider succeeds but the worker crashes before checkpoint.  
9. Transient provider failure invokes the correct retry policy.  
10. Permanent provider failure reaches the failure-handling path.  
11. Dead-letter recovery works.  
12. Tenant partitioning enforces fairness.  
13. One tenant cannot exhaust all worker capacity.  
14. Workflow wait survives deployment and restart.  
15. Cancellation behaves correctly.  
16. Workflow versions remain compatible across deployment.  
17. Tenant context cannot leak between concurrent executions.  
18. Database failure does not result in lost acknowledged business events.

Evaluate whether PGlite is suitable for DBOS integration testing.

Do not assume compatibility simply because it supports PostgreSQL-compatible SQL.

Use an actual disposable PostgreSQL environment when necessary, such as Testcontainers.

Preserve PGlite tests for the existing HTTP/domain behavior where appropriate.

Clearly separate fast unit tests from genuine PostgreSQL and DBOS integration tests.

## **10\. Migration strategy**

Design a phased migration that avoids a dangerous all-at-once replacement.

Evaluate the following sequence:

### **Phase 0: Baseline**

Repository audit, test baseline, architecture map, test inventory, and existing production behavior.

### **Phase 1: DBOS foundation**

Introduce DBOS, establish the system database, define workflow registration, prove recovery and idempotency with a minimal vertical slice.

### **Phase 2: Execution abstractions**

Separate domain operations from background orchestration and establish stable workflow identities, event contracts, and outbox requirements.

### **Phase 3: Workflow dispatch**

Migrate workflow event dispatch and execution semantics, including durable waits.

### **Phase 4: Agent execution**

Migrate agent-reply orchestration, tool execution, provider operations, retries, and approval behavior.

### **Phase 5: Operational hardening**

Implement metrics, alerts, DLQ administration, recovery procedures, secrets management, and tenant resource controls.

### **Phase 6: Fly.io production readiness**

Create the Dockerfile, process groups, TOML, release command, deployment health checks, and controlled rollback procedures.

### **Phase 7: Commercial readiness**

Address subscription gating, usage metering, tenant onboarding, cost controls, and customer support operations.

Revise these phases as necessary after examining the actual codebase.

### **Cutover and rollback**

Provide a precise pg-boss-to-DBOS transition procedure.

Address:

* Jobs pending in pg-boss.  
* Active jobs.  
* Failed jobs.  
* Dead-letter jobs.  
* Existing workflow execution state.  
* Long-running waits.  
* Duplicate events.  
* Existing run IDs.  
* Retry history.  
* Rollback to the previous execution system.

Do not allow old and new execution systems to independently execute the same customer-facing side effect.

A shadow mode must not send real customer messages or perform real external writes.

State the conditions for declaring each migration phase complete.

## **11\. Economics and profitability**

Think like a business owner responsible for gross margin.

Estimate infrastructure and operational consumption based on actual architectural choices.

Do not fabricate current Fly.io or Neon prices. Use documented pricing if researching current prices, and identify every assumption.

Separate:

* Fixed monthly infrastructure costs.  
* Variable infrastructure costs.  
* AI model expenses.  
* SMS and voice expenses.  
* Payment processing fees.  
* External integration costs.  
* Storage and data transfer.  
* Operational/support costs.

Propose a basic unit-economics model.

For example:

Revenue per tenant  
minus infrastructure allocation  
minus messaging and AI consumption  
minus external provider charges  
minus payment fees  
equals contribution margin.

Design metering so that expensive customers cannot silently become unprofitable.

Recommend initial quotas, warnings, hard limits, and upgrade paths.

The first architecture should support a profitable small customer base, not merely theoretical scaling to thousands of tenants.

## **12\. Architecture alternatives and decisions**

Do not simply validate the proposed architecture.

Challenge it.

Evaluate:

* DBOS alongside the existing pg-boss architecture.  
* Complete pg-boss replacement.  
* Single process versus separate web and worker groups.  
* Shared DB versus separate DBOS system database.  
* Shared-database versus database-per-tenant tenancy.  
* Fly single app versus dedicated app deployments.  
* PGlite versus real PostgreSQL for DBOS testing.  
* Incremental migrations versus a larger cutover.  
* Transactional outbox versus direct workflow enqueueing.

For each important decision provide:

* Options.  
* Advantages.  
* Disadvantages.  
* Failure modes.  
* Operational implications.  
* Cost implications.  
* Your recommendation.  
* Why the alternatives were rejected or deferred.

Use an architecture decision record format for decisions that materially affect future engineering work.

## **13\. Required output**

Create a detailed implementation plan in:

`docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md`

Only create this new planning document. Do not overwrite an existing file. If the path exists, choose a clearly named new version.

The document must contain:

1. Executive recommendation.  
2. Verified current architecture.  
3. Repository and test inventory.  
4. Behavioral compatibility requirements.  
5. Target architecture.  
6. DBOS workflow mapping.  
7. Tenant isolation design.  
8. Neon database architecture.  
9. Fly.io deployment architecture.  
10. Dockerfile and `fly.toml` design.  
11. Migration and cutover strategy.  
12. Testing and acceptance criteria.  
13. Observability and Day 2 operations.  
14. Security and disaster recovery.  
15. Commercial SaaS capabilities.  
16. Cost and profitability analysis.  
17. Phased implementation roadmap.  
18. Risks, unresolved questions, and architectural decisions.

Include source file paths and actual symbols to support all repository-specific conclusions.

Provide Mermaid architecture and deployment diagrams where they materially improve understanding.

Include a proposed directory structure and a proposed configuration/secrets inventory.

Include a deployment acceptance checklist and a production-readiness checklist.

Provide realistic estimates of complexity, sequencing, dependencies, and risk. Do not invent precise delivery dates.

Clearly label:

* Verified facts.  
* Assumptions.  
* Recommendations.  
* Unresolved questions.  
* Proposed changes.

Reference official DBOS, Neon, and Fly.io documentation for framework-specific claims. Verify that the proposed DBOS APIs exist in the SDK version you recommend.

## **14\. Strict working rules**

This is a planning assignment, not an implementation assignment.

* Do not modify application source files.  
* Do not modify the database schema.  
* Do not install or upgrade dependencies.  
* Do not deploy anything.  
* Do not create or alter Fly.io applications.  
* Do not create or alter Neon databases or branches.  
* Do not execute destructive commands.  
* Do not expose credentials or secret values.  
* Do not commit changes.  
* Do not silently alter existing business behavior.  
* Do not invent implementation details.  
* Do not claim tests pass unless they were actually executed.

You may read files, inspect Git history, run non-destructive tests, and consult official documentation.

At the end, report:

1. Which files and tests you inspected.  
2. Which tests you actually executed and their results.  
3. Which architectural decisions are sufficiently supported by evidence.  
4. Which decisions need human approval.  
5. Which risks could prevent the architecture from being production-ready.  
6. The location of the implementation plan.

## **Final architectural standard**

I am not looking for the shortest path to a working deployment.

I am looking for the smallest, most reliable architecture that can support a paying multi-tenant SaaS business without requiring a dedicated DevOps engineer.

The system must be easy to deploy, easy to understand, easy to recover, inexpensive to operate, and difficult to misuse.

Preserve existing proven behavior. Improve execution reliability. Minimize operational moving parts.

**A successful plan must demonstrate not just how to deploy OpenLevel, but how to operate it profitably and safely after the first customer pays.**

## **A few architectural judgments to retain**

These are the things I will scrutinize particularly hard when you bring Muse's plan back.

**1\. Separate the API from background execution.**

Your current public code starts pg-boss, registers its workers, and serves Hono from the same bootstrap process. That is a concrete coupling we should address.

GitHub+1

I favor two Fly process groups sharing one image, provided the chosen DBOS integration supports the separation correctly. The API should not become unresponsive because several tenants are simultaneously running expensive agent workflows.

**2\. Do not confuse durable execution with reliable business transactions.**

For example, consider an inbound message:

* Chatwoot sends a webhook.  
* OpenLevel persists the message.  
* OpenLevel starts an AI reply workflow.  
* The AI calls the model.  
* The agent decides to send an SMS.  
* The provider accepts the SMS.  
* The worker crashes before recording the completed step.

The recovery design must handle this situation without sending a duplicate SMS.

**3\. Introduce SaaS economics before introducing unnecessary infrastructure.**

One shared Fly deployment and one Neon project are sensible starting assumptions. Dedicated tenant infrastructure should become a premium offering when customers and margins justify it.

I would not build database-per-tenant provisioning or a distributed control plane before you have actual demand.

**4\. Fly TOML must represent the operating architecture, not merely the HTTP server.**

Fly supports process groups, separate service configuration, health checks, and release commands. Its release command executes once per deployment attempt and can prevent a release when migrations fail.

Fly Docs+1

We should make deployment repeatable and predictable rather than relying on undocumented manual steps.

## **What I need from Muse later**

When you return with its implementation plan, I will conduct an adversarial architectural review with special attention to:

* Whether every existing business behavior has an implementation and test mapping.  
* Whether DBOS actually solves the current execution problems.  
* Whether the workflow migration introduces hidden duplicate-side-effect risks.  
* Whether the Neon connection architecture is sound.  
* Whether Fly deployments preserve in-flight workflow compatibility.  
* Whether tenant-level isolation and cost controls are enforceable.  
* Whether the proposed design is genuinely economical for a small SaaS operator.

**No additional clarification is required before running this prompt.** Muse can discover the local repository state and explicitly record unresolved business decisions rather than guessing.

One important observation: the public README and the current public package/source files do not perfectly agree on the implementation details. The latter currently show Node 22, Hono, `pg`, pg-boss, and Vitest. That is another reason the local checkout and executable tests must take precedence over the DeepWiki assessment.

GitHub+2

Bring me the resulting Markdown plan, and we will review it as though we were approving a production architecture before committing engineering resources.

