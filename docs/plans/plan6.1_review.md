# OpenLevel Plan 6 — Consolidated Adversarial Review

**Scope:** Review of `plan6(7).md`, consolidating the attached Muse and DeepSeek reviews in `plan6_review.md`, with independent verification of the disputed DBOS and Fly.io mechanics.

**Decision:** **Revise Plan 6 narrowly, then execute. Do not start another review cycle.** Plan 6 has the right intent and most of the correct work. It is too broad in a few places, and its C2/C3/C4/C5 requirements need a more precise minimum design. There is no reason to reopen V2's overall architecture choice or restart the V1-versus-V2 debate.

**Review boundary:** This is a plan-level review. I did not inspect Muse's live checkout, execute tests, inspect the local `v2.1_review.md`, or access the user's Fly/Neon accounts. Repository facts and the C1–C6/M1–M18 mapping must therefore be confirmed by Muse against the files in the checkout. External API findings below are checked against current official documentation available on 2026-11-14.

---

## 1. Executive verdict

Plan 6 is **close to executable**, but it should not be handed to Muse unchanged. The attached reviews are mostly right about the plan's internal inconsistencies and under-specification. They are not all right about the DBOS API.

The most important correction to the reviews is C2:

- DBOS documents `workflowIDReusePolicy: 'return-existing'` for `DBOSClient.enqueue` and says it defaults to `return-existing`.
- The same DBOS Client reference says `enqueueInTransaction` takes the same enqueue options except that **`duplicationPolicy: 'return-existing'`** is unsupported.
- These are separate mechanisms. `workflowIDReusePolicy` handles reuse of a specific `workflowID`; `duplicationPolicy` handles duplicate `deduplicationID` values in a queue.
- There is a documentation/type-surface wrinkle: the displayed TypeScript `ClientEnqueueOptions` interface lists `duplicationPolicy` but omits `workflowIDReusePolicy`, while the prose describes the latter as an enqueue option. Therefore Plan 6 is right to require verification against the exact pinned SDK. It is wrong to assume either that the property is definitely invalid or that it is already compile-verified.

This means Muse's claim that Step 2 necessarily contradicts V2 is too strong. Step 2 can preserve atomicity if the implementation uses `enqueueInTransaction` and the pinned SDK supports the documented workflow-ID reuse option. The handler still needs an explicit unique-business-row conflict path and a compile/runtime test. Do **not** replace the atomic transaction with a separate `enqueue()` call merely to obtain deduplication.

The actual release blockers are narrower:

1. **C2 — atomic enqueue and duplicate business-event handling must be explicit and tested.**
2. **C3 — the single worker identity must be worker-only and the Fly rollout/replacement procedure must prevent overlapping executors.**
3. **C4/C5 — the provider-attempt/replay model must not repeat non-idempotent paid calls or external sends blindly, and the wallet must bound platform spend, not merely customer billing.**
4. **Tenant isolation, outbound consent, and provider credential boundaries must remain launch requirements.**

C1 economics and C6 vertical/paid offer are **commercial decision gates**, not reasons to delay the technical skeleton or continue debating architecture. They must be honest and visible before committing to a product launch or significant acquisition spend, but Plan 6 can document placeholders and owner sign-off states now.

The 230-endpoint/58-table full disposition exercise, a comprehensive review scorecard, and extensive supporting appendices are not structural prerequisites for starting the MVP. Restrict traceability to the selected MVP vertical and shared cross-cutting controls; classify the rest as out of launch scope. This is the largest scope reduction needed to respect the user's instruction not to spend more time in review loops.

---

## 2. What the attached reviews got right

Keep these findings, with the qualifications below:

| Finding | Verdict | Minimum action |
|---|---|---|
| C2 atomic enqueue path is not explicit | **Valid, but the DBOS-option criticism is overstated** | Verify the pinned TypeScript SDK type and behavior; keep the business write and enqueue in one transaction; write the conflict path. |
| C3 fencing mechanism is not named | **Valid** | One worker Machine, worker-only executor ID, one-at-a-time stop/replace/start procedure, and a forced-Machine-replacement acceptance test. Avoid building a custom distributed coordinator for a single worker. |
| C4 wallet lacks lifecycle and provider-attempt accounting | **Valid and release-critical** | Add reservation and provider-attempt state machines, bounded per-run spend and retry policy, expiry/reconciliation, and crash tests. |
| C5 external exactly-once language overclaims | **Valid and release-critical** | Model operation versus attempt; replay inspects persisted attempt state first; uncertain provider outcomes are quarantined, not blindly resent. |
| C1 economics only provides formulas | **Valid as a commercial gap** | Produce a small parameterized model with explicit illustrative assumptions and an unmeasured column. Do not fabricate benchmark results or claim profitability. |
| C6 lacks a single vertical and a concrete paid offer | **Valid as a product decision gate** | Name a recommended beachhead and a paid-pilot hypothesis; record owner approval as pending if the owner has not selected it. |
| C3's `DBOS__VMID` appears app-wide in the config sketch | **Valid** | Set the executor identity only in the worker process command/runtime configuration, never in the app-wide `[env]` block. |
| C4 spend-cap unit is unclear | **Valid** | Use a monetary ceiling in integer micro-units plus input/output token ceilings and a maximum provider-attempt count. |
| C3 fencing needs a concrete Fly mechanism | **Valid** | Configure and test a serial worker rollout; do not treat an advisory lock alone as perfect fencing. |
| C6 needs acquisition and differentiation detail | **Valid** | Include why this vertical would switch from its current stack, one repeatable acquisition wedge, and 2–3 testable channel hypotheses. |
| Step 1 dispositions precede vertical selection | **Valid** | Inventory first; assign MVP dispositions only after the vertical recommendation is made. |
| Step 8 is too large to audit as one item | **Valid, low severity** | Split it into a few domain workstreams or a checklist. Do not create another elaborate project-management framework. |
| Endpoint/table inventories need fixed columns | **Valid for MVP scope only** | Use a compact route/behavior matrix for launch-critical surfaces. Do not require a fully annotated audit of all 230 routes and all 58 tables before coding. |
| Owner inputs conflict with “no blocking open questions” | **Valid wording issue** | Mark owner-dependent items as “designed; decision pending owner,” not “closed.” These inputs need not block drafting V2.1. |
| Item 7 migration/adoption lacks wake-time facts | **Valid, but likely avoidable under clean start** | Inspect the actual `workflow_runs` schema. If durable due time cannot be reconstructed, state notify-only; do not invent an adoption path. |
| Migration tool and exact database grants are missing | **Valid; pre-launch** | Name one migration tool and show the runtime/migrator/readonly grants, including DBOS transaction-completion tables. |
| Provenance labels and final report are incomplete | **Valid, but keep lightweight** | Label material claims; state explicitly that no tests or benchmarks ran; include a concise decision checklist once. |
| “Exactly-once” ban is too broad | **Valid** | Ban unqualified exactly-once claims for external provider effects. Internal transaction guarantees may be stated when the DBOS/database mechanism is named. |
| V2 should be modified with a superseded-by pointer | **Reject** | Plan 6 says V1 and V2 stay byte-identical. Keep them immutable; make V2.1's header and an index/changelog identify it as the successor. |

---

## 3. Findings that need correction before Plan 6 execution

### B1. C2 — fix the handler contract, not the architecture choice

**Do not discard `enqueueInTransaction`.** It is the important atomicity property in V2. The current official DBOS TypeScript Client reference documents:

- `workflowIDReusePolicy` on `enqueue`, defaulting to `return-existing`;
- `enqueueInTransaction` as the same enqueue operation inside a caller-owned transaction;
- `duplicationPolicy: 'return-existing'` as unsupported for `enqueueInTransaction`;
- a requirement that the passed `Client`/`PoolClient` be connected to the DBOS system database.

The page's prose and displayed TypeScript interface are not perfectly aligned: the prose describes `workflowIDReusePolicy`, but the displayed `ClientEnqueueOptions` interface omits it. Plan 6 should require a compile check against the exact package version in the lockfile and a real-Postgres integration test. It must not claim the option is verified solely from the prose.

**Minimum handler shape to document:**

1. Derive a stable idempotency/business-event key from the authenticated provider event or user submission. Scope it to the provider/account/tenant as appropriate; never accept a tenant ID from untrusted payload fields as the authority.
2. Begin one Postgres transaction on the DBOS system database connection.
3. Insert the durable business-event/idempotency row with a unique constraint and `ON CONFLICT DO NOTHING RETURNING ...`.
4. If the insert returned a new row, perform the associated business mutation and call `enqueueInTransaction` on the same connection using a deterministic workflow ID. Use `workflowIDReusePolicy: 'return-existing'` only if the pinned SDK's TypeScript type and runtime test confirm it is accepted. Do not use queue `duplicationPolicy: 'return-existing'` here.
5. If the insert returned no row, do not enqueue again. Read the existing event/workflow status and return the existing operation response. Commit the read-only duplicate path normally.
6. Commit. If any write/enqueue operation fails, roll back both the business mutation and enqueue. Do not acknowledge successful work before commit.

**Important:** The unique business-event row is the primary duplicate gate. It is not enough to say “the workflow ID makes the enqueue idempotent.” The implementation must prove that two concurrent submissions produce one business event and one workflow, and that the losing request returns the existing result/status without another provider call.

**Retention rule:** Workflow-history retention and business idempotency retention are separate. Do not delete the durable idempotency key just because DBOS workflow history is deleted after 30 days. Keep the event/tombstone for the provider's retry horizon and the product's duplicate-submission policy. After tombstone expiry, explicitly define that a repeated event is treated as new or rejected; never leave this accidental.

### B2. C3 — one worker, one identity, one serialized replacement path

For the MVP, do not build a multi-worker coordinator, Conductor dependency, or elaborate fencing service. Keep the one-worker model and make its operating rule enforceable:

- Exactly one worker Machine at launch, in one region.
- `DBOS__VMID=worker-1` is set only for the worker process; it is not an app-wide environment variable inherited by web Machines.
- Explicitly configure a one-at-a-time Fly rollout for the worker group. The current Fly configuration reference describes `rolling` as taking down and replacing Machines one by one; `canary` starts a new Machine before continuing with rolling, `bluegreen` runs new Machines alongside old ones, and `immediate` replaces Machines without waiting for health checks. For a shared fixed executor ID, avoid canary/bluegreen and do not describe `immediate` as a fence.
- If the actual Fly process-group deployment cannot prove stop-before-start, use a controlled stop → verify old Machine is stopped → start replacement procedure. Keep this operator-controlled for the first worker rather than inventing a new deployment control plane.
- Worker boot must fail closed if it cannot connect to the DBOS system database or register its identity. Loss of the DBOS database connection must stop new external side effects and make the worker unhealthy; it must not keep executing as an uncoordinated executor.
- Graceful shutdown stops accepting new work, lets bounded in-flight steps reach a safe point, persists any uncertain provider attempt, and exits before Fly's kill timeout.

A DB advisory lock can be an additional guard, but it is not sufficient by itself to prove no duplicate external action: a broken DB connection can release the lock while a process or already-issued network request remains alive. Do not describe a lock as a perfect fencing token unless every side-effect path is actually fenced and that behavior is tested.

**Phase 0 proof gate:** force-replace/kill the worker Machine while a workflow is pending and while a provider call is in flight. Demonstrate that only one executor with `worker-1` is active, the replacement recovers the correct DBOS workflows, and no external request is repeated blindly. A clean process restart is not an adequate substitute for a Machine-replacement test.

### B3. C4/C5 — separate the business operation from every provider attempt

The attached reviews correctly identify that a one-time wallet reservation does not cap platform spend if a non-idempotent model call is replayed many times. Fix the design with a small state model, not a custom billing platform.

**Operation record:** one stable `operation_id` per business intent (for example, one agent turn, one outbound message, one payment attempt). It owns tenant IDs, purpose, model/provider, budget ceiling, customer billing state, and terminal result.

**Attempt record:** zero or more attempt rows under an operation, each with its own `attempt_id`, sequence, provider, request fingerprint, idempotency key if supported, started/finished timestamps, provider request/object IDs, result/usage metadata, and outcome.

**Minimal attempt states:** `prepared → dispatching → succeeded | failed | uncertain`. `uncertain` is not a synonym for failed. A timeout after the request may have reached a provider must not be automatically retried unless a provider idempotency key or authoritative reconciliation path makes that safe.

**Minimal wallet states:** `reserved → settled | refunded | expired`. A reservation can expire/refund automatically only when the system can establish that no billable provider attempt occurred. For an uncertain attempt, retain/quarantine the reservation until reconciled or manually resolved; do not refund simply because a worker crashed.

**Spend ceiling:**

- Customer ledger: record exact customer credits/debits with an idempotent key per operation and settlement.
- Platform COGS: set a maximum **USD** budget per run/turn, stored in exact integer minor/micro-units; also enforce max input tokens, max output tokens, and max provider attempts per run. Use a versioned model price table for the estimate.
- Unknown provider outcomes consume an attempt from the run's provider-attempt budget. They do not trigger another call automatically.
- A workflow recovery-attempt count is not a substitute for a provider-call limit. DBOS may recover a workflow without re-running a completed checkpoint, but application code must still bound each costly non-idempotent request.

**Sweeper:** run a bounded, idempotent reconciliation pass on expired reservations. Lock only the target reservation row while transitioning it; never hold a wallet row lock over a network/model call. Expire/refund only records whose attempt state proves no dispatch or whose provider reconciliation proves no charge/action. Leave unresolved attempts in an operator-visible quarantine state.

**Four required crash tests:**

1. Crash after reservation but before attempt dispatch: reservation is safely refunded/expired; no provider call occurred.
2. Crash after the durable `dispatching` write but before the request is known to have reached the provider: state becomes uncertain; no blind retry; platform spend remains within the attempt/run ceiling.
3. Provider accepts/charges the request, then the process crashes before local success settlement: recovery inspects the attempt first, does not issue a duplicate, and leaves customer billing/COGS reconciliation explicit.
4. Crash after settlement commits but before workflow completion: replay does not double-settle or double-charge because settlement is keyed uniquely by operation/attempt.

For Stripe/Square or another provider with documented idempotency, re-use the same key and same request body within the provider's documented retention window. For Twilio, Chatwoot, Vapi, or AI requests without a documented suitable idempotency/reconciliation facility, state the trade-off plainly: the product may need to choose at-most-once dispatch with an uncertain/manual resolution path over automatic retry. Never promise exactly-once external delivery from a local marker table alone.

### B4. C1/C6 — treat economics and vertical choice as business gates, not an endless architecture exercise

The plan is right to require a model, but the model should be a small decision aid rather than a second financial research project.

- Model only the proposed launch offer: agency subscription + platform AI credits + BYO messaging/voice. A managed-messaging case can be a clearly labeled future sensitivity, not a parallel launch architecture.
- Include 10/50/100/500/1,000 agencies, with explicit assumptions for locations per agency, paid seats, AI turns, average token use, model mix, credit price, support hours, payment fees, infrastructure, churn, and acquisition cost.
- Show MRR, variable COGS, contribution margin, estimated break-even, and the expensive-tenant tail: an autonomous 24/7 inbox with unusually high model usage.
- Show checkpoint counts at 10k/100k/1M/10M workflow executions only as a formula-based projection until real workflow traces are measured. Include a `measured?` column. Likewise compare DBOS and pg-boss cost per 10k/100k only where inputs are available; label all unknown multipliers as assumptions.
- Do not invent measured model costs, conversion rates, churn, customer acquisition costs, or willingness-to-pay. Placeholder calculations are not evidence of profitability.

For C6, make one recommended vertical and offer specific enough to test: customer profile, painful workflow, included/excluded capabilities, pilot duration, price hypothesis or bounded price range, and 2–3 acquisition experiments with a measurable decision rule. The existing V2 bar of **10 paid pilots at a stated price** is the willingness-to-pay test; surveys and verbal interest do not close it. If the owner has not approved a vertical or price, V2.1 must mark the recommendation `owner approval pending`. This does not block technical implementation of the core, but it does block claiming the commercial wedge is validated or committing to a broad launch.

---

## 4. Plan 6 scope reduction — what is actually needed for the MVP

Plan 6 currently asks Muse to enumerate all 230 endpoints and classify all 58 tables before choosing the vertical, then complete many other deliverables in one mega-step. That is too much work for a correction document and risks delaying implementation without changing the first release.

Use this smaller order:

### Step 0 — source and working-tree sanity

- Read `docs/plans/v2.1_review.md` in the local checkout, plus V2, V1, `plan5.md`, and the attached `plan6_review.md`.
- Confirm that the C1–C6/M1–M18 IDs, their acceptance criteria, and the correction order match the source review. Do this once. If the local review file is missing, record that as a provenance gap and use only the acceptance criteria available in the attached review; do not silently claim full compliance.
- Record branch, SHA, status, and whether the V2.1 output path already exists. Keep V1 and V2 byte-identical.
- Capture repo facts needed for launch decisions. Do not assign endpoint/table MVP dispositions until the vertical recommendation is made.

### Step 1 — close the load-bearing technical design

- C2: write the exact transaction handler and duplicate response path; verify the pinned SDK option/type; define idempotency retention.
- C3: define the single-worker Fly configuration and serial replacement process; specify the Phase 0 Machine replacement test.
- C4/C5: define operation/attempt and wallet states, per-run cost/attempt ceilings, uncertain-outcome policy, and four crash tests.
- M1: count each connection pool separately, including Hono, DBOSClient, the web transaction pool, worker system pool, datasource pool, and one-shot migration/admin connections. Use the actual configured pool sizes; the current DBOS TypeScript Client reference states a default `systemDatabasePoolSize` of 10 when a custom pool is not supplied. Include per-Machine multiplication and headroom. Do not claim an observed Neon limit without accessing the actual project.

### Step 2 — define the smallest sellable product

- Recommend one vertical from the repository's actual usable flows and plausible customer pain; do not use a schema comment as market proof.
- Specify the paid-pilot hypothesis and acquisition tests. Mark owner approval and paid-pilot evidence as pending until actually obtained.
- Only now classify launch-critical routes and tables. Use a compact route matrix for auth, agency/location access, lead/contact capture, inbox/webhook, booking, automation follow-up, agent reply, billing/wallet, and provider credentials/consent. Other product areas can be marked `not in MVP / retained unpromoted` in grouped form.
- Do not require a 230-row line-by-line route audit and a 58-row table disposition before implementing the first vertical. A complete generated inventory can be retained as a later audit artifact if it does not delay the MVP.

### Step 3 — close minimum operational and migration requirements

- M2/M3: region selection procedure plus owner decision; Chatwoot hosting remains `unknown` until confirmed. Do not infer self-hosting from `.env.example`.
- M4: specify only the journey lifecycle required for the MVP. It needs durable due time, tenant/contact identity, definition version, status, cancellation/reschedule/expiry rules, and a safe stale-contact/consent re-check. Benchmark designs at 10k/50k/100k can be documented as later scale gates, not run now.
- M5/M6: state the tenant-fairness property, the noisy-tenant test, and the rule for tuning concurrency from observed DB connections, provider rate limits, and queue age. Leave numeric concurrency unconfigured until measurements exist.
- M7: retain a simple pinned-version/patch review discipline. No old-version fleet or multi-worker versioning machinery at launch.
- M8: split the roadmap into a few actual phases with dependency, acceptance gate, user value, operational cost, and rollback. Keep launch scope small.
- M10: read the actual `workflow_runs` schema. If it does not persist a recoverable wake timestamp, choose notify-only for old waits; do not build an adoption script that guesses due time. If it does persist one, only then describe a minimal idempotent adoption script.
- M11/M12: minimum worker readiness/heartbeat and failure alerts; name the migration tool and specify grants by role/table/schema, explicitly including `transaction_completion` if the runtime uses it.
- M13/M14/M15: retain per-location Chatwoot secrets and inbox registry; enforce opt-out/consent checks before every message send; document credential encryption and subscription/payment-failure lifecycle at the level needed for launch.
- RLS remains explicitly deferred unless a real customer/compliance requirement makes it a launch gate.

### Step 4 — evidence, audit, and assembly

- Use the six provenance labels consistently. `executed-test` must be absent or explicitly stated as zero in this planning pass; no test was run merely because a test was designed.
- Define or remove the unexplained word `federation`.
- Reconcile the V2 capability counts in §2 with Appendix R; do not carry forward contradictory totals.
- State when `resume`, `fork`, and `rewind` are appropriate. For launch, it is acceptable to say `rewind` is not permitted until a datasource-specific recovery procedure is tested.
- Correct the §2.1 handler reference to the actual V2.1 §7.1 location.
- Include a small rejection/qualification register for the contested alternatives that matter: outbox pump, hybrid pg-boss/DBOS, custom DLQ/admin UI, per-tenant cutover flags, queue `duplicationPolicy: 'return-existing'` inside `enqueueInTransaction`, and Fly `immediate` as a fencing mechanism. Clearly distinguish `duplicationPolicy` from `workflowIDReusePolicy`.
- Put the scorecard in an appendix, name `docs/plans/v2.1_review.md` as the source of the C/M acceptance criteria, and label the table an author self-audit unless a genuinely independent reviewer performs it. Do not imply independent approval that did not happen.
- Record owner approvals by role and date when received; never invent a person's name or approval.
- Produce the requested 12-item final report once. No further review document is required before implementation unless a new structural defect appears.

---

## 5. Net-valid findings to keep, qualify, or defer

### Keep as pre-implementation / design blockers

| Item | Required result before implementation of the corresponding path |
|---|---|
| C2 | Atomic business-write + `enqueueInTransaction` pattern, deterministic ID, unique business key, duplicate response behavior, SDK type check, real-Postgres race test design. |
| C3 | Worker-only VMID, one worker Machine, explicitly serialized replacement, no overlapping executor IDs, forced-Machine-replacement test. |
| C4 | Wallet reservation lifecycle, provider-attempt lifecycle, USD/token/call caps, retry bounds, sweeper, uncertain reservation handling. |
| C5 | Replay-inspects-first protocol; provider idempotency windows; quarantine for uncertain non-idempotent outcomes; remove unsupported external exactly-once claims. |
| Tenant and communications safety | Agency/location scoping, authenticated webhook mapping, per-location Chatwoot secrets/registry, consent and suppression re-checks before each outbound message. |

### Keep as pre-launch gates, but do not block the architecture document or core implementation

| Item | Required before |
|---|---|
| C1 economics | Before pricing, provider-funded usage, or scaling decisions. The model may use explicit placeholders until pilot and telemetry evidence exists. |
| C6 vertical and paid offer | Before freezing product scope and spending materially on acquisition. Owner sign-off required; 10 paid pilots at stated price validate willingness to pay. |
| M1 pool budget | Before staging/load acceptance and production sizing. Initial pool sizes can be conservative placeholders with no claimed capacity. |
| M2 region | Before provisioning production Fly/Neon resources. |
| M3 Chatwoot hosting | Before operational ownership/cost claims and public webhook deployment. |
| M4 scale benchmarks | Before promising or selling high-volume journey capacity; not before a basic delayed follow-up workflow. |
| M7 versioning | Before DBOS production deployment. |
| M10 legacy wait adoption | Only if live production state exists and Strategy A is not confirmed. Otherwise notify-only/clean-start. |
| M12 grants/migration tool | Before production migration/release. |
| M13/M14 consent and credentials | Before customer credentials or outbound messaging go live. |
| M15 billing/dunning | Before charging customers. |

### Defer or reduce for MVP

- Full 230-endpoint traceability: trace only launch-critical and cross-cutting endpoints now; group the rest as outside MVP.
- Full 58-table lifecycle design: classify only tables touched by MVP features and explicitly leave unrelated feature tables untouched/unpromoted.
- Full managed-messaging scenario: launch model is BYO messaging plus metered platform AI; managed messaging remains future sensitivity.
- Extensive admin UI, Conductor, multi-worker recovery, RLS rollout, object-storage migration, multi-region, all GoHighLevel parity features: not MVP requirements.
- Benchmark execution and production connection-limit claims: specify the procedure, run it in the actual environment before scale, and do not report results until observed.

---

## 6. Findings from the attached reviews that should not be copied blindly

1. **“`workflowIDReusePolicy` cannot be used with `enqueueInTransaction`.”** The official DBOS Client prose says `enqueueInTransaction` uses the same parameters as `enqueue` except `duplicationPolicy: 'return-existing'` is unsupported. The docs' displayed interface omission makes pinned-package compilation important, but the attached review's categorical rejection is not supported by the prose reference.
2. **“Replace `enqueueInTransaction` with `enqueue()` to use return-existing.”** Reject. This would lose the single-transaction property unless an outbox/reconciliation mechanism is added. Do not trade away atomicity to simplify a duplicate path.
3. **“A DB advisory lock is the strongest fence.”** Not automatically. Loss of the DB session can release a lock while a stale process or an already-issued network request remains active. Use Fly Machine lifecycle serialization as the primary one-worker mechanism; treat any lock as defense in depth and fail closed on loss.
4. **“C6 must be fully closed before V2.1 can be written.”** Reject. The document can give a recommendation and mark owner approval pending. Commercial launch and acquisition spend must wait for that decision; drafting and technical spikes need not.
5. **“All 230 endpoints and 58 tables must be fully dispositioned before implementation.”** Reject for MVP. It is disproportionate to a single-vertical launch. Do exhaustive traceability only for the selected vertical's critical routes and the shared security/money/side-effect boundaries.
6. **“V2 must be edited to point to V2.1.”** Reject to preserve Plan 6's byte-identical requirement. Keep V2 immutable; make the successor relationship explicit in V2.1 and a plans index/changelog.
7. **“No additional questions means all C/M findings can be called closed.”** Reject. Owner-dependent decisions are `pending owner`; unknown operational facts are `unknown`; an assumption is not a verified closure.

---

## 7. Minimum amendments to Plan 6 before handing it back to Muse

Make only these edits:

1. **Step 1:** change endpoint/table enumeration to inventory-only; defer MVP dispositions until after the vertical recommendation. Limit detailed traceability to MVP-critical routes and shared cross-cutting controls.
2. **Step 2:** move the handler to V2.1 §7.1; keep `enqueueInTransaction`; distinguish `workflowIDReusePolicy` from `duplicationPolicy`; require compile verification against the pinned SDK, unique business-event insertion, enqueue-only-on-new-row, duplicate response lookup, and durable idempotency retention. Do not assume the DBOS option is invalid or verified until compiled/tested.
3. **Step 3:** name the one-worker Fly lifecycle as the fencing mechanism: one Machine, worker-only VMID, one-at-a-time rolling or operator-controlled stop/verify/start, no canary/bluegreen/immediate for this group, forced replacement test. No custom fencing service for MVP.
4. **Step 4–5:** use the operation/attempt hierarchy; monetary cap in USD micro-units plus token and attempt caps; no refund of uncertain provider outcomes; add the four crash tests; no unsupported external exactly-once language.
5. **Step 6:** model the actual launch mix (platform AI + BYO messaging) first. Include explicit placeholders and the 24/7 high-usage tenant tail. Do not let fabricated economics masquerade as measured profitability.
6. **Step 7:** show all pools separately, including DBOSClient's default pool (currently documented as 10 absent a custom pool) and per-Machine multiplication.
7. **Step 8:** split into four short workstreams (product/offer; operations/security/billing; journeys/queues/traceability; migration/versioning). Mark owner approvals pending where necessary. C6 must specify one recommended vertical, pilot offer, acquisition hypotheses, differentiation/switching-cost logic, and the 10-paid-pilot validation bar.
8. **Step 10–12:** name the source review and scorecard, put the author's audit in an appendix, name the contested alternatives in the rejection register, state `executed-test = none in this pass`, and produce the 12-item report once. Keep the existing no-source/schema/test/infrastructure-change boundary.
9. **Wording:** remove “no blocking open questions” if owner decisions remain. Say “no questions block drafting; named owner decisions gate production/commercial launch.” Change “correction pass, not rewrite” to “targeted V2.1 correction revision preserving the V2 architecture and §7 direction.”

Everything else can be retained or shortened. Do not add a new review phase after these amendments.

---

## 8. Final disposition

**Plan 6 status: APPROVABLE AFTER THE NINE NARROW AMENDMENTS ABOVE.** These are amendments to the plan, not a request for another full review cycle.

**Implementation rule:** Once Muse incorporates the amendments, let it produce V2.1. Then begin with the C2/C3 prototypes and C4/C5 safety tests in Phase 0. Continue into the smallest vertical MVP. Do not wait for exhaustive route/table cataloging, real-world scale benchmarks, a managed-messaging forecast, Conductor, or a second independent review.

**Stop condition for further review:** Reopen architecture review only if a prototype demonstrates one of the following: atomic enqueue cannot be made safe with the pinned DBOS SDK; Fly cannot maintain one active worker executor under the selected deployment process; a provider side effect can be duplicated without a bounded/quarantined recovery path; or tenant isolation/consent cannot be enforced on the MVP path. Documentation polish, additional scorecard granularity, and deferred GoHighLevel features are not reasons to reopen the review.

---

## Sources checked for the disputed API/deployment claims

- DBOS TypeScript DBOS Client reference: https://docs.dbos.dev/typescript/reference/client — `workflowIDReusePolicy`, `duplicationPolicy`, `enqueueInTransaction`, system database pool size. Accessed 2026-11-14.
- DBOS TypeScript methods reference: https://docs.dbos.dev/typescript/reference/methods — `DBOS.startWorkflow` workflow-ID reuse behavior. Accessed 2026-11-14.
- Fly `fly.toml` configuration reference: https://fly.io/docs/reference/configuration/ — rolling, canary, bluegreen, immediate deployment semantics; rolling `max_unavailable`. Accessed 2026-11-14.
