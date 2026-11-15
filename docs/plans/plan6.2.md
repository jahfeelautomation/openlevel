I've reviewed the uploaded V2.1 architecture and its amended execution plan.

**My verdict: V2.1 is approved as the working architecture for Phase 0\. I found no reason to restart the architecture review or rewrite the document.**

The important distinction is that the architecture is design-complete, not yet operationally proven. The next step should be prototypes and failure testing—not implementation of the entire SaaS.

## **What I verified**

Three important decisions survived independent checking:

1\. **DBOS atomic enqueue:** The distinction between `workflowIDReusePolicy` and `duplicationPolicy` is correct. The official TypeScript documentation describes the workflow-ID reuse policy but omits it from the displayed `ClientEnqueueOptions` interface. It also explicitly prohibits `duplicationPolicy: 'return-existing'` in `enqueueInTransaction`. V2.1 correctly treats compilation against the pinned SDK as a gate.

DBOS Docs+2

2\. **Fly worker replacement:** The current Fly documentation describes rolling deployment as taking down and replacing running Machines one by one. That supports V2.1's stop-then-start design. I recommend explicitly setting `max_unavailable = 1` and verifying the actual deployment behavior in staging.

Fly Docs

3\. **Connection budgeting:** DBOS officially documents a default system database pool size of ten for `DBOSClient`. V2.1 explicitly sizes its pools instead, which is the better approach for predictable connection budgeting.

DBOS Docs

## **Three corrections to carry forward—not another review cycle**

These do not justify delaying Phase 0\.

* **C2 payload consistency:** When an existing business-event key is submitted with a different payload hash, return a conflict and record the discrepancy. Do not silently return the original workflow status as though the payloads matched.  
* **C1 profitability:** The illustrative contribution table does not appear to include the \$150 CAC and 5% monthly churn in its calculations. It also needs to clarify whether the \$15 usage margin incurs additional Stripe fees. Do not use its 86–88% margins as validated business economics.  
* **M6 queue tuning:** Convert provider requests-per-minute into a concurrency bound using measured request duration. RPM and concurrent jobs are different units. Keep concurrency unconfigured until measured, as the document already recommends.

The missing numeric DBOS-versus-pg-boss cost comparison and incomplete route inventory can be completed when actual execution measurements and implementation work make them useful.

## **The next instruction to Muse**

Proceed to Phase 0

I recommend giving Muse this instruction. It deliberately limits the next work to proving the critical mechanisms.

# **PHASE 0 EXECUTION DIRECTIVE — OpenLevel V2.1**

The V2.1 architecture is now the controlling technical specification.

Do not conduct another general architecture review. Do not rewrite V2.1. Do not expand the product scope.

Your assignment is to execute Phase 0 from V2.1 §17, concentrating on the three prototype gates P1, P2, and P3.

## **1\. Establish the baseline**

* Confirm the current repository branch, commit, and working-tree status.  
* Preserve V1, V2, V2.1, and all planning documents.  
* Install or provision the existing project toolchain only as necessary.  
* Run the existing typecheck, lint, and test suites.  
* Record actual passing and failing tests.  
* Identify existing failures separately from regressions.  
* Resolve the exact installed DBOS SDK version from the lockfile.

Do not claim a green baseline unless the commands actually pass.

## **2\. P1 — Prove atomic enqueue and duplicate handling**

Implement a minimal isolated prototype of the V2.1 §7.1 handler.

Use real PostgreSQL and the pinned TypeScript SDK.

Prove:

* Two simultaneous requests with the same business key create one business event.  
* Only the winning transaction enqueues a workflow.  
* The losing request returns the existing workflow status.  
* A transaction rollback leaves neither a business event nor a workflow.  
* A duplicate after workflow completion still returns the existing result.  
* A duplicate after workflow-history deletion still converges through the retained business-event record.  
* A duplicate after idempotency-record expiration follows the documented new-event policy.  
* Reusing the same business key with a different payload hash returns a conflict rather than silently accepting the original event.

Compile-check `workflowIDReusePolicy` against the actual installed SDK. If the option is not accepted, do not patch around the type system or substitute non-transactional enqueue. Follow V2.1's application-level deduplication fallback.

**Acceptance:** one committed business event, one workflow execution, and no duplicate external provider calls under concurrent submission.

## **3\. P2 — Prove single-worker recovery and Fly fencing**

Use a staging Fly application with one worker Machine.

Verify:

* `DBOS__VMID=worker-1` exists only in the worker boot path.  
* Missing or invalid worker identity prevents worker startup.  
* Rolling replacement with one worker does not allow overlapping executors.  
* Explicitly configure `max_unavailable = 1`.  
* SIGTERM stops new dequeues and allows bounded shutdown.  
* A forced Machine replacement during an active workflow recovers correctly.  
* A forced replacement during a simulated provider call does not blindly repeat the operation.  
* Heartbeat monitoring detects an unavailable or dead worker.

Capture Fly Machine states, deployment events, executor identity, DBOS workflow history, and provider-attempt records.

A graceful process restart is not a substitute for forced Machine replacement.

**Acceptance:** exactly one active executor identity, recoverable workflow history, and no uncoordinated provider retry.

## **4\. P3 — Prove wallet and provider-attempt safety**

Implement the minimum test harness needed to exercise V2.1 §§8 and 12\.

Use a controllable fake provider with fault injection.

Test all four crash scenarios:

1. Crash after reservation but before dispatch.  
2. Crash after the durable dispatching record but before the outcome is known.  
3. Provider accepts the request, followed by a crash before settlement.  
4. Crash after settlement but before workflow completion.

Also test concurrent turns exhausting one agency wallet.

Verify:

* No double settlement.  
* No negative wallet balance.  
* Unknown external outcomes enter quarantine.  
* Quarantined attempts are never automatically retried.  
* Per-run dollar, token, and attempt caps are enforced.  
* The expiry sweeper cannot refund a potentially dispatched operation.  
* Operator reconciliation can resolve uncertain operations without creating another provider request.

**Acceptance:** customer billing and provider COGS remain within their defined budgets, with ambiguous external outcomes explicitly visible.

## **5\. Scope restrictions**

Do not implement the full agency control plane, all 230 routes, campaign expansion, white-labeling, snapshots, RLS rollout, multi-worker operation, or Conductor integration in this phase.

Do not migrate or delete existing pg-boss functionality before the relevant prototypes pass and the Strategy A owner confirmation has been recorded.

Use isolated prototype code and tests where possible. Keep the implementation small enough to discard or incorporate deliberately.

## **6\. Final report**

Deliver a concise Phase 0 report:

* Baseline results.  
* Exact DBOS SDK version.  
* P1 result and evidence.  
* P2 result and evidence.  
* P3 result and evidence.  
* Failures and unresolved risks.  
* Actual Fly and Neon connection observations, where accessible.  
* Required fixes to V2.1, limited to demonstrated problems.  
* Recommendation: proceed to Phase 1, fix a prototype, or stop.

No unverified claims. No cosmetic architecture rewrites.

**Stopping rule:** once P1, P2, and P3 pass, proceed to implementation. Reopen architectural decisions only when a prototype demonstrates a genuine correctness, security, recovery, or economic failure.

## **What happens after Phase 0**

The sequence should be:

1. **Phase 0 — Prove the foundations**  
   Atomic enqueue, worker recovery, wallet and provider safety.  
2. **Phase 1A — Build the agency and billing foundation**  
   Agencies, membership, subscriptions, entitlements, wallet and metering.  
3. **Phase 1B — Build provider onboarding**  
   Encrypted credentials, OAuth, consent and tenant-specific connections.  
4. **Phase 2 — Implement the durable product core**  
   CRM, inbox, agent replies, follow-up automation and durable journeys.

One final point: the roofing beachhead and pilot offer are still awaiting your approval. They should be resolved before acquisition spending, but they need not hold up local prototypes.

**My recommendation is to stop reviewing the architecture and start proving it.** The next meaningful decision should come from P1, P2 and P3 results—not another round of speculative document criticism.

**My consolidated verdict: proceed with Phase 0\. Do not restart the architecture review.**

The two attachments agree on the important point: V2.1 is design-complete, but not proof-complete. Most of their remaining findings are documentation improvements or details that can be resolved during Phase 0\.

I would add only a small supplement to the Phase 0 directive, addressing two genuine implementation-safety gaps: C2's duplicate response after workflow-history retention, and C3's actual deployment-readiness proof.

## **Which findings I accept**

| Finding | Decision |
| ----- | ----- |
| C2: existing business event needs a durable status/result projection | Accept. Important for idempotency after DBOS history deletion. |
| C2: same key with a different payload hash | Accept. Return conflict; do not silently treat it as the same request. |
| C2: test default workflow-ID reuse and omitted `duplicationPolicy` | Accept. Must compile and run against the pinned SDK. |
| C3: test an actual rolling deployment while a workflow is running | Accept. The existing forced-replacement test alone does not prove the deployment path. |
| C3: worker health check and explicit restart policy | Accept as Phase 0 configuration/proof work. |
| C3: mandatory PostgreSQL advisory-lock service | Reject for now. It is unnecessary complexity unless the actual deployment test demonstrates overlap. |
| R5: bounded database-pool waiting and backpressure | Accept as a small operational acceptance test, not an architecture redesign. |
| C1: clarify usage revenue, Stripe fee arithmetic, CAC and churn | Accept, but defer commercial-model correction until before pricing approval. |
| C4: make the provider-success/crash test numerically verifiable | Accept. |
| `setWorkflowDelay` is an unsupported API | Reject. The current official TypeScript client reference documents it. Still compile-check against the pinned SDK. DBOS Docs |
| Expand the final report, rejection register, full route inventory, split the old planning mega-step | Defer. These do not justify delaying prototypes. |
| Reconstruct historical wait timestamps | No change. Notify-only remains the safer MVP migration policy. |

One important technical clarification: Fly's official configuration documentation says rolling deployment takes down and replaces running Machines one at a time; `max_unavailable = 1` enforces one-at-a-time unavailability. That supports V2.1's intended approach. It does not justify assuming the deployment is already proven, so we should test the real deployment window.

Fly.io+1

## **Additional prompt for Muse**

This is the only addendum I recommend. It supplements the previous Phase 0 directive; it does not replace it.

# **PHASE 0 ADDENDUM — CLOSE THE REMAINING C2/C3 SAFETY GAPS**

This is a narrow supplement to the existing Phase 0 execution directive.

Do not conduct another architecture review. Do not rewrite V2.1. Do not introduce a custom fencing service, advisory-lock coordinator, new infrastructure, or additional product scope without evidence that the existing design fails.

The goal is to close the following implementation details while executing P1, P2, and P3.

## **1\. P1 — Durable duplicate-response semantics**

The V2.1 §7.1 handler needs an explicit answer for a duplicate event after DBOS workflow history has been deleted but the business-event idempotency record is still retained.

Specify and prototype a minimal `business_event` persistence contract, including:

* Unique authenticated business-event key.  
* Agency and location identifiers.  
* Payload hash.  
* Stable workflow ID.  
* Accepted timestamp.  
* Last-known operation/workflow state.  
* Compact terminal response or result reference.  
* Retention policy independent of DBOS workflow-history retention.

Duplicate behavior:

1. Same event key and same payload hash: return the existing operation ID and last-known status/result.  
2. Same event key and different payload hash: return HTTP 409 and record the discrepancy.  
3. Existing event with DBOS history still present: inspect DBOS status using the supported client API and update the local projection as appropriate.  
4. Existing event with DBOS history already deleted: return the retained local status/result projection. Never enqueue again.  
5. Existing event with unexpectedly missing DBOS history and no reliable local result: report an integrity/reconciliation condition. Never silently create a replacement workflow.  
6. Expired idempotency tombstone: follow the explicitly documented event-expiration policy.

The local projection is authoritative for the duplicate-response contract after DBOS history retention. DBOS history remains the execution record while it exists.

Compile and test the exact pinned SDK behavior:

* `enqueueInTransaction` with no `duplicationPolicy` option.  
* Fixed workflow ID collision behavior.  
* `workflowIDReusePolicy` acceptance or rejection by the installed TypeScript types and runtime.  
* No reliance on `duplicationPolicy: 'return-existing'` inside `enqueueInTransaction`.  
* No unsafe type casts merely to force an undocumented API option.

Do not replace transactional enqueue with plain `enqueue()`.

**Acceptance:** concurrent identical requests create one business event and one workflow; same-key/different-payload requests conflict; duplicates after DBOS history deletion still return a truthful existing result without another workflow or provider call.

## **2\. P2 — Prove the actual Fly deployment window**

Retain V2.1's single-worker design.

Use the documented Fly rolling strategy with:

* `strategy = "rolling"`.  
* `max_unavailable = 1`.  
* Worker-only `DBOS__VMID=worker-1`.  
* Explicit worker-process restart policy, selected from official Fly documentation and verified in staging.  
* A worker-specific readiness/health check that reflects actual DBOS worker readiness, not merely an open process or a recent heartbeat row.

Fly supports process-targeted checks and process-targeted restart policies. Use those capabilities rather than adding a separate orchestration service.

Extend P2 to execute an actual automated rolling deployment while:

1. A workflow is executing a normal durable step.  
2. A workflow is inside a simulated provider call.  
3. A workflow has persisted an uncertain provider attempt.

Capture the old and replacement Machine states, timestamps, executor identity, worker readiness, DBOS history, and provider-attempt records.

Prove:

* The old worker is stopped before its replacement executes with the same executor identity.  
* No overlapping active `worker-1` executors exist.  
* The replacement becomes healthy only after worker initialization and required recovery.  
* An in-flight provider call is not blindly repeated.  
* A failed worker process is restarted according to the chosen restart policy.  
* An intentional deployment shutdown does not produce an uncontrolled restart loop.

Do not add a PostgreSQL advisory lock simply because a reviewer proposed one. First test the documented Fly rolling lifecycle. Add a stronger application-level fence only if the observed deployment or forced-replacement behavior demonstrates that it is necessary.

**Acceptance:** the automated rolling-deploy scenario and forced-Machine-replacement scenario both pass without overlapping executor identity or unsafe external retries.

## **3\. Bounded enqueue-pool backpressure**

For the direct pool used by the web transactional-enqueue path:

* Set explicit pool acquisition timeout.  
* Define bounded request handling when the pool is saturated.  
* Do not acknowledge a webhook or public submission before its transaction commits.  
* Return a retryable failure rather than silently dropping an event.  
* Apply appropriate rate limiting before requests exhaust the pool.

Add a small concurrent-inbound test that exceeds configured pool capacity.

Record pool wait time, timeout count, request response, transaction outcome, and whether the source can safely retry.

This is an operational acceptance test, not a reason to redesign the connection architecture.

## **4\. P3 — Make the provider-success crash assertion measurable**

For the scenario in which the provider accepts an operation but the worker crashes before local settlement, assert:

* The simulated provider reports exactly one accepted charge/request.  
* The operation has exactly one stable operation ID.  
* The provider attempt remains identifiable and is not blindly repeated.  
* Wallet reservation and settlement records are uniquely associated with that operation.  
* Recovery does not create a second charge or settlement.  
* Any uncertain result remains quarantined until reconciled.

The five-minute reservation sweeper cadence is provisional until measured. Label it as an assumption, not a validated operating threshold.

## **5\. Commercial-model correction — not a Phase 0 blocker**

Before pricing or paid-pilot approval, correct the V2.1 §13 terminology:

* Rename `usage margin` to `usage revenue` if the \$15 is revenue added to subscription MRR.  
* State explicitly that the displayed Stripe fee calculation applies to the \$249 subscription charge, not the additional \$15.  
* Show CAC payback and churn-adjusted customer economics separately from the current contribution table.  
* Keep the \$400 infrastructure step and the average ten checkpoints per execution explicitly labeled as independent placeholders unless derived from an actual usage mix.

Do not use the current illustrative margin percentages as validated profitability.

## **6\. Scope and stopping rule**

Do not reopen the architecture decision.

Do not add a custom advisory-lock service unless the P2 proof demonstrates a real overlap risk.

Do not expand Phase 0 into full campaign implementation, every-route auditing, managed messaging, Conductor, RLS rollout, or white-label development.

Record the outcomes as Phase 0 evidence and proceed according to the existing directive.

Once P1, P2, and P3 pass, move to the next implementation phase, subject to the existing owner sign-offs. Further architecture review is justified only by a demonstrated structural failure.

**My recommendation:** Send this addendum with the existing Phase 0 directive and proceed. Do not ask Muse for another V2.1 rewrite.

The purpose now is to discover whether the implementation works under concurrency, crashes, and deployment—not to keep perfecting the planning documents.

