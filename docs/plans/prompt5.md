## **My architectural verdict**

**The underlying technology choices are sound, but the original architecture is over-engineered for the business it is supposed to create.** I would simplify the architecture before authorizing implementation.

I would not blindly accept either Muse's simplified proposal or Claude's. Both identify important opportunities, but some of their recommendations need qualification.

The attached reviews correctly identify that the plan has incomplete migration and behavioral matrices, contradictory dual-write behavior, incorrect connection arithmetic, and an inadequate recovery/versioning design.

Plan 5 Review.md  
They also make a valuable business point: building an elaborate migration framework to preserve every existing behavior is not the same as building a better commercial product.  
Plan 5 Review.md

There are several important facts that should shape the new design:

* **The web application does not need to run DBOS.** `DBOSClient` is designed for external API applications: it enqueues and inspects work without launching an executor or recovering/dequeuing workflows.  
   DBOS Docs+1  
* **An outbox is not automatically necessary.** `enqueueInTransaction()` can atomically enqueue a workflow with application writes in a caller-owned PostgreSQL transaction. However, it requires a connection to the DBOS system database and does not support `return-existing` deduplication.  
   DBOS Docs  
* **Database writes inside workflows need their own transaction strategy.** DBOS transactional datasources provide exactly-once database transaction execution, a distinct capability from ordinary workflow steps.  
   DBOS Docs+1  
* **pg-boss is more capable than the original plan suggests.** It already supports transactional enqueue, delayed jobs, cron schedules, deduplication/throttling and tenant grouping. It deserves a fair comparison rather than being rejected because it is the old engine.  
   pg-boss+3  
* **DBOS recovery needs an explicit deployment model.** A single executor can recover its own workflows after restart; distributed recovery across executors is where Conductor becomes important. DBOS recommends Conductor for production distributed deployments.  
   DBOS Docs+2  
* **Conductor has a real price, not just an abstract operational benefit.** The current DBOS Pro listing is \$99/month and includes Conductor, distributed recovery, workflow management and one million monthly checkpoints, with extra checkpoint charges. That cost belongs in the business model.  
   DBOS

### **The simpler architecture I would investigate first**

## **OpenLevel — lean enterprise SaaS architecture**

**Web application — Hono**

CRM API · Agency and location access · Billing · Customer requests

DBOSClient only — no workflow executor

Atomic transaction and durable workflow enqueue

**Neon PostgreSQL — one database**

App schema · DBOS schema · Agency ownership · Usage ledger

DBOS queues — tenant-aware execution

**One DBOS worker initially**

**CRM automation**

Durable follow-ups and waits

**AI agent**

Replies and tool operations

**Campaigns**

Recipient batches and delivery

**Background work**

Imports, reports and scheduled jobs

**Provider adapters**

AI · Email · SMS · Voice · Payments · Calendar

One Fly application, one image, separate web and worker process groups, one primary region. Add worker capacity and distributed recovery only when actual usage justifies them.

The business model should be agency-first rather than a collection of unrelated CRM features: an agency owns sub-accounts (locations), pays for the platform, manages customer relationships and can replicate proven configurations through reusable snapshots.

For profitability, I would prioritize **a narrow, high-value product, prepaid or tightly capped AI usage, repeatable agency onboarding, and low support overhead**. Infrastructure optimization matters, but customer acquisition, retention, and variable usage costs will determine whether this becomes a profitable business.

The prompt below asks Muse to challenge even this recommendation, prove the simplest viable architecture, and produce a commercially oriented Architecture V2 rather than merely patching the old plan.

## **Consolidated Muse directive**

Architecture V2 assignment  
Planning only — no implementation

# **FINAL ARCHITECTURE V2 DIRECTIVE**

## **OpenLevel — Building a Profitable, DBOS-Powered Enterprise SaaS for Agencies**

### **Your role**

Act as the principal software architect, senior DevOps engineer, SaaS product strategist, and commercially minded technical founder.

Your assignment is to reconsider the entire OpenLevel architecture, not merely repair the previous implementation plan.

The objective is to build an enterprise-grade, multi-tenant SaaS in the general category of GoHighLevel, without attempting 100% feature parity.

The platform must be:

* Technically robust, reliable, and recoverable.  
* Simple to deploy, maintain, monitor, and troubleshoot.  
* Economical for a small operator to run.  
* Capable of scaling to a substantial multi-tenant customer base.  
* Designed to generate attractive recurring revenue and healthy contribution margins.  
* Flexible enough to expand without repeatedly redesigning its foundations.

The goal is not to produce the most sophisticated architecture possible. The goal is to choose the smallest architecture that provides the reliability and flexibility needed to build a successful enterprise SaaS.

**Think like an engineer who personally has to operate this platform during a production incident, and like a business owner who has to make it profitable.**

Do not assume that using more DBOS features, more Fly Machines, more database roles, more queues, more infrastructure, or more custom administration software makes the architecture better.

Simpler is preferable, provided reliability, security, recovery, and commercial scalability are not sacrificed.

---

# **PART I — AUTHORITY, REPOSITORY, AND SAFETY**

## **1\. Establish the controlling specifications**

Inspect the local repository's actual files before beginning.

Identify and read, where present:

* `docs/plans/prompt3.md`  
* `docs/plans/plan5.md`  
* The latest existing OpenLevel architecture plan.  
* Any directly referenced controlling amendments.  
* The current `Plan 5 Review.md` and other relevant architectural reviews.

Record actual filenames, Git state, and content provenance.

The reviews are adversarial commentary, not automatically authoritative specifications. Accept their findings when technically valid. Reject or qualify their conclusions when the official documentation or repository evidence contradicts them.

Do not claim that a document controls the assignment unless you have actually inspected it.

If `plan5.md` is absent or differs from the version described in the existing architecture document, do not invent its contents. Record the provenance problem and follow this V2 assignment as the explicit current instruction.

Where an older directive requires a count, matrix, or audit, preserve it when it materially improves verification. Do not retain unnecessary migration machinery merely to satisfy the appearance of completeness.

## **2\. Strict working constraints**

This assignment is architecture planning and evaluation only.

Do not:

* Modify application source files.  
* Modify schemas or migrations.  
* Modify existing tests.  
* Install or upgrade dependencies.  
* Deploy or alter Fly applications.  
* Create or modify Neon databases or branches.  
* Change infrastructure, DNS, secrets, credentials, or provider accounts.  
* Execute destructive commands.  
* Commit changes.  
* Expose secrets, credentials, or customer data.  
* Invent evidence or claim that unexecuted tests passed.

Inspect existing tests and configuration before running anything.

If Node.js or required dependencies are unavailable, record the limitation. Do not install anything.

Preserve existing tracked and untracked files.

Create only the new V2 architecture document. Do not overwrite the existing architecture plan. If the chosen output path already exists, use an explicitly versioned alternative.

## **3\. Establish whether this is a migration or a new commercial launch**

This distinction controls much of the architecture.

Inspect the repository, configuration, deployment documentation, migration history, and available operational evidence to determine whether OpenLevel has:

* Real paying customers.  
* Live production data.  
* Active workflows and delayed executions.  
* Pending pg-boss jobs.  
* Existing production integrations.  
* Existing Fly deployments.  
* Existing Neon databases.  
* An established public hostname or production traffic.

Do not assume that an existing codebase means an existing live SaaS.

Do not connect to production systems or use credentials to establish these facts.

If the available evidence cannot establish whether real customers or production jobs exist, label the status **Unknown**.

Produce two conditional strategies:

**Strategy A — New launch / no live customer state**

Prefer a clean transition to the new architecture. Eliminate unnecessary dual-write, per-tenant cutover flags, legacy execution migration, and long-lived compatibility infrastructure.

**Strategy B — Existing production customers or persisted execution state**

Provide a safe migration and compatibility strategy that protects customer data, pending work, and externally visible operations.

Do not impose the complexity of Strategy B when Strategy A is demonstrably sufficient.

If the actual state is unknown, identify the owner approval required before any destructive transition.

---

# **PART II — CHALLENGE THE ARCHITECTURE BEFORE SELECTING IT**

## **4\. Answer the central architectural question**

Explicitly answer:

**Is the existing TypeScript \+ DBOS \+ Neon \+ Fly.io architecture the best architecture for the business, or is it unnecessarily complicated?**

Challenge the assumptions in the previous document.

In particular, determine whether we genuinely need:

* An application-owned transactional outbox and a scheduled five-second pump.  
* A second workflow execution engine.  
* Multiple independently managed worker pools.  
* Per-tenant cutover flags.  
* A custom dead-letter subsystem.  
* A custom workflow administration interface.  
* A separate reconciliation subsystem for every provider.  
* A complex migration of legacy execution history.  
* Four or more database credentials from day one.  
* A multi-step blue-green deployment system before there is meaningful production scale.  
* All 230 existing endpoints and product modules.  
* Exact preservation of all existing behavior and test files.

For every proposed component, answer:

1. What business or operational problem does it solve?  
2. What happens if we do not build it?  
3. Does DBOS, PostgreSQL, Neon, Fly, or an existing provider already solve it?  
4. What new failure modes and maintenance obligations does it introduce?  
5. Is it necessary before the first paying customer, or can it wait?  
6. What evidence justifies its cost?

Avoid architecture for architecture's sake.

## **5\. Compare the actual execution alternatives fairly**

Do not automatically select DBOS because the previous plan selected it.

Evaluate these alternatives:

**A. Improve pg-boss and retain it**

Investigate the current pg-boss capabilities, including:

* Atomic enqueue within application transactions using the `db` transaction adapter.  
* Delayed work with `startAfter`.  
* `singletonKey` and deduplication/throttling.  
* Queue grouping and concurrency.  
* Cron scheduling.  
* Retry, expiration, and retention.  
* Worker heartbeat and recovery.  
* Failed-job retry and cancellation.

Determine whether a simpler pg-boss implementation with a persisted automation state machine can satisfy the product's real requirements.

**B. DBOS-only**

Use DBOS for durable multi-step workflows, with no pg-boss dependency.

Assess its durable workflow execution, database transactions, queues, partitions, delayed work, scheduling, retries, recovery, versioning, and monitoring.

**C. DBOS plus pg-boss**

Use both only if a concrete workload justifies the additional system.

For example, assess whether a high-volume, simple batch workload genuinely benefits from pg-boss while DBOS handles customer journeys.

If considering this option, explain the handoff, ownership, idempotency, transaction boundaries, failure recovery, monitoring, and reconciliation. Do not allow two systems to execute the same business operation.

Compare the alternatives using practical measures:

* Implementation complexity.  
* Operational simplicity.  
* Reliability.  
* Recovery behavior.  
* Developer experience.  
* Database load and connections.  
* Checkpoint/storage overhead.  
* Throughput.  
* Tenant fairness.  
* Provider side-effect safety.  
* Cost per ten thousand and one hundred thousand executions.  
* Difficulty of supporting one hundred, one thousand, and ten thousand customer accounts.

Clearly distinguish documented behavior, assumptions, and unmeasured benchmark hypotheses.

**Make one explicit recommendation.** Do not leave three equally weighted architectures for the owner to decide.

The working hypothesis is DBOS-only for the durable customer workflows, with no second queue engine unless evidence proves a material advantage. You must still test that hypothesis against the capabilities of pg-boss.

---

# **PART III — BUILD A PRODUCT THAT CAN MAKE MONEY**

## **6\. Define the actual SaaS product and its market wedge**

Do not try to reproduce every GoHighLevel feature.

Determine which existing OpenLevel capabilities provide the strongest potential commercial value.

Inspect the repository and rank its actual capabilities, including:

* Lead capture and forms.  
* CRM contacts and pipelines.  
* Conversations and unified inbox.  
* Appointment booking.  
* Email and SMS communication.  
* Campaigns.  
* Workflow automation.  
* AI-assisted replies and actions.  
* Landing pages and funnels.  
* Reviews and reputation.  
* Social publishing.  
* Courses and communities.  
* Affiliates.  
* Analytics and reporting.

Recommend a focused launch product rather than an indiscriminate feature clone.

A plausible starting wedge is an agency operating system combining:

1. Lead capture.  
2. Contact CRM and pipeline.  
3. Unified conversations.  
4. Appointment scheduling.  
5. Automated follow-up.  
6. AI-assisted customer engagement.  
7. Reusable agency templates and snapshots.

Challenge this proposed wedge using customer value, willingness to pay, operating costs, implementation complexity, and competition. Recommend a different wedge when the evidence supports it.

Identify:

* Ideal customer profile.  
* Initial agency/customer segment.  
* High-value problem being solved.  
* Essential launch features.  
* Features to defer.  
* Features to retire or leave unsupported.  
* Differentiation and switching costs.  
* Potential distribution channels.  
* Why customers would pay instead of choosing GoHighLevel or another alternative.

Do not claim market demand or pricing willingness without evidence.

If external market research is available, use credible current sources and identify their publication/access dates.

The objective is a commercially focused product, not feature parity.

## **7\. Design the smallest viable agency and tenant model**

The existing codebase uses `location_id` as its primary data-isolation boundary.

Preserve that domain isolation where practical, but do not permanently equate a SaaS customer account with a single location.

Evaluate a minimal agency structure:

```
Agency
  |
  +---- Agency Members
  |
  +---- Location A
  |       +---- Contacts
  |       +---- Conversations
  |       +---- Appointments
  |       +---- Workflows
  |
  +---- Location B
          +---- Contacts
          +---- Conversations
          +---- Appointments
          +---- Workflows
```

Consider a minimal schema direction:

* `agencies`  
* `agency_members`  
* `locations.agency_id`  
* Existing location-scoped domain tables.

Do not create a complicated organization, account, workspace, agency, tenant, and sub-tenant hierarchy unless a concrete business requirement needs it.

Specify:

* Agency ownership.  
* Operator membership.  
* Roles and permissions.  
* Location provisioning.  
* Agency-level billing.  
* Location-level quotas.  
* Agency and location integration credentials.  
* Agency branding and custom domains.  
* Agency-level snapshots.  
* Tenant isolation in background workflows.

One agency may initially own one location, but the architecture should support multiple locations without a redesign.

Evaluate PostgreSQL row-level security as defense in depth, in addition to existing repository-level tenant filtering.

If recommending RLS, demonstrate how transaction-local tenant context works across ordinary queries, DBOS transactional operations, worker connections, and pooled connections. Identify privileged roles that could bypass RLS. Do not enable RLS speculatively without testing its consequences.

Investigate `client_slug` cardinality. Determine whether multiple locations resolve to the same environment secret namespace and what that means for account isolation, shared credentials, and metering.

## **8\. Decide the commercial model before optimizing infrastructure**

Evaluate three provider-cost models:

**A. BYO credentials**

Customers provide their own AI, SMS, email, voice, and integration accounts.

Benefits: lower platform-funded consumption risk.

Costs: more onboarding friction, credential management, and support.

**B. Platform-owned providers**

OpenLevel operates provider accounts and bills customers for usage.

Benefits: unified experience, control over the provider relationship, and possible usage revenue.

Costs: variable COGS, compliance, chargebacks, abuse exposure, provider account management, and greater operational responsibility.

**C. Hybrid**

Choose a model by provider and customer segment. For example, customer-provided messaging credentials with platform-managed AI credits, or managed usage as a paid add-on.

Recommend a launch model and a future migration path.

Do not assume SMS and voice are free simply because existing locations use their own accounts.

If platform-funded communications are proposed, investigate carrier registration, consent, sender reputation, abuse controls, and applicable regulatory obligations for the chosen markets.

## **9\. Make billing, metering, and cost controls foundational**

Do not defer the commercial control plane to the end of the roadmap.

Design the minimum viable commercial layer:

* Agency onboarding.  
* Agency and location provisioning.  
* SaaS subscription management.  
* Stripe billing for OpenLevel subscriptions, separate from CRM invoices and customer payments.  
* Plan entitlements.  
* User/seat limits.  
* Sub-account/location limits.  
* AI usage metering.  
* Provider usage metering.  
* Usage ledger.  
* Prepaid credits or wallet where appropriate.  
* Usage reservations before expensive operations.  
* Usage settlement after provider results.  
* 80% budget warnings.  
* Hard limits or explicit paid-overage approval.  
* Suspension and reactivation.  
* Upgrade/downgrade handling.  
* Customer usage visibility.

Make the usage ledger transactionally reliable.

A failed or retried workflow must not charge the customer twice. An AI call whose outcome is uncertain must not silently create duplicate billing.

Design AI budget reservations and settlement so they remain correct under workflow retry, worker crash, concurrent agent turns, and tenant-level quotas.

Build two commercial scenarios:

1. Customer-funded/BYO providers.  
2. Platform-funded and rebilled usage.

Model their contribution margins separately.

Do not invent plan prices such as \$97, \$297, or \$497 without customer research. Provide pricing scenarios and explain the willingness-to-pay evidence needed before committing.

Do not promise that the architecture itself will produce huge profits. Optimize for high gross margin, recurring revenue, usage discipline, retention, low support cost, and capital efficiency.

---

# **PART IV — KEEP DBOS POWER WITHOUT UNNECESSARY WRAPPERS**

## **10\. Design the simplest correct DBOS integration**

Use the current official TypeScript DBOS documentation and SDK version. Never treat an SDK clone as authoritative.

Primary reference material:

* [https\://docs.dbos.dev/typescript/reference/client](https://docs.dbos.dev/typescript/reference/client)  
* [https\://docs.dbos.dev/typescript/reference/datasource](https://docs.dbos.dev/typescript/reference/datasource)  
* [https\://docs.dbos.dev/typescript/reference/configuration](https://docs.dbos.dev/typescript/reference/configuration)  
* [https\://docs.dbos.dev/typescript/reference/queues](https://docs.dbos.dev/typescript/reference/queues)  
* [https\://docs.dbos.dev/typescript/reference/methods](https://docs.dbos.dev/typescript/reference/methods)  
* [https\://docs.dbos.dev/typescript/reference/workflows-steps](https://docs.dbos.dev/typescript/reference/workflows-steps)  
* [https\://docs.dbos.dev/typescript/tutorials/workflow-management](https://docs.dbos.dev/typescript/tutorials/workflow-management)  
* [https\://docs.dbos.dev/typescript/tutorials/scheduled-workflows](https://docs.dbos.dev/typescript/tutorials/scheduled-workflows)  
* [https\://docs.dbos.dev/typescript/tutorials/upgrading-workflows](https://docs.dbos.dev/typescript/tutorials/upgrading-workflows)  
* [https\://docs.dbos.dev/production/workflow-recovery](https://docs.dbos.dev/production/workflow-recovery)  
* [https\://docs.dbos.dev/architecture](https://docs.dbos.dev/architecture)  
* [https\://docs.dbos.dev/production/checklist](https://docs.dbos.dev/production/checklist)

Verify all API signatures and semantics against the current TypeScript SDK.

### **Web/API process**

Evaluate a web-only `DBOSClient` arrangement.

The web process should not launch the DBOS runtime, recover workflows, or dequeue work.

It should:

* Authenticate requests.  
* Authorize agency and location access.  
* Perform application transactions.  
* Enqueue durable workflows through DBOSClient where required.  
* Return normal HTTP responses.

Do not initialize DBOS workflow executors in the web process merely to enqueue work.

### **Worker process**

The worker process owns:

* DBOS runtime initialization.  
* Workflow registration.  
* Queue registration and dequeue.  
* Execution and recovery.  
* Scheduled workflows.  
* Provider operations.

Keep one clear runtime entrypoint and use explicit Fly process-group commands or a role-controlled entrypoint.

Do not start multiple hidden DBOS runtimes from shared application bootstrap code.

### **Queue registration**

Use the current API, including `DBOS.registerQueue()` and supported `listenQueues` configuration where applicable.

Do not use removed APIs such as old `WorkflowQueue` constructors or `DBOS.registerScheduled()`.

Account for the fact that queue configuration is stored in the DBOS system database and that startup registration can overwrite runtime changes.

Choose either configuration-as-code or runtime-managed limits, and document the source of truth.

For tenant queues, evaluate:

* `globalConcurrency`.  
* `workerConcurrency`.  
* `partitionConcurrency`.  
* `partitionWorkerConcurrency`.  
* `rateLimit`.  
* `partitionRateLimit`.

Every enqueue to a partitioned queue must provide its partition key. An enqueue without it can remain `ENQUEUED` indefinitely.

Start with conservative limits. Do not invent arbitrary concurrency settings without relating them to memory, database connections, model capacity, and provider rate limits.

---

## **11\. Transaction correctness: distinguish three different mechanisms**

This section is a mandatory architecture decision.

Do not confuse:

1. Atomic application write plus workflow enqueue.  
2. Exactly-once database mutations inside DBOS workflows.  
3. At-least-once external provider execution.

They are separate problems.

### **A. Evaluate `DBOSClient.enqueueInTransaction()`**

Official API:

`https://docs.dbos.dev/typescript/reference/client`

The API can enqueue a DBOS workflow inside a caller-owned PostgreSQL transaction. The application writes and workflow enqueue commit or roll back together.

Important constraints:

* The supplied transaction client must be connected to the DBOS system database.  
* Use a node-postgres `Client` or `PoolClient`.  
* The caller owns transaction begin, commit, rollback, and retry.  
* `duplicationPolicy: 'return-existing'` is unsupported for this method.

Evaluate its use when the application data schema and DBOS schema are in the same Neon database.

Design how duplicate webhooks and request retries are handled using a stable business-event identity and unique database constraint. Do not assume the unsupported `return-existing` option works here.

### **B. Evaluate the application-owned outbox**

Do not automatically preserve the old plan's five-second polling pump.

An outbox may still be preferable if it provides real business value:

* Independent event audit.  
* Multiple consumers.  
* Decoupling of application and execution databases.  
* Durable dispatch reconciliation.  
* Replay independent of workflow history.

Compare its operational and checkpoint costs against `enqueueInTransaction`.

If an outbox is retained, define its state machine, ownership, claim lease, lease expiry, retries, failure handling, cleanup, and stable workflow IDs.

Do not create one five-second scheduled workflow forever without calculating its workflow/checkpoint volume and cost. Consider a more efficient dispatcher strategy.

### **C. Evaluate DBOS transactional datasources for workflow mutations**

Official API:

`https://docs.dbos.dev/typescript/reference/datasource`

Investigate `@dbos-inc/node-pg-datasource`.

DBOS transactional datasources make application database mutations and transaction-completion records recoverable as exactly-once database transactions.

Evaluate how to adapt the existing `Database.query()` abstraction and repository interfaces.

The design must explicitly identify:

* Which operations remain ordinary database queries.  
* Which operations must use DBOS transactional operations.  
* The `transaction_completion` schema requirements.  
* Migration ownership.  
* Runtime privileges.  
* Pooling and Neon compatibility.  
* Whether a shared system-database connection can simplify the implementation.

Do not rewrite every repository merely to use a datasource, but do not claim ordinary `Database.query()` operations are exactly-once because they happen inside a DBOS step.

### **D. External operations**

HTTP calls to AI, email, SMS, voice, payment, and social providers are not made exactly-once by DBOS checkpointing.

For each important operation, specify one primary recovery guarantee:

1. Provider-enforced idempotency.  
2. Application-level deduplication.  
3. Transactional outbox plus reconciliation.  
4. Best-effort retry.  
5. Manual recovery.

Mechanisms may be combined, but each operation must have exactly one declared primary guarantee.

---

## **12\. Keep workflow functions and steps correctly decomposed**

The current plan places too much work inside coarse steps and starts child workflows from ordinary steps.

Correct this.

DBOS workflow creation/enqueueing must occur from workflow code, not inside ordinary steps.

For example:

```
dispatch workflow
    |
    v
load matching definitions (database step)
    |
    v
parent workflow receives result
    |
    +----> start automation workflow A
    |
    +----> start automation workflow B
    |
    +----> start automation workflow C
```

For the AI agent, use separate durable units:

1. Model invocation.  
2. Persisted assistant decision.  
3. Individual tool decision.  
4. Tool execution.  
5. Result persistence.  
6. Next model invocation.  
7. Final assistant response.

Database mutation tools should use transactional datasource operations where appropriate.

External provider tools should use stable operation IDs, idempotency, and reconciliation.

Preserve a clear bounded tool loop. Do not execute a five-round agent interaction as one enormous step containing many independently side-effecting operations.

Store IDs, bounded metadata, and minimal necessary workflow arguments. Do not serialize large database records, secrets, entire conversation histories, or uploaded files unnecessarily.

---

## **13\. Choose the simplest durable wait strategy**

Compare:

**A. Ordinary `DBOS.sleep()`**

Verify its memory residency and queue-capacity behavior. Do not claim ordinary sleeping workflows release worker memory or queue slots.

**B. Delayed continuation workflow using `delaySeconds`**

The current DBOS Client enqueue options support `delaySeconds`.

Evaluate this as the default for large CRM journeys:

1. Execute the current automation segment.  
2. Persist the logical journey identity and due time.  
3. Enqueue a continuation workflow.  
4. Complete the current execution.  
5. Resume later from the delayed workflow.  
6. Revalidate tenant, location, contact, consent, and relevant business conditions.  
7. Cancel or skip if the customer or workflow state makes continuation inappropriate.

**C. DBOS Enterprise suspension**

Evaluate its real licensing, Conductor, and memory benefits.

**D. pg-boss delayed jobs**

Compare its `startAfter` capability and transactional enqueue behavior.

Use projected delayed-jobs workloads of 10,000, 50,000, and 100,000 active customer journeys.

Make one recommendation and explain the cost and operational trade-offs.

Do not introduce a new workflow engine or an elaborate polling state machine without a measured advantage.

---

## **14\. Design schedules and bulk operations**

Use the current TypeScript DBOS schedule APIs:

* `DBOS.createSchedule()`  
* `DBOS.applySchedules()`  
* `DBOS.pauseSchedule()`  
* `DBOS.resumeSchedule()`  
* `DBOS.backfillSchedule()`

Do not promise exactly-once scheduled execution unless it is documented for the precise API and version. Prefer idempotent scheduled work.

Define missed-schedule/backfill policy by business operation. A missed nightly report may be backfilled; an expired promotional campaign may need to be skipped.

Start with a small number of global schedules that enumerate tenants and enqueue tenant-partitioned workflows.

Do not create thousands of independently managed schedules unnecessarily.

### **CSV imports and bulk campaigns**

Treat campaign sending and CSV import as first-class workloads.

Campaign design must preserve or deliberately replace the existing suppression and per-contact isolation behavior.

Specify:

* Parent workflow.  
* Recipient batching.  
* Per-recipient operation identity.  
* Unsubscribe/DND checks before execution.  
* Provider rate control.  
* Campaign cancellation.  
* Delivery and failure states.  
* Progress/accounting.  
* Usage metering.  
* Duplicate prevention and uncertain outcomes.

Avoid a single step containing hundreds or thousands of provider sends.

For CSV files, evaluate private object storage and use references in workflow arguments rather than embedding entire files.

Compare existing infrastructure and suitable object-storage options. Do not introduce object storage unless the product requirements actually need it.

---

# **PART V — RECOVERY, DEPLOYMENT, AND DAY 2 OPERATIONS**

## **15\. Resolve the executor and recovery design before deployment approval**

This is mandatory.

Use the current official documentation:

* [https\://docs.dbos.dev/production/workflow-recovery](https://docs.dbos.dev/production/workflow-recovery)  
* [https\://docs.dbos.dev/architecture](https://docs.dbos.dev/architecture)  
* [https\://docs.dbos.dev/typescript/reference/configuration](https://docs.dbos.dev/typescript/reference/configuration)  
* [https\://docs.dbos.dev/typescript/tutorials/upgrading-workflows](https://docs.dbos.dev/typescript/tutorials/upgrading-workflows)

Compare:

**A. One DBOS worker, stable executor ID**

A single worker can recover its own workflows on restart when the executor ID is preserved.

Evaluate a fixed `DBOS__VMID`/`executorID` for a singleton worker.

Specify:

* How Fly Machine replacement preserves the intended logical executor identity.  
* How a failed worker is confirmed stopped.  
* How a zombie or overlapping old process is fenced.  
* How a new process discovers and recovers the prior worker's pending workflows.  
* How a rollback preserves the correct executor and workflow versions.  
* What happens during a forced Machine replacement.

Do not assign the same executor ID to multiple simultaneously live processes.

Test this model, not just an ordinary process restart.

**B. DBOS Conductor / DBOS Pro**

Evaluate current official pricing and features.

As of the current pricing page, DBOS Pro is listed at \$99/month and includes Conductor capabilities and one million monthly checkpoints, with additional checkpoint charges. Verify current prices at the time of the plan.

Compare the cost of Conductor against the engineering and operational work required to operate executor recovery, workflow administration, versioning, and retention ourselves.

For a one-operator SaaS, a recurring software cost may be more profitable than maintaining custom recovery infrastructure.

**C. Multiple workers without Conductor**

Do not recommend this unless the precise recovery mechanism, executor IDs, recovery API, and failure ownership model are documented and tested.

**D. Self-hosted Conductor**

It has a separate proprietary licensing and hosting model. Verify its current terms and actual cost. Do not assume that self-hosting Conductor is free.

Recommend the simplest safe launch model and specify what triggers the move to distributed recovery.

## **16\. Workflow versioning and deployment safety**

Compare:

* Fixed application version plus `DBOS.patch()`.  
* Explicit versioned workers retained until old workflows drain.  
* DBOS Conductor/automatic version management.

Use the current TypeScript API, not outdated `enablePatching` instructions from a code clone.

For every workflow code change, define which changes are backward-compatible and which alter the number/order of durable steps.

For a patching strategy:

* Pin the application version deliberately.  
* Insert patch markers around breaking workflow changes.  
* Retain old workflow paths until no relevant workflow needs them.  
* Use `DBOS.deprecatePatch()` only after the affected executions complete.  
* Do not allow old code to process new workflows that require newer patch markers.

For versioning:

* Keep the necessary old version executable.  
* Explain how Fly actually runs old and new processes.  
* Define traffic/enqueue routing.  
* Define retirement and rollback criteria.

One `fly.toml` and two process groups do not automatically implement blue-green version compatibility.

Do not claim that a rolling deploy safely resumes every old workflow without demonstrating the selected strategy.

## **17\. Simplify the Fly.io deployment**

Evaluate a single Fly app, one image, one `fly.toml`, and two process groups:

* `web`  
* `worker`

The web process uses Hono and DBOSClient.

The worker owns DBOS runtime execution.

Start with the smallest realistic deployment and scale from actual workload measurements.

Specify:

* One image/build pipeline.  
* Explicit production entrypoint.  
* Node version.  
* Reproducible TypeScript runtime strategy (`tsc` output or explicit `tsx` invocation).  
* DBOS code excluded from bundling.  
* Release command.  
* App and DBOS schema migration ordering.  
* Secrets and runtime configuration.  
* Health/readiness checks.  
* Worker process lifecycle.  
* SIGTERM handling and `kill_timeout`.  
* Restart policy.  
* Worker count and scaling procedure.  
* Database connectivity.  
* Metrics implementation.

Do not specify a TCP health port unless an actual listener implements it.

Do not assume `min_machines_running` controls a worker process with no Fly HTTP service. Specify worker count using the correct Fly mechanism and demonstrate how it behaves during deploy and Machine replacement.

The application must not start every migration independently in every process.

Use one migration execution per release with failure blocking an unsafe deploy.

Do not assume that `dbosctl` exists in the production container. Verify the current DBOS migration CLI/API and build or install it deliberately.

Choose the Fly and Neon region using target customer geography, Neon region availability, latency, and data-residency needs. Do not hardcode `iad` without justification.

Evaluate Singapore if the actual target market is Southeast Asia, but make the recommendation based on the intended customers rather than assumptions.

## **18\. Simplify Neon and the database privilege model**

Start by evaluating one Neon project and one PostgreSQL database with separate schemas for application and DBOS data.

Explain the benefits and trade-offs of:

* Same database, separate schemas.  
* Separate logical databases in one Neon project.  
* Separate Neon projects for premium isolation.

Correctly describe Neon branching and restore semantics. Do not assert that separate logical databases necessarily have separate PITR timelines without official evidence.

Design a minimal least-privilege role model.

Compare two, three, and four roles. Do not give the runtime superuser privileges to save diagram space.

At minimum distinguish migration/DDL privileges from application runtime privileges.

Include any additional role separation required by the selected DBOS integration, but do not invent privileges such as EXECUTE on a schema.

Define:

* Direct versus pooled connections.  
* DBOS system database connection.  
* DBOSClient transaction connection.  
* Application connection pool.  
* Transactional datasource pool.  
* Maximum workers.  
* Migration connections.  
* Admin/read-only access.  
* Neon connection limits.  
* Pool sizes and headroom.

Correct all previous arithmetic and distinguish direct backends from pooled client connections.

Calculate minimum and target worker configurations separately.

Provide a connection budget table showing every pool, every process, and its configured maximum.

Do not call an unmeasured connection budget verified.

---

# **PART VI — PROVIDER RELIABILITY AND SECURITY**

## **19\. Build one provider operation model**

Do not build a separate complicated send/reconciliation subsystem for every provider.

Evaluate one reusable `outbound_operations` or equivalent application-level record, with an appropriate state model such as:

* pending  
* succeeded  
* uncertain  
* failed  
* manually resolved

The selected names and states must match actual needs.

Use stable operation identity and provider metadata.

Do not assume that providers support lookup by a client-generated key.

Verify the actual capabilities and limitations of:

* Chatwoot.  
* Twilio.  
* Brevo.  
* Stripe.  
* Square.  
* Anthropic.  
* Vapi.  
* Social publishing providers.

Cite official API documentation for every claimed idempotency, reconciliation, callback, and lookup capability.

If a provider does not support reliable lookup or idempotent submission, explicitly document the uncertain-outcome/manual-reconciliation policy.

For Stripe and Square, do not simply stabilize a request ID. Evaluate request-body changes, operation types, provider idempotency retention, and version/content components.

A DBOS step retry must never blindly duplicate a payment, call, or message.

### **Chatwoot security**

Investigate the global Chatwoot webhook secret and `inbox.id` tenant mapping.

Determine whether an authenticated webhook truly binds the event to the tenant, and what happens if an attacker possesses the global secret or forges a payload.

Assess:

* Per-inbox/per-location secrets.  
* Server-side inbox mapping.  
* Authentication of the Chatwoot instance.  
* Query-string secret leakage.  
* Logging and reverse-proxy exposure.

Do not state that the inbox is authenticated merely because a payload contains its ID.

If Chatwoot is self-hosted, assess its Rails/Redis/Sidekiq operational burden and whether it creates a larger maintenance liability than the value it provides.

Do not rewrite the conversation system solely to eliminate Chatwoot until there is a clear migration business case.

## **20\. Secret handling and enterprise security**

Environment-variable names in database rows are useful for developer-managed deployments, but they are not a full self-service SaaS credential architecture.

Define the minimum viable design for:

* Encrypted tenant credentials.  
* Key versioning and rotation.  
* OAuth authorization and refresh.  
* Credential revocation.  
* Provider disconnection.  
* Agency/location credential ownership.  
* Access control.  
* Secret redaction.  
* Audit logs.

Evaluate PostgreSQL RLS as defense in depth, not as a casual replacement for application tenant scoping.

Retain explicit tenant identity in every workflow argument, verify it against trusted source records, and revalidate it before consequential operations.

Do not trust a tenant ID in a public request body or provider callback without an authenticated binding.

---

# **PART VII — PRODUCT BEHAVIOR WITHOUT 100% PARITY**

## **21\. Stop preserving behavior that is not commercially valuable**

This is a new SaaS product, not a requirement to preserve every existing quirk.

Do not mechanically preserve every old behavior.

However, do not silently introduce dangerous side effects.

For example, the current `send_sms` and `send_email` workflow actions may only log timeline entries.

Decide the intended V2 behavior explicitly:

* Should these become real sends?  
* Should old definitions be migrated as log-only actions?  
* Should actual send actions require explicit confirmation or reconfiguration?  
* What consent, unsubscribe, and DND checks must be enforced?  
* How will tenants understand the new behavior?

A feature change is acceptable. An accidental message to a real customer is not.

Likewise, evaluate the existing `workflow_runs` table.

Do not maintain two indefinitely competing sources of execution truth.

Prefer DBOS as the durable orchestration execution authority, while retaining or redesigning a customer-facing history/projection table only when the product needs it.

DBOS internal system tables are not automatically the right public product API or indefinite business audit archive.

Separate:

* DBOS internal execution history.  
* Customer-visible automation history.  
* Business audit records.

Define retention and deletion policies for each.

Existing tests may be revised to reflect intentional V2 behavior changes. The acceptance criterion is verified business behavior and security, not preserving 182 test files unchanged.

Retain important route contracts and tenant isolation. Rewrite job tests to exercise the new DBOS workflow and transaction semantics.

Do not weaken or silently delete tests to make the migration pass.

## **22\. Simplify administration and observability**

Do not build a custom operations dashboard before DBOS and existing tools are evaluated.

Compare:

* DBOS Console/Conductor.  
* Fly logs and metrics.  
* Sentry or equivalent error tracking.  
* Neon monitoring.  
* OpenTelemetry where genuinely useful.

Start with a small operator surface:

1. Find a workflow execution.  
2. Inspect status and failure.  
3. Retry/resume/fork using the correct recovery operation.  
4. Cancel a workflow.  
5. Inspect uncertain provider operations.

Use DBOS's own workflow management where possible. Do not assume re-enqueueing the original workflow ID restarts a failed workflow.

Distinguish:

* `resumeWorkflow()`.  
* `forkWorkflow()`.  
* `rewindWorkflow()`.

Define when each is appropriate.

A custom dead-letter table is not mandatory simply because the previous plan included one. Evaluate DBOS terminal states, maximum recovery attempts, and workflow history before introducing a second DLQ.

Include the `MAX_RECOVERY_ATTEMPTS_EXCEEDED` behavior and application-crash loops. A worker repeatedly crashing is not the same as a normal thrown exception that reaches an application-level DLQ.

### **Minimum operating signals**

Collect sufficient structured logging and metrics for:

* HTTP p95 latency and errors.  
* Queue backlog per queue.  
* Stuck or unhealthy workflows.  
* Worker availability and recovery.  
* Database connection use.  
* AI tokens and cost per agency/location.  
* Messaging consumption and delivery failures.  
* Billing/usage reservation errors.

A small initial release can collect more metrics than it pages on. Avoid creating fourteen noisy alerts.

Provide real alert thresholds and response procedures, labeled as proposed until tested.

Design the system so one operator can identify a failed operation without logging into several different queue engines and custom dashboards.

---

# **PART VIII — DATA, RETENTION, DISASTER RECOVERY, AND COST**

## **23\. Design recovery as a whole-system property**

Define the behavior of:

* Worker process crash.  
* Worker Machine replacement.  
* Fly deployment.  
* Neon temporary unavailability.  
* Database restore.  
* Provider outage.  
* Provider timeout after success.  
* Application version change.  
* Queue overload.  
* Repeated process crash.

For Neon PITR restoration:

1. Keep workers stopped.  
2. Restore app and DBOS state.  
3. Reconcile DBOS executions and business-event records.  
4. Reconcile external provider operations for the affected time window.  
5. Reconcile payments, appointments, campaigns, and outbound messages.  
6. Repair or resolve uncertain operations.  
7. Verify tenant ownership.  
8. Start the correct compatible worker.  
9. Verify processing and billing.

A database restore can roll back workflow checkpoints while leaving external actions successful. Never resume production execution until that discrepancy is considered.

Do not derive an RPO guarantee from timestamp precision alone.

Mark RPO/RTO as business targets requiring owner approval and actual restore testing.

## **24\. Define DBOS and application retention**

Avoid retaining every internal checkpoint indefinitely.

Investigate the current DBOS OSS and Conductor features, including workflow deletion and managed retention.

Distinguish:

* Successful workflow history.  
* Failed workflow history.  
* Application domain history.  
* Customer-visible audit data.  
* Provider operation records.  
* Usage ledger.  
* Transaction-completion records.

Define retention, cleanup, PII removal, and legal/audit holds.

Model DBOS checkpoint volume and cost at:

* Ten thousand workflow executions per month.  
* One hundred thousand.  
* One million.  
* Ten million.

Estimate the checkpoint multiplier per agent turn, automation, campaign recipient, and import batch.

Evaluate the DBOS Pro checkpoint quota and excess pricing against the gross margin of the planned commercial tiers.

Do not build a custom retention system until the native capabilities and costs have been examined.

## **25\. Produce a realistic unit economics and profitability model**

Use current official pricing sources and dated references.

At minimum model:

* Fly Machines by exact CPU/RAM/region.  
* Number of web and worker Machines.  
* Neon compute hours and CU sizing.  
* Neon storage.  
* Neon history storage.  
* Branch-hours.  
* Network transfer/egress.  
* DBOS Pro/Conductor and checkpoint usage where applicable.  
* Error monitoring and operating tools.  
* AI input/output token consumption.  
* Retries and duplicate/uncertain model usage.  
* SMS/email/voice costs.  
* Payment-processing fees on OpenLevel's own SaaS subscriptions.  
* Platform-funded versus BYO provider consumption.  
* Support and operational labor.

Do not use invented benchmark percentages such as ±15% or \+5–10% as if measured.

If no benchmark has been run, provide a benchmark procedure and formulas only.

Build a scenario model for:

* 10 agencies.  
* 50 agencies.  
* 100 agencies.  
* 500 agencies.  
* 1,000 agencies.

Use explicit assumptions for average locations per agency, seats, usage, revenue, churn, and support.

Calculate:

* Monthly recurring revenue.  
* Usage revenue.  
* AI and communication COGS.  
* Infrastructure allocation.  
* Payment processing.  
* Contribution margin.  
* Gross margin.  
* Break-even customer count.  
* Sensitivity to unusually expensive tenants.  
* Effect of platform-funded AI versus BYO.  
* Cost of DBOS Pro checkpoints as workload grows.

Include a pricing recommendation as scenarios, not invented facts.

The product's profit strategy should emphasize:

* Agency subscription revenue.  
* Sub-account/location expansion.  
* Paid AI usage with reservation, metering and limits.  
* Optional managed communications where compliance and economics work.  
* White-label features at higher-value tiers.  
* Reusable snapshots/templates that increase retention and reduce support.  
* Repeatable onboarding.  
* Controlled support cost.

Do not price only on workflow executions if customers perceive them as an arbitrary technical meter. Price on business value and clear resource/usage allowances.

Do not confuse high revenue with high profit.

---

# **PART IX — MIGRATION, VALIDATION, AND IMPLEMENTATION ROADMAP**

## **26\. Simplify the migration according to actual production state**

If there are no live customers and no active production workflow state, do not build a multi-month dual-executor migration framework.

Prefer:

1. Establish the V2 baseline.  
2. Implement the DBOS runtime and one vertical slice.  
3. Implement the commercial/agency foundation.  
4. Port only the workflows needed by the launch product.  
5. Validate recovery and provider behavior.  
6. Remove obsolete pg-boss paths.  
7. Deploy the new architecture.

Do not create per-tenant flags and dual writes merely to simulate safety when there is no tenant to protect.

If live customer state exists, use a controlled migration:

* Freeze or fence new work.  
* Establish executor ownership.  
* Drain or adopt pending jobs.  
* Preserve or consciously transform delayed workflow due times.  
* Prevent dual execution.  
* Validate business-event reconciliation.  
* Provide rollback and forward-recovery procedures.

Do not impose an arbitrary 24-hour failure cutoff on customer waits.

If old waiting executions must be adopted, determine whether their due times are persisted. If they are not, design an honest recovery/adoption policy that does not falsely promise timer survival.

Never silently fail customer workflows just to simplify a deployment.

### **Required migration accounting when applicable**

If live state exists, account separately for:

1. Pending jobs.  
2. Running jobs.  
3. Failed/retrying jobs.  
4. Retry attempts.  
5. Dead letters.  
6. Delayed jobs.  
7. Long-running waits.  
8. Historical workflow IDs.  
9. Retry history.  
10. Execution positions.  
11. Deduplication identities.

For every applicable item record:

* Migration strategy.  
* Compatibility requirements.  
* Cutover behavior.  
* Recovery behavior.  
* Rollback behavior.

If no such state exists, mark the relevant item not applicable with evidence. Do not invent a migration for data that is absent.

### **No unsafe dual-write**

If dual-write is used, explicitly define which system is allowed to execute the business operation during each phase.

A disabled DBOS dispatcher may be used for staging/shadow validation, but shadow mode must not produce real external side effects.

Do not run both pg-boss and DBOS on the same event.

The old plan's Phase 2 outbox+pg-boss dual-write must not become a duplicate-execution mechanism.

## **27\. Define the acceptance tests intelligently**

Do not treat test-file count as product quality.

Preserve existing route contracts and domain tests where the behavior remains valid. Revise job/workflow tests for V2 intentionally.

At minimum include the following seven critical release tests:

1. Worker crash mid-workflow; recovery resumes without repeating completed steps.  
2. Provider succeeds, worker crashes before checkpoint; no blind duplicate external operation.  
3. Duplicate authenticated webhook; exactly one business event and appropriate workflow execution.  
4. Duplicate request submission; no duplicate booking, payment, or campaign send.  
5. Long wait survives worker restart and deployment.  
6. Cross-tenant identity forgery under concurrent execution is rejected.  
7. Business write plus durable enqueue cannot result in acknowledged work being silently lost.

Retain the remaining resilience scenarios from the original specification as secondary coverage. Prioritize the seven critical tests as mandatory early gates, not as a reason to delete the other important cases.

Also test:

* DBOS transactional datasource semantics.  
* `enqueueInTransaction` with duplicate business events.  
* Missing queue partition key.  
* Recovery-attempt exhaustion.  
* Workflow patching/version compatibility.  
* Cancellation.  
* Campaign recipient suppression and retry.  
* Usage reservations and billing exactly once.  
* Neon PITR and provider reconciliation.  
* Fly worker replacement and graceful shutdown.

Use real PostgreSQL/Testcontainers for DBOS recovery and transaction behavior. Keep PGlite for existing appropriate application tests.

No claim of a green baseline until the real suite has run successfully.

## **28\. Produce a small, practical implementation roadmap**

Prefer three or four phases, not eight or more by default.

A possible starting sequence:

**Phase 0 — Product and architecture baseline**

* Verify current source, test and deployment state.  
* Identify the customer segment and product wedge.  
* Determine whether production data exists.  
* Select tenancy and revenue model.  
* Approve DBOS/pg-boss and recovery decisions.

**Phase 1 — Commercial product foundation**

* Agency ownership and location provisioning.  
* Membership and authorization.  
* Subscription billing.  
* Usage ledger and cost caps.  
* Secure integration credentials.  
* Minimum customer onboarding.

**Phase 2 — Durable execution core**

* Web-side DBOSClient.  
* DBOS worker.  
* Transaction-safe workflow enqueue.  
* Transactional database mutations.  
* CRM automation and agent workflow.  
* Delayed continuations.  
* Provider operation safety.  
* Recovery and versioning.  
* Core deployment and monitoring.

**Phase 3 — Revenue-generating product expansion**

* Campaigns.  
* CSV imports.  
* Snapshots/templates.  
* White-label capabilities.  
* Analytics and scheduled workflows.  
* Additional workers, Conductor, or advanced operations only when justified by demand and measurements.

Reorder phases when the business case or dependency graph supports a better sequence.

For each phase give:

* Deliverables.  
* Dependencies.  
* Acceptance tests.  
* Customer value.  
* Cost impact.  
* Operational burden.  
* Rollback strategy.  
* Definition of done.

Do not provide invented delivery dates.

---

# **PART X — FINAL ARCHITECTURE DECISION AND DELIVERABLE**

## **29\. Required final recommendations**

The architecture document must answer these questions directly:

1. Is DBOS actually the right choice for this product?  
2. What does DBOS do that pg-boss cannot do adequately without custom code?  
3. What is the simplest architecture that preserves the useful power of DBOS?  
4. Does the web process need DBOS runtime initialization?  
5. Is `enqueueInTransaction` preferable to an outbox for this deployment?  
6. Which application database operations require DBOS transactional datasource execution?  
7. What is the long-delay workflow strategy?  
8. How does one worker recover after a Fly Machine replacement?  
9. When does Conductor become economically worthwhile or operationally necessary?  
10. What is the correct workflow versioning strategy?  
11. How many Fly Machines and database connections are actually needed at launch?  
12. What must be implemented for a customer to sign up, pay, create locations, connect providers, and use the product?  
13. Who pays for AI, SMS, email, and voice?  
14. How do usage metering and quotas prevent negative contribution margin?  
15. Which existing OpenLevel features should be preserved, improved, deferred, or abandoned?  
16. What should be built first to generate recurring revenue?  
17. What are the most important operational risks for a one-person DevOps operation?  
18. What is the break-even model, and what assumptions could invalidate it?

For every major design choice, provide:

* Recommendation.  
* Alternatives considered.  
* Why the recommendation is simpler or more robust.  
* Business impact.  
* Operational impact.  
* Evidence.  
* Remaining uncertainty.  
* Revisit trigger.

## **30\. Required architecture document**

Create:

`docs/architecture/OPENLEVEL_DBOS_FLY_NEON_ARCHITECTURE_V2.md`

If that path exists, use a versioned alternative and preserve the existing document.

The document should be structured around these topics, with sections merged when that genuinely simplifies the explanation:

1. Executive recommendation and architecture verdict.  
2. Product strategy, target customer, scope and non-goals.  
3. Verified repository and production-state inventory.  
4. Agency, account, location and tenant model.  
5. Target runtime and deployment architecture.  
6. pg-boss versus DBOS evaluation.  
7. DBOS workflows, transactions, queues and delayed work.  
8. Provider operations, idempotency and recovery.  
9. Neon database and privilege model.  
10. Fly deployment, process groups and versioning.  
11. Security and disaster recovery.  
12. Commercial onboarding, billing, metering and entitlements.  
13. Unit economics, profitability and scaling scenarios.  
14. Observability, support and Day 2 operations.  
15. Migration/cutover strategy, conditional on live state.  
16. Test and acceptance strategy.  
17. Phased implementation roadmap.  
18. ADRs, risks, assumptions and owner decisions.

Include only useful diagrams, tables, configuration examples, and runbooks.

The document must make the recommended architecture understandable to both an experienced backend engineer and a business owner.

### **Evidence discipline**

Maintain a six-field evidence ledger for material repository-specific findings:

1. Source file.  
2. Symbol.  
3. Observed behavior.  
4. Corresponding tests.  
5. Evidence status.  
6. Architectural implication.

Use precise file and line references.

Correct the earlier rough counting methods. Use a parser or carefully validated fixed-string commands where necessary. Negative findings must include the search method used.

For all external technical claims, cite official current sources and record access dates.

In particular, do not use Python DBOS documentation as sole proof of TypeScript behavior.

Do not treat an SDK source clone as authoritative. A clone may be supplemental evidence only, and its commit must be recorded.

### **Traceability and audit requirements**

Complete the behavior traceability matrix for:

* Routes.  
* Repositories.  
* Domain logic.  
* Tenant isolation.  
* Integrations.  
* Agents.  
* Workflows.  
* Error handling.

It must be useful before implementation, not merely a representative sample deferred until coding.

If the controlling plan requires exact counts, perform the corresponding audits. Do not claim compliance based on headings or empty templates.

Where there are genuine conditional migration requirements, show the complete five-field matrix. Where no live state exists, identify the absence with evidence and recommend the simpler clean-start strategy.

### **ADRs**

Provide concise decision records for the choices that materially affect reliability, operating cost, and future flexibility.

At minimum consider:

* DBOS versus pg-boss.  
* DBOSClient transactional enqueue versus application outbox.  
* Transactional datasource versus ordinary database operations.  
* Durable delays versus sleeping/suspension.  
* Single worker recovery versus Conductor.  
* Fixed application version/patching versus versioned deployments.  
* Shared versus separate Neon database/schema.  
* Agency/location tenancy.  
* Platform-funded usage versus BYO credentials.

Avoid creating ADRs for trivial implementation choices.

## **31\. Final report**

When finished, provide a concise report that includes:

1. Architecture verdict: sound, unsound, or sound after specific corrections.  
2. The simplest recommended target architecture.  
3. Main differences from the original plan.  
4. Findings from official DBOS, pg-boss, Neon, and Fly documentation.  
5. Which existing repository features should be retained, improved, or retired.  
6. The recommended product launch wedge.  
7. The suggested agency and billing model.  
8. Unit-economics assumptions and break-even conditions.  
9. Decisions that require business-owner approval.  
10. Remaining technical and commercial blockers.  
11. Test limitations.  
12. Exact path of the new V2 architecture document.

Do not implement anything.

Do not ask for another round of prompt review. Make the best defensible architectural recommendation using the available evidence. Explicitly mark anything that cannot be verified.

---

# **Final guiding principle**

**Build a business, not a migration museum.**

Use DBOS where durable execution creates genuine customer value and prevents real operational failures.

Use PostgreSQL for durable state and financial/accounting correctness.

Use Fly and Neon in the simplest operational configuration that meets the actual launch requirements.

Keep the agency model, subscription billing, usage metering, tenant isolation, and credential lifecycle central to the design.

Do not chase full GoHighLevel parity. Build a smaller product that solves expensive problems extremely well, earns recurring revenue, controls variable costs, and can be operated reliably without a large engineering or DevOps team.

The architecture must make it possible to serve a few customers profitably first, then grow to hundreds or thousands without requiring a complete redesign.

Reliability, simplicity, and profitability are not separate goals. The right architecture should improve all three.

**My preferred direction:** one Hono web tier using DBOSClient, one DBOS worker initially, one Neon database with separate application and DBOS schemas, and one Fly deployment with two process groups. Use DBOS transactional operations where they materially improve correctness; avoid an outbox pump if atomic enqueue makes it unnecessary. Add Conductor or more workers when measured workload and recovery requirements justify the cost.

The most important commercial change is to build the agency/sub-account model, subscription billing, metering, and cost controls early—not after spending months reproducing every feature of GoHighLevel.

