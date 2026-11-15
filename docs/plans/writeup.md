# OpenLevel: Building an Open-Source Alternative to GoHighLevel

## Technical strategy, architecture decisions, operational trade-offs, and roadmap

**Architecture position:** November 14, 2026  
**Audience:** software engineers, platform and DevOps operators, SaaS founders, agency owners, and GoHighLevel users evaluating a self-hosted/open-source alternative  
**Status:** V2.1 architecture is the current design baseline; Phase 0 execution is authorized to begin but its proof gates have not yet been run.

---

## Executive summary

OpenLevel is being developed into a multi-tenant agency operating platform inspired by the breadth of GoHighLevel (GHL): lead capture, CRM, conversations, appointment booking, follow-up automation, AI-assisted engagement, and reusable agency configurations. The ambition is not to reproduce every GHL feature before launch. It is to turn an existing, broad codebase into a dependable product that a small team can deploy, operate, support, and sell.

The principal technical decision is to use **DBOS for durable workflow execution, Fly.io for application and worker deployment, and Neon Postgres as the shared persistence layer**. The decision is driven by a specific operational problem: an automation platform cannot treat important business processes as disposable background jobs. A lead response, appointment sequence, AI-assisted conversation, billing transition, or outbound message may span minutes or days, cross multiple services, and be interrupted by a deployment, process crash, database interruption, or provider timeout. These processes need a durable record of what happened and a safe way to continue.

DBOS is a Postgres-backed durable-workflow library. It checkpoints workflow inputs and step results in Postgres and can recover interrupted workflows from their last completed step. It does not require a separate orchestration server for its basic runtime. That makes it a natural candidate for a Fly + Neon deployment where Postgres is already the system of record. The application will use a deliberately small topology: one Fly application and image, separate `web` and `worker` process groups, two initial web Machines, one initial worker Machine, and one Neon database with distinct `app` and `dbos` schemas. The web process will use `DBOSClient` to enqueue work; only the worker process will run the DBOS executor.

This design deliberately avoids running two competing job engines, adding a custom outbox pump, creating a custom dead-letter queue and administration system, or introducing a second database solely for orchestration. It also accepts a known limitation: with one worker and no high-availability control plane, background execution has a short availability window during worker replacement. The initial design prefers operational simplicity and a strong recovery proof over premature multi-worker infrastructure.

**The architecture is design-complete enough to prototype, not yet proven in execution.** The current Phase 0 directive requires a real PostgreSQL proof of atomic enqueue and duplicate convergence (P1), a staging Fly proof of worker replacement without overlapping executors or blind external retries (P2), and fault-injection proof of wallet/provider-attempt safety (P3). Typecheck and test baselines must also be run and recorded. Until these pass, the DBOS cutover and later product phases remain gated.

---

## 1. Product intent: an alternative to GHL, not a parity clone

The intended customer is an agency or operator managing lead-driven local businesses. These users may currently combine GHL with spreadsheets, messaging providers, booking tools, and manual follow-up. OpenLevel aims to consolidate the most valuable operational loop while allowing the operator to deploy and control the system.

The current V2.1 recommendation is a narrow beachhead: **residential roofing contractors in the US Sun Belt, typically with two to ten crews**, buying speed-to-lead. The core workflow is:

1. A storm, restoration, referral, or web lead arrives.
2. The platform responds quickly through the configured messaging channel.
3. The lead is qualified and routed to the right location or team.
4. An inspection is booked.
5. Follow-up continues until the lead converts, declines, or becomes inactive.
6. AI assists with drafts and bounded agent actions, with approval-first behavior in the pilot.

The commercial rationale is that first-response time and booked inspections are measurable outcomes. The initial wedge can reuse OpenLevel's existing forms, contacts, inbox, booking, and automation concepts without requiring a customer to migrate every aspect of their business on day one.

Real-estate investor lead buyers remain an alternative beachhead because that market appears in the repository's existing seed context. That is not proof of demand. The owner must choose the first vertical before acquisition spending or geography-specific commitments.

### 1.1 Initial product boundary

The canonical V2.1 disposition is by capability row, not by broad product category:

| Capability | Launch disposition | Reason |
|---|---|---|
| Lead capture, forms, funnels, CRM, conversations, booking, landing pages | Retain and harden | These form the speed-to-lead journey |
| Campaigns, automation, AI replies, voice/calls | Improve selectively | Useful, but outbound actions require durable execution, metering, and safety controls |
| Reviews, social, affiliates, analytics | Defer | Retain code where useful, but do not promote as launch requirements |
| Courses and communities | Retire from launch scope | Product breadth without clear value to the initial wedge |
| Snapshots and templates | Add as a distribution asset | Let agencies reuse and export working automation configurations |

The first seven user journeys are capture, CRM, inbox, booking, follow-up automation, AI engagement, and snapshot reuse. These journeys are distinct from the capability-row count.

The product is **not** promising GHL parity, a full visual workflow builder, a database per tenant, multi-region deployment, or a custom operations console before there is a clear need. Workflow definitions and snapshots are intended to provide a simpler first path than recreating every GHL visual-building capability.

### 1.2 Pilot hypothesis, not validated pricing

The proposed pilot is a 30-day paid engagement at **$199–$399 per month plus prepaid AI credits**. The initial scope is one sub-account, speed-to-lead automation, approve-first AI drafts, and a weekly outcome report. White-labeling, public API access, and additional seats are outside the first pilot offer.

The willingness-to-pay test is ten paid pilots at a stated price. Surveys and expressions of interest are not sufficient evidence. Referral, niche-community, and direct-outbound experiments are hypotheses with explicit conversion thresholds; they should be retired or revised when measured results miss those thresholds.

For a GHL user, this means OpenLevel should be evaluated as a focused, self-hosted platform with a narrower launch promise—not as a drop-in replacement for every existing GHL workflow, integration, support service, or marketplace feature.

---

## 2. What exists today, and why reliability became the architectural priority

The V2.1 repository assessment was made against `master` at commit `2634f8cd0eaccfdc9d589fad3fc967fd1b3ba0bb` on November 14, 2026. It recorded:

- 228 non-test TypeScript files.
- 182 test files.
- 230 observed endpoint registrations from a fixed-string enumeration of route method literals. This is a reproducible count from that search method, not a parser-proven count of unique API operations.
- 58 `CREATE TABLE` declarations in `db/schema.sql`.
- No test files found by the narrowly described search for the PostgreSQL `Pool` and application database wrapper. That search does not prove that no other PostgreSQL client appears in tests.
- No executed-test evidence in the V2.1 assessment. It was a source-inspection pass without a Node.js toolchain or `node_modules`.

These counts establish that OpenLevel is not a blank-slate demo. They do **not** establish that every route is production-ready, that tests pass, or that the system has been load-tested.

The architecture review also identified several reliability gaps in the existing implementation. The relevant findings include in-process `setTimeout`/`unref` waits in the workflow runner, workflow actions that log SMS/email intentions rather than performing real sends, outbound Chatwoot delivery occurring before database persistence, a Chatwoot webhook deduplication/enqueue gap, a Square idempotency key with a random suffix, and a missing Stripe idempotency header in the inspected path. These are source-inspection findings, not production incident reports.

The common problem is the boundary between an application decision and an external effect. A process may die after it records that it intends to send something but before it can tell whether the provider accepted the request. A delayed workflow may disappear when its process restarts. A webhook may be delivered more than once. A provider may accept a charge or message while the caller times out before receiving confirmation.

For an agency platform, these are not merely engineering inconveniences. They can create duplicate messages, missed leads, missed appointments, unexpected AI spend, billing disputes, and manual support work. Reliability is therefore part of the product and its unit economics.

---

## 3. Why DBOS is the chosen workflow engine

### 3.1 The job is durable execution, not just queueing

A conventional job queue is useful for scheduling and distributing background tasks. OpenLevel needs that, but it also needs to preserve the progress of a business process across restarts and deployments.

Consider a lead journey that responds to a form submission, waits for a reply, classifies the response, asks a follow-up question, books an appointment, and schedules later reminders. A queue can start each task and retry failed jobs. The application still has to define how those jobs relate, how progress is persisted, how delayed work is resumed, how a process replacement is handled, and how a repeated webhook is prevented from creating a second journey.

DBOS provides a workflow model in which a program is divided into durable steps. Workflow inputs and step outputs are checkpointed in Postgres. When a process is interrupted, DBOS can replay the workflow using its stored checkpoints and continue from the last completed step. The workflow code must be deterministic: external calls, current-time reads, random values, and database operations belong inside steps rather than in uncheckpointed workflow control flow. Workflow inputs and outputs must be serializable. A step that has completed and been checkpointed is not re-executed during ordinary recovery; an interrupted step may be retried. [DBOS architecture](https://docs.dbos.dev/architecture) · [TypeScript workflow tutorial](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)

This maps well to OpenLevel's use cases: long-running follow-up sequences, agent turns, campaigns, booking flows, onboarding, and provider interactions that must survive process replacement.

### 3.2 Why DBOS rather than extending pg-boss

The current codebase already contains pg-boss. The decision is not that pg-boss is defective or that it cannot run useful production workloads. pg-boss provides queue processing, retries, scheduling, delayed jobs, and singleton-style controls. The question is whether it is the right foundation for the specific durability requirements now being prioritized.

The V2.1 evaluation prefers DBOS because it brings together:

- **Checkpointed workflow recovery:** step progress is stored in Postgres, reducing the custom machinery needed to resume a multi-step process.
- **Durable delayed continuations:** a customer journey can wait for a future time without depending on a process-local timer.
- **Workflow versioning and patching:** durable histories create compatibility obligations when workflow code changes; DBOS has workflow patching/recovery concepts that the application can use deliberately.
- **Queue controls and tenant partitioning:** queue limits can apply globally, per worker, and per partition. A location can be used as a partition key so one noisy tenant is less able to monopolize shared execution capacity. [DBOS queue reference](https://docs.dbos.dev/typescript/reference/queues)
- **A single Postgres-backed orchestration model:** the workflow state is stored in the database OpenLevel already needs, rather than in a separate orchestration service.

The comparison in V2.1 did not find a documented pg-boss partition-key primitive with the same per-partition concurrency and rate-limit model. With pg-boss, comparable fairness would need additional application logic, queue sharding, or manual caps. That is an operational trade-off, not a claim that pg-boss can never be made fair.

The chosen direction is therefore **DBOS-only for the new durable workflow path**, with no new hybrid runtime, outbox pump, custom dead-letter subsystem, or custom admin interface in the first release. Existing pg-boss paths are not to be removed merely because the design has selected DBOS. They remain untouched until Phase 0 proof, migration decisions, and the required owner confirmation are complete.

### 3.3 DBOS does not make external side effects exactly-once

This is the most important qualification in the design.

DBOS can durably record that a step completed. It cannot make an arbitrary third-party HTTP call and a Postgres transaction commit as one atomic operation. Suppose Twilio accepts a message, but the worker loses its connection before recording the provider response. On recovery, the system may not know whether the message was accepted. Repeating the request may send a duplicate; refusing to repeat may mean the user does not receive the message if the original request never arrived.

The design must therefore distinguish **workflow recovery** from **provider idempotency**. DBOS protects the sequence and checkpointed progress. OpenLevel's operation/attempt records protect the boundary with external systems. Provider-specific idempotency keys are used where documented and supported. Where the provider cannot safely deduplicate or reconcile, an uncertain attempt is quarantined for reconciliation rather than blindly retried.

The system will not advertise unqualified “exactly once” delivery of external messages or calls. It will make narrower claims based on the provider's actual guarantees and the application's own records.

### 3.4 Why DBOS fits the Fly + Neon topology

DBOS is a library embedded in the application and stores workflow state in Postgres. Its basic architecture does not require a separate orchestration server. In a distributed deployment, the executors share a Postgres system database; a separate API service can manage work through `DBOSClient`. DBOS recommends a control plane such as Conductor for high availability and cluster-wide recovery in multi-executor deployments. [DBOS architecture](https://docs.dbos.dev/architecture)

That leads to a simple division of responsibilities:

- The **Hono web process** authenticates the request, validates tenant context, writes the business event and related domain changes, and uses `DBOSClient` to enqueue the workflow.
- The **DBOS worker process** owns workflow execution, durable waits, provider adapters, and recovery.
- **Neon Postgres** stores both the business application state and the DBOS system state, in separate schemas.
- **Fly.io** runs the web and worker processes as separate process groups in one Fly app, using one built image but independent Machines and scaling controls.

The web application does not need to run the DBOS executor. DBOS documents `DBOSClient` for programmatic interaction with an application, including enqueueing and inspecting workflows. [DBOS Client reference](https://docs.dbos.dev/typescript/reference/client)

---

## 4. Atomic enqueue: preventing a business event from being separated from its workflow

A critical failure mode in automation platforms is a split-brain event: the application commits a lead or booking update but fails before its follow-up workflow is enqueued, or enqueues work for a domain change that later rolls back.

The selected solution is a **transactional business-event gate** using `enqueueInTransaction`.

The intended sequence is:

1. Derive a stable idempotency key from authenticated event context. Do not trust tenant identifiers supplied only in an untrusted webhook payload.
2. Begin a transaction on the DBOS system database.
3. Insert a `business_event` row using a unique event key and `ON CONFLICT DO NOTHING RETURNING`.
4. If this is the first accepted event, perform the associated business mutation and enqueue the workflow with a stable workflow ID using `enqueueInTransaction` on the same database transaction.
5. If the event already exists with the same payload hash, return the stored workflow/event status rather than creating new work.
6. If the same key is presented with a different payload hash, return HTTP `409 Conflict`, record the discrepancy, and do not mutate or enqueue.
7. Commit. If any operation fails, roll back the domain mutation, event row, and workflow enqueue together.

The official TypeScript client reference confirms that `enqueueInTransaction` performs the enqueue write inside a caller-owned transaction, so the enqueue and the caller's database writes commit or roll back together. The client passed to it must be connected to the DBOS system database. It does not create, commit, roll back, or retry the transaction for the caller. The method does not support `duplicationPolicy: 'return-existing'`. [DBOS Client reference](https://docs.dbos.dev/typescript/reference/client)

This is why the design uses one Neon database rather than putting application records and DBOS system state in unrelated databases: the business mutation and workflow enqueue need to share a transaction boundary.

### 4.1 Why the event record must outlive DBOS workflow history

DBOS workflow history has its own retention policy. The application's idempotency contract has a different purpose and may need to last longer. A duplicate webhook can arrive after DBOS history has been pruned. Therefore the application keeps a compact event projection or tombstone containing the stable key, payload hash, tenant context, workflow ID, accepted time, last-known status, and result reference or terminal response.

If DBOS history is still present, the application may query it for current status. If that history has been pruned, the durable application projection remains authoritative for duplicate convergence. If DBOS history is unexpectedly missing before the application retention window expires and there is no usable projection, the handler should alert and fail closed; it must not silently create another workflow.

The exact SDK version and the `workflowIDReusePolicy` option remain a Phase 0 compile/runtime gate. The public documentation prose and displayed TypeScript interface have not been perfectly aligned. The implementation must use the exact pinned package types, with no unsafe cast and no fallback to plain `enqueue()` as a substitute for transactional atomicity.

---

## 5. Target deployment: Fly.io + Neon Postgres

### 5.1 One Fly app, one image, two process groups

The V2.1 topology uses one Fly application and one image with two process groups:

| Process group | Initial shape | Responsibility |
|---|---|---|
| `web` | Two Machines, initially 1x CPU / 512 MB each | Hono HTTP API, authentication, reads, request validation, `DBOSClient`, transactional enqueue |
| `worker` | One Machine, initially 1x CPU / 1 GB | DBOS runtime, queue polling, durable workflows, provider adapters, recovery |

Fly process groups let one application run different commands in separate Machines, with resources and scale controlled per group. [Fly process groups](https://fly.io/docs/launch/processes/)

The single-image approach reduces build and release complexity. The web and worker are separated because their runtime responsibilities differ: web instances handle customer traffic; the worker owns the DBOS executor and long-lived background work. They can be scaled independently when measurements justify it.

These Machine sizes are starting assumptions from the architecture plan, not load-test results. The deployment region is also unresolved. It must be chosen after the first pilot geography is confirmed, then paired with the nearest suitable Neon region. The earlier default of `iad` is not treated as market evidence. Singapore is not selected unless a Southeast Asia pilot justifies it.

### 5.2 The worker identity and replacement problem

The initial plan uses one DBOS worker with the fixed identity `DBOS__VMID=worker-1`. This identity is set only by the worker boot wrapper, not globally for the whole Fly app. The wrapper validates the configuration and fails closed if the DBOS system database is unavailable.

Why be strict about identity? The worker identity is part of the recovery model. The goal is for the replacement worker to recover work associated with the same executor identity after the previous Machine is stopped or replaced. Starting two active executors with the same identity is not an acceptable deployment state unless the DBOS recovery/fencing behavior has been proven for that exact configuration.

The deployment policy is rolling, with one-at-a-time replacement semantics. The worker is not configured for canary or blue-green deployment because those patterns can temporarily place old and new workers side by side. Fly's configuration reference documents the rolling strategy and `max_unavailable`; for a one-Machine worker group, the architecture adds an explicit operator-verified stop/start procedure rather than treating a config setting as a complete concurrency proof. [Fly deployment configuration](https://fly.io/docs/reference/configuration/)

The expected sequence is:

1. Stop dequeueing and begin graceful shutdown on `SIGTERM`.
2. Let bounded in-flight steps reach safe points; persist uncertain provider attempts.
3. Close database pools and exit within the configured 120-second shutdown timeout.
4. Confirm the old worker Machine is actually stopped.
5. Start the replacement with the same worker identity.
6. Confirm DBOS connectivity, readiness/heartbeat, and recovery of pending workflows.
7. Declare the worker healthy only after those checks pass.

A recent Fly operational note reinforces why a worker needs a real readiness check: without health checks, a worker Machine may be considered deployed after running for a short period without crash-looping, even if it is not actually ready to process work. The note also describes how deployment pacing affects database connection pressure. [Fly changelog, November 5, 2026](https://fly.io/changelog/reducing-deploy-and-dashboard-failures/)

The architecture intentionally does **not** add a Postgres advisory-lock fencing service up front. Such a mechanism would add another operational state machine and would itself need a safe failure model. The plan is to prove the Fly replacement behavior in staging first. If the test demonstrates overlapping `worker-1` executors, the fencing design must be revisited using that evidence.

### 5.3 Neon: one database, two schemas, explicit connection roles

The selected database layout is one Neon Postgres database with two schemas:

- `app`: OpenLevel business data, tenant records, events, ledgers, provider attempts, and domain state.
- `dbos`: DBOS workflow, step, queue, and execution metadata.

The database is both the application's source of truth and the DBOS system database. This is not just a hosting convenience. It allows a single Postgres transaction to persist the business event and enqueue the corresponding DBOS workflow.

The V2.1 connection plan separates pooled and direct connections rather than routing every connection through one endpoint:

| Pool | Endpoint | Planned maximum |
|---|---|---:|
| Hono application reads | Neon pooled endpoint | 10 per web Machine; 20 total |
| Web transaction connection for `enqueueInTransaction` | Direct endpoint | 2 per web Machine; 4 total |
| Web `DBOSClient` pool | Direct endpoint | 4 per web Machine; 8 total |
| Worker DBOS system pool | Direct endpoint | 10 |
| Worker datasource pool | Direct endpoint | 8 |
| One-shot migrator/admin connections | Direct endpoint | 3 |
| **Planned peak** | | **33 direct + 20 pooled** |

The connection budget is an allocation target, not an observed production measurement. At provisioning, the operator must run `SHOW max_connections`, inspect actual connection use, and confirm that the planned peak direct usage remains below the V2.1 headroom rule of 70% of the provisioned compute's limit.

Neon uses PgBouncer in transaction mode for pooled connections. That is useful for web traffic with many concurrent, relatively short transactions, but pooled connections do not preserve session state. Features such as session-level `SET`, `LISTEN`/`NOTIFY`, and session-level advisory locks are not supported through the transaction pool. Migrations and operations requiring session semantics should use a direct endpoint. [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)

This is why the plan gives the web read pool a pooled endpoint while the DBOS system connection, transactional enqueue, worker datasource, and migration operations use explicit direct connection budgets. Pool size and connection-acquisition timeouts must be bounded; overload should produce a visible retryable failure, not silent request loss.

Production scale-to-zero is disabled in the current design because the DBOS worker and customer workflows are expected to be continuously available for execution. Whether the chosen Neon compute size is economically optimal remains a measurement and purchase-time decision.

### 5.4 Migrations and database privileges

The architecture specifies `dbmate` as the migration tool, invoked through Fly's release process. The intended order is application migrations, DBOS schema setup, then a version assertion. The migrator owns DDL; the application runtime receives explicit DML permissions for its required tables and DBOS runtime tables; a read-only role is reserved for metrics and operator inspection.

The first version accepts one shared runtime role for web and worker as a deliberate simplification at small-team scale. That is a documented security trade-off: a compromise of either runtime has the DML permissions of the other. Role separation becomes more important as the team, compliance requirements, or worker topology grows. Broad schema-wide grants and runtime DDL permissions are not part of the intended design.

---

## 6. Tenant isolation and agency structure

OpenLevel's product model is moving from a loose location-centric application toward an agency/sub-account model:

- `agencies` and `agency_members` represent the customer organization and its users.
- `locations.agency_id` ties a sub-account to its owning agency.
- The agency owns billing, wallet, branding, snapshots, and agency-wide entitlements.
- Each location owns its operational contacts, conversations, calendars, pipelines, provider links, and location-level quotas.
- Workflow arguments carry both `agency_id` and `location_id`, which are validated against authenticated server-side context.
- `location_id` is the DBOS queue partition key; agency-level caps apply as a second limiter.

This supports the commercial model of an agency managing several business sub-accounts without immediately introducing one database per tenant. It also makes the tenant boundary explicit in workflows, not just in HTTP middleware.

Row-level security (RLS) is **deferred**. V2.1 does not claim that the full mix of ordinary application connections, DBOS transactional datasource calls, worker connections, and Neon pooled connections has been proven compatible with the intended RLS policies. RLS is not enabled for the pilot. A later RLS pilot requires official compatibility evidence, explicit privileged-role bypass documentation, and cross-connection tests. Until then, validated tenant context and negative cross-tenant tests are mandatory.

A related operational detail: DBOS partitioned queues require a partition key on every enqueue. The DBOS documentation warns that a workflow enqueued without a key on a partitioned queue remains enqueued and is not dequeued. The application must therefore reject a missing tenant/location partition key before enqueueing; it must not assume the queue engine will fail loudly on its own. [DBOS queue reference](https://docs.dbos.dev/typescript/reference/queues)

---

## 7. Durable workflows, waits, and fair scheduling

### 7.1 Replace process-local waits with durable continuations

Customer-facing journeys often wait for a future event or time: a reply, a booking reminder, a follow-up interval, a campaign segment, or a qualification window. A timer inside one Node.js process cannot be the authoritative record of a wait because the process can be replaced.

The design uses DBOS delayed workflows/continuations for customer waits. A separate journey record contains the business context: journey ID, location/contact IDs, workflow ID, definition version, current segment position, `due_at`, state, consent snapshot reference, and continuation workflow ID. This lets the application cancel, reschedule, expire, or resume the business journey deliberately.

The fixed “short sleep only” rule from an earlier draft was removed. The current principle is clearer: customer-facing waits use durable continuations; `DBOS.sleep()` is reserved for short operational pauses such as pacing a batch or backing off briefly. A 90-day maximum journey delay remains an assumption to enforce and later validate, not a measured platform limit.

### 7.2 Tenant fairness and queue capacity

DBOS queues support global concurrency, per-worker concurrency, rate limits, and per-partition concurrency/rate limits. This matters in a shared SaaS: one agency's large campaign should not consume the entire worker and leave unrelated customers waiting. [DBOS queue reference](https://docs.dbos.dev/typescript/reference/queues)

The initial concurrency numbers are intentionally unconfigured. The plan derives each limit from the tightest applicable constraint:

`queue limit = min(memory bound, database-connection bound, provider-RPM bound, tenant-entitlement bound)`

Measurements include backlog age, queue wait, task duration, retry frequency, provider saturation, and database pool wait. The Phase 0 plan also converts a provider requests-per-minute limit into an estimated in-flight concurrency using Little's Law:

`estimated in-flight concurrency = requests per minute × average request duration in seconds ÷ 60`

This is a planning estimate, not a substitute for measuring bursts, latency distributions, provider-specific concurrency caps, and retry traffic. The implementation should record the assumptions and use observed peak rates and durations before lifting limits.

---

## 8. Provider operations, idempotency, and AI wallet safety

### 8.1 Model a business operation separately from each provider attempt

The design creates one stable `operation_id` for each business intention: an AI turn, outbound message, payment, or other irreversible action. Each operation can have multiple attempt records. An attempt stores its sequence, provider, request fingerprint, idempotency key when supported, timestamps, provider request/object IDs, usage, and outcome.

The attempt lifecycle is:

`prepared → dispatching → succeeded | failed | uncertain`

During recovery, the system inspects the persisted attempt first. A `dispatching` attempt whose lease expired, with no proof that the provider did not receive it, becomes `uncertain`. It is quarantined; the system does not automatically call the provider again. Only a failure that is known to have occurred before provider contact can be retried automatically, and that retry consumes the run's attempt budget.

Provider capabilities differ. The V2.1 matrix records provider idempotency support where documented and classifies other integrations as requiring reconciliation or quarantine. Stripe and Square support idempotency keys in their relevant APIs; Twilio message sending does not provide a general send idempotency key and relies on callback/provider identifiers for reconciliation; other providers have different key semantics or none documented in the reviewed source set. These provider details must be rechecked against the exact API and integration version when each adapter is implemented. There is no universal exactly-once guarantee across all providers.

### 8.2 Wallet reservations, spend limits, and crash recovery

The platform plans to meter AI usage through a prepaid wallet. The wallet is not an afterthought; it is a hard boundary that keeps variable costs visible and bounded.

Reservation states are:

`reserved → settled | refunded | expired`

Each workflow run or AI turn has limits for:

- maximum USD spend, represented as integer micro-units;
- maximum input tokens;
- maximum output tokens;
- maximum provider attempts;
- pricing derived from a versioned model-price table.

The system reserves budget before dispatch. A known successful operation settles actual usage. A provably undispatched operation can be released/refunded. An unknown provider outcome consumes attempt budget and remains quarantined until reconciled. The sweeper is planned at a provisional five-minute cadence and uses row locking (`FOR UPDATE SKIP LOCKED`) to process safe cases. It must never refund an operation merely because the worker stopped or a timeout elapsed.

Wallet row locks are held only during short reserve/settle transactions, never while waiting on an LLM or messaging provider. Concurrent turns racing for the same remaining balance must serialize so that the wallet cannot become negative.

The four required crash tests cover: crash after reserve but before dispatch; crash after durable dispatching state while provider outcome is unknown; provider acceptance followed by crash before settlement; and crash after settlement but before workflow completion. The tests must assert provider-side charge/call counts, operation IDs, attempt states, unique settlement keys, and final wallet balance—not just that a test process exited without error.

### 8.3 Consent and message safety

Before every irreversible send, including BYO messaging, the application must verify consent on file, opt-out/DND status, quiet hours in the contact's timezone, sender authorization for the tenant, and duplicate suppression using the operation ID. The decision and timestamps must be stored as evidence.

Provider credentials are encrypted at rest with key identifiers and rotation support. The intended trust boundary is that worker/provider-adapter paths decrypt credentials for outbound calls. The web OAuth callback encrypts and stores credentials without exposing plaintext to general application paths. A narrow OAuth-refresh exception may transiently decrypt inside the refresh handler when a provider requires a secret in the refresh request; the plaintext must not be cached outside that short-lived path and access must be audited.

---

## 9. Operational model and Day-2 responsibilities

The initial target is a small team operating a small number of services. The intended Day-2 model is deliberately plain:

- one Fly app and deployment image;
- two process groups (`web`, `worker`);
- one Neon Postgres database;
- one database dashboard/metrics path;
- one DBOS worker identity at launch;
- explicit migration, deployment, and recovery runbooks;
- provider and wallet attempt records that explain what happened.

The operator must be able to answer: Is the web API healthy? Is the worker actually connected to the DBOS system database and consuming queues? How old is the oldest queued workflow? Are workflows delayed, stuck, or failing? Are provider attempts uncertain? Are AI reservations stuck or quarantined? Is the database connection budget approaching its limit? Are one or two tenants consuming a disproportionate share of worker capacity?

A web `/health` endpoint is not a worker readiness check. The worker needs its own readiness/heartbeat signal. V2.1 proposes a heartbeat every 30 seconds and an initial stale threshold above three minutes; these thresholds remain provisional until staging proves their suitability.

Workflow operations need a conservative recovery policy. At launch, the operator may inspect and resume a transiently failed workflow after the cause is fixed, fork from an appropriate step when old code/history cannot be safely replayed, or cancel and notify the tenant. Rewind is not part of the launch runbook because no datasource-specific rewind procedure has yet been tested.

Logs and metrics should carry stable identifiers: agency/location, business event, workflow, operation, attempt, provider, and outcome. This is necessary for support: an agency owner reporting “the lead never got a message” should be traceable from the original form/webhook through the workflow, operation, attempt, provider response, and final customer-facing state.

---

## 10. Economics: the database and the workflow engine are part of unit cost

DBOS simplifies recovery by persisting workflow state. That durability has a cost: workflow and step checkpoints create Postgres writes and retained data. DBOS's architecture documentation describes one database write per step checkpoint, plus additional writes for the workflow input and final workflow outcome. Large step outputs also increase write volume, which is why steps should return small metadata or object-store references rather than entire documents or media files. [DBOS architecture](https://docs.dbos.dev/architecture)

V2.1 includes an illustrative unit-economics model, not a validated forecast. It uses a provisional subscription anchor around $249/month, estimated AI usage, placeholder infrastructure costs, and assumed support time. The fixed-stack estimate is approximately $45–$100/month before Conductor and other scale-dependent items. It models workflow checkpoint volume using an assumed average of ten checkpoints per execution. None of these assumptions has been confirmed by pilot usage or measured production telemetry.

The important commercial conclusions are more durable than the placeholder arithmetic:

1. A prepaid AI wallet and hard caps are required from the beginning.
2. AI cost is not simply an average-turn cost; the usage tail matters. A high-volume customer using a more expensive model can consume the margin of a flat subscription.
3. SMS, email, and voice provider costs should be BYO in the initial offer, with managed messaging considered later only after the liability, pricing, and support model is approved.
4. Support time, customer acquisition cost, churn, payment fees, egress, branch usage, database scaling, and a future Conductor subscription must be measured before declaring a price profitable.
5. “Usage margin” in the current economics draft should be called “usage revenue” where it is an amount collected from customers. Stripe fee calculations should state precisely which billable amounts they include.

The wallet makes unprofitable usage visible and stoppable. It does not, by itself, guarantee a profitable company.

---

## 11. Deliberate limitations and risks

### 11.1 One worker is simple, not highly available

A single worker is the cheapest and easiest topology to understand, but it is a single execution capacity point. During replacement, the web layer can continue accepting and transactionally enqueueing work, but background execution pauses until the worker returns. That short pause is an accepted early trade-off, not a claim of zero downtime.

DBOS recommends Conductor for high availability and coordinated recovery in distributed deployments. V2.1 defers Conductor and a second worker until an evidence-based trigger, such as a second worker requirement or roughly one million checkpoints per month. That trigger is a planning threshold, not a performance guarantee. If the business needs continuous processing during worker replacement, the architecture must add and prove a high-availability recovery mechanism before making that promise.

### 11.2 Neon is both application storage and orchestration state

This is architecturally economical because the same Postgres transaction can write the business event and enqueue its workflow. It also concentrates dependency: a Neon outage affects both business persistence and durable enqueue/execution. During an outage, DB-backed reads, writes, and enqueues should fail visibly with retryable errors. “Degraded reads” means cached or static information only, not pretending the database is available.

### 11.3 Workflow code changes are compatibility changes

A running workflow may have checkpointed some steps under an older application version. Adding, removing, reordering, or conditionally changing durable steps may make an old execution unsafe to replay. The versioning policy distinguishes changes that need no patch, changes that need a DBOS patch while old paths remain available, and incompatible changes that need a new workflow/version. Helper-function edits are not automatically safe: if they alter durable operations or the meaning of replayed step results, they are workflow compatibility changes.

Every workflow change requires review and a recovery test. Application releases must preserve compatibility for any workflow histories that may still resume.

### 11.4 RLS and role separation are not launch claims

The initial release relies on explicit application-level tenant validation and negative cross-tenant tests. RLS remains deferred until compatibility with all relevant pooled/direct/worker/datasource access patterns is proven. The initial shared runtime role is also an accepted small-team simplification, not the final security architecture for every scale or compliance regime.

### 11.5 Self-hosting transfers operational responsibility

An open-source/self-hosted alternative gives an operator more control over infrastructure, data, integrations, and deployment choices. It also means the operator owns upgrades, secrets, backups, incident response, provider credentials, DNS/domains, email/SMS configuration, deliverability, database sizing, and recovery drills. OpenLevel's product work should reduce that burden with safe defaults and runbooks, but self-hosting does not remove it.

---

## 12. Phase 0: the current execution directive

Phase 0 is the current work. It is explicitly not another architecture review and not a rewrite of V2.1. Its purpose is to convert design statements into observed evidence.

### 12.1 Baseline and toolchain

The current coding-agent environment was reported to lack Node.js, Docker, PostgreSQL, and `flyctl`. The Phase 0 plan authorizes installing or provisioning only what is needed, but separates local work from the four approval gates:

- **Gate A — Node 22 and `npm ci`:** install the toolchain and establish the real typecheck/test baseline.
- **Gate B — pinned DBOS dependency:** add the exact `@dbos-inc/dbos-sdk` version to `package.json` and lockfile only after approval; record the resolved version and compile against its actual types.
- **Gate C — real PostgreSQL:** use local Postgres, Docker, or a Neon branch to run integration tests. PGlite can be used as a fast pre-check but is not proof of the real PostgreSQL/DBOS transaction behavior.
- **Gate D — Fly/Neon staging access:** use the owner's accounts and authorization to run deployment and forced-replacement tests. This is billable and must not be assumed.

The first activity, requiring no provisioning approval, is to record branch, commit, status, redacted configuration inventory, and exact commands/environment requirements. Typecheck must run before Vitest; test failures must be separated into pre-existing failures, environment failures, and regressions. No green claim is made unless the command actually passes.

### 12.2 P1 — prove atomic enqueue on real PostgreSQL

P1 must demonstrate concurrent duplicate requests converge to one `business_event` row and one workflow. The losing request returns the stored status. Rollback must leave no event, business mutation, or workflow. The tests also cover duplicate delivery after workflow completion, after DBOS history deletion but while the application projection is retained, and after the tombstone retention window expires. Same key with a different payload hash returns 409 and records the discrepancy.

The SDK's workflow reuse option is compile-verified against the pinned package. If the option is not accepted by the exact types/runtime, use the documented application unique-row gate and explicitly verified behavior; do not patch types, cast around the compiler, or replace the transaction API with plain enqueue.

### 12.3 P2 — prove worker replacement on staging Fly

P2 must demonstrate no overlapping active `worker-1` executors during a normal rolling deploy and forced replacement. The tests run while a workflow is in a normal step, while a provider call is in progress, and while a provider attempt is uncertain. They record Machine states, executor IDs, DBOS workflow history, heartbeat, and attempt records.

The worker must fail closed without the system database, expose a meaningful readiness signal, stop dequeuing on SIGTERM, drain within the 120-second timeout, and recover pending work when the replacement starts. No provider call may be repeated blindly. A simple process restart is not enough; the plan requires actual deployment and forced-replacement scenarios.

No custom advisory-lock fence is to be added unless the staging evidence demonstrates an overlap problem that the Fly replacement procedure does not prevent.

### 12.4 P3 — prove wallet and provider-attempt safety

A fault-injecting fake provider exercises the four crash windows: pre-dispatch, after dispatch state but with unknown contact, provider accepted then process died before settlement, and process died after settlement before workflow completion. The test assertions must be numeric and inspect the provider-side count, operation ID, attempt state, reservation/settlement count, unique settlement keys, and final balance.

The concurrent-exhaustion test races multiple turns against one wallet and proves the balance never becomes negative. The sweeper test proves that dispatched or uncertain operations are not automatically refunded.

### 12.5 Backpressure and final report

The web enqueue pool is bounded. Its acquisition timeout, rate limit, and retryable failure behavior must be explicit. Under saturation, requests should receive a visible retryable response; webhook senders should receive a non-success response when appropriate so they can retry. The application must never acknowledge an event before the transaction commits and must not silently drop it.

The Phase 0 report must include the eight items in the current §6 report requirement, plus three carried corrections: the same-key/different-payload 409 rule, the commercial terminology fixes deferred to pre-pricing, and the RPM-to-concurrency conversion method. It must quote observed command output and distinguish pass, fail, blocked, and not-run. Any unexecuted staging test remains blocked, not implied complete.

### 12.6 Scope protection

Prototype code belongs in an isolated `phase0/` area so it can be adopted or discarded deliberately. Only approved dependency/lockfile additions and Phase 0 artifacts are allowed. V1, V2, V2.1, and prior plans remain byte-identical. No pg-boss paths are touched. No production state is changed. No destructive migration proceeds until the owner confirms in writing that there is no live customer state (Strategy A).

---

## 13. Roadmap after Phase 0

The roadmap is intentionally staged so commercial foundations can be built before the durable execution cutover expands across the product.

### Phase 0 — baseline and proof (current)

**Deliverables:** actual toolchain and dependency baseline; P1 atomic enqueue; P2 Fly worker replacement; P3 provider/wallet crash proofs; bounded-pool backpressure; connection budget observation; final proceed/fix/stop report.  
**Exit condition:** P1, P2, and P3 pass on the required environments, the baseline is understood, and required owner approvals are recorded. If a gate is not available, the result is blocked and documented; it is not silently waived.

### Phase 1A — agency and billing foundation

Build agencies, members, roles, location ownership, Stripe subscription lifecycle and dunning, entitlements, usage ledger, wallet reservations/settlement, spend caps, and plan gates. The business value is the ability to charge for a controlled service. Acceptance requires signup-to-subscription-to-wallet funding and plan-gate tests, plus payment and wallet crash tests. The definition of done is simple: money moves correctly, or it does not move at all.

### Phase 1B — provider onboarding and credentials

Build encrypted credential storage, OAuth connect/refresh/revoke, consent registry, provider health checks, and the tenant-facing setup path. Acceptance includes credential lifecycle tests, secret-redaction checks, and negative tenant-crossing tests. The goal is to make onboarding possible without an operator manually editing secrets for every customer.

### Phase 2 — durable execution core

Introduce the DBOSClient web path, the single worker, transactional enqueue, the required transactional datasource paths, durable agent/automation workflows, continuations, provider-attempt safety, wallet gates, workflow patching/version discipline, heartbeat, and alerts. Existing pg-boss paths remain until the DBOS gates pass and the cutover is approved. This phase is the point at which the reliability architecture becomes the execution path for the selected customer journeys.

### Phase 3 — expansion

Expand campaigns, imports, snapshots, white-label capabilities, reporting digests, and other deferred GHL-like surface area. Run a gated RLS pilot only after database role and pooling behavior are proven. Add a second worker or Conductor only when a measurable availability, recovery, operations, or checkpoint-volume trigger justifies the added cost and complexity. Each expansion ships with its own acceptance tests; none should become an unannounced prerequisite for the first paid pilot.

---

## 14. Decisions still requiring owner approval

The following are not hidden technical assumptions. They are explicit owner decisions that gate specific spending, deployment, or destructive actions:

1. **Strategy A:** written confirmation that there is no live customer state and a clean-start migration is safe. Until then, destructive steps are blocked.
2. **First vertical:** roofing or real-estate investor leads. This gates acquisition spend and the initial offer.
3. **Pilot price band:** the $199–$399/month plus prepaid AI credits offer is a hypothesis, not an approved price.
4. **Fly and Neon region:** choose after the first pilot geography is confirmed.
5. **Chatwoot hosting:** cloud or self-hosted; this affects webhook deployment cost and operations.
6. **Managed messaging liability:** BYO messaging/voice is the launch model; managed messaging requires a separate approval and cost/liability model.
7. **RPO/RTO:** recovery objectives must be approved before the product makes customer-facing backup or recovery promises.
8. **Conductor:** deferred until the agreed operational trigger, or sooner if the availability requirement changes.
9. **Chatwoot retirement timing:** post-launch decision, not a Phase 0 prerequisite.

---

## 15. What success looks like

For developers, success means durable workflow code with explicit versioning, atomic event-to-workflow creation, reproducible tests, and no unsafe assumptions about external APIs.

For operations, success means one understandable Fly deployment, known connection budgets, worker-specific readiness, a real recovery drill, observable queue age and provider attempts, and runbooks that can explain and resolve uncertain outcomes.

For agency owners and GHL users, success means a deployable platform that reliably captures leads, follows up, books appointments, uses AI within a budget, and lets the agency retain and reuse its operating playbooks. It should be possible to understand what is included, what is deferred, which providers the customer must bring, and what the self-hosting operator is responsible for.

For the business, success means a narrow product that can acquire paid pilots, keep its variable costs bounded, and prove that customers value the outcome before the team spends months reproducing GHL's full surface area.

The immediate recommendation is therefore unchanged: **execute Phase 0; do not reopen the architecture unless a proof test demonstrates a structural failure.** V2.1 remains the design baseline. Phase 0 is the evidence gate that determines whether the design is ready to become the implementation path.

---

## Appendix A. Architectural decisions at a glance

| Decision | Current position | Rationale / condition |
|---|---|---|
| Workflow engine | DBOS for the new durable path | Checkpointed workflows, durable continuations, partitioned flow control, Postgres-backed state |
| Existing pg-boss | Leave untouched until proof and cutover approval | Avoid destructive migration and unproven replacement |
| Web execution | Hono + `DBOSClient` | Web handles requests and enqueues; it does not run the worker executor |
| Worker topology | One fixed-ID worker, `worker-1` | Simpler recovery and operations at initial scale; staging proof required |
| Database | One Neon Postgres database | Shared transaction for domain writes and DBOS enqueue |
| Schemas | `app` + `dbos` | Clear separation without separate database transaction boundaries |
| Tenant boundary | Agency + location; location queue partition | Multi-account agency model, tenant fairness, explicit context validation |
| RLS | Deferred | Must prove compatibility across direct, pooled, worker, and datasource connections |
| External effects | Operation/attempt ledger; quarantine uncertain calls | Provider acceptance is not transactionally atomic with Postgres |
| AI spend | Prepaid wallet with reservation/settlement and caps | Makes cost bounded and visible; does not guarantee profitability |
| Messaging | BYO messaging/voice at launch | Avoid early provider liability and variable-cost exposure |
| High availability | One worker initially; Conductor/second worker later by trigger | Do not buy operational complexity before an availability need is measured |
| Product scope | Focused lead-to-booking wedge, not GHL parity | Ship a paid outcome before broad product expansion |

## Appendix B. Reference material

### Internal project baseline

- `docs/architecture/OPENLEVEL_DBOS_FLY_NEON_ARCHITECTURE_V2_1.md` — current architecture baseline, repository evidence ledger, product scope, tenant model, Fly/Neon topology, DBOS design, provider safety, economics, and phased roadmap.
- `docs/plans/plan6.2.md` — current Phase 0 execution plan and proof gates as presented for approval on November 14, 2026.
- `docs/plans/plan6_amended.md` and prior V2/V1 planning documents — decision history; retained unchanged for auditability.

### External technical references

- [DBOS architecture](https://docs.dbos.dev/architecture) — Postgres-backed checkpoints, distributed execution, recovery, and Conductor.
- [DBOS TypeScript Client](https://docs.dbos.dev/typescript/reference/client) — `DBOSClient`, `enqueueInTransaction`, transaction ownership and system-database requirement.
- [DBOS TypeScript queues](https://docs.dbos.dev/typescript/reference/queues) — global and partitioned concurrency/rate controls and queue-key requirements.
- [DBOS TypeScript workflows](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial) — durable steps, replay, serialization, and recovery model.
- [Fly process groups](https://fly.io/docs/launch/processes/) — separate process groups and per-group Machine scaling.
- [Fly app configuration](https://fly.io/docs/reference/configuration/) — rolling deployment and `max_unavailable` configuration.
- [Fly operational changelog, November 5, 2026](https://fly.io/changelog/reducing-deploy-and-dashboard-failures/) — the importance of worker health checks and deployment pacing.
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling) — pooled versus direct connections and transaction-mode limitations.

---

*This document records the strategy and decision state as of November 14, 2026. It is not a claim that Phase 0 has passed, that the proposed commercial offer is validated, or that the system is ready for production cutover.*
