# **OpenLevel: review and refreshed roadmap**

The latest report is a meaningful milestone. More importantly, it shows why the reliability work matters: the tests exposed real integration defects that could have caused failed workflows, incorrect crash recovery, or misleading financial evidence.

My recommendation is to **close the current reliability phase without expanding its scope, then move toward a staging deployment and the first commercially useful product journey.** We should not let infrastructure work become the product.

## **1\. My assessment of the attached report**

Local native-database PASS  
Phase 0 not fully closed

The report supports a local pass for the three areas it actually exercised:

* **P1 — Atomic workflow enqueue:** 9/9 passed, including the repeat run.  
* **P3 — Wallet and provider-operation safety:** 11/11 passed, including the repeat run.  
* **Backpressure:** 1/1 passed, including the repeat run.  
* **Crash recovery:** 20/20 SIGKILL trials passed.  
* **Unit tests:** 120/120 passed.  
* **Reconciliation:** all four recorded invariants passed.  
   prompt11\_imp.md

   prompt11\_imp.md

The financial-safety result is particularly important. The final reconciliation recorded 30 provider charges, 30 corresponding log entries, no negative wallets, and no settlement-versus-attempt-cost mismatches. It also retained one reserved operation and one uncertain attempt. That is consistent with the intended safety policy: when an external operation's outcome is uncertain, we preserve the reservation and quarantine the operation rather than blindly retrying it or refunding it.

prompt11\_imp.md

### **The defects discovered were worth finding**

Four substantive problems were uncovered and corrected:

1. The native PostgreSQL adapter incorrectly assumed a returned value was already a structured row instead of normalizing the actual `text[]` result.  
2. The P1 worker relied on a `workflowRunTag` that no producer supplied. That caused database failures and workflows that appeared to time out.  
3. The P3 wallet code had ambiguous PostgreSQL parameter types, which interfered with crash tests.  
4. The reconciliation process lost historical attempt evidence because individual tests truncated their fixture table. The archive now preserves that evidence without weakening the invariant.

These are not cosmetic changes. They strengthen the underlying behavior and the credibility of the test results.

prompt11\_imp.md

### **What this report does not prove**

We must keep three distinctions clear:

* **Native PostgreSQL is proven locally.** This does not prove the Testcontainers path or immutable Docker image verification.  
* **P1, P3, and backpressure were exercised.** The listed test suites do not show a P2 Fly worker replacement acceptance run.  
* **Local integration success is not Fly.io/Neon staging acceptance.** We have not demonstrated the complete deployed system under the intended runtime topology.

The report itself explicitly leaves Docker provenance blocked until CI and says it is evidence rather than the final owner verdict.

prompt11\_imp.md  
prompt11\_imp.md

**My verdict:** record the native P1/P3/backpressure evidence as a local pass. Do not declare Phase 0 entirely complete or authorize production cutover yet.

One housekeeping point matters: the fixes are still uncommitted. Preserve the evidence and failure history, review the actual diff, and commit the relevant work separately from unrelated files. Also correct the stale runtime documents that still claim the Mac cannot start PostgreSQL. The report disproves that claim for this environment.

prompt11\_imp.md  
prompt11\_imp.md

## **2\. The roadmap: where we are going**

The important distinction is that **OpenLevel is not being built to win a feature-count competition with GoHighLevel.**

Our objective is to build a sustainable, multi-tenant SaaS business that gives a particular type of small business a measurable commercial result.

Our current working beachhead is:

**Residential roofing contractors in the US Sun Belt, particularly businesses with approximately two to ten crews.**

Their core problem is straightforward: leads arrive, nobody responds quickly enough, prospects are not qualified, inspections are not booked, and follow-ups get forgotten.

OpenLevel should make that journey reliable and largely automatic.

## **The product we are actually trying to sell**

# **Lead → Booked inspection**

The primary business outcome—not a collection of disconnected CRM features.

1. **Capture the lead**  
   Bring prospects in from forms, websites, and other lead sources.  
2. **Organize the customer**  
   Create the contact, preserve the source, and put the lead into the CRM pipeline.  
3. **Respond immediately**  
   Use the inbox and messaging integrations to engage the prospect.  
4. **Qualify and book**  
   Ask the right questions, establish intent, and schedule an inspection.  
5. **Follow up automatically**  
   Trigger reminders and follow-up workflows when prospects do not respond or appointments need confirmation.  
6. **Use AI where it creates measurable value**  
   Assist with engagement and routine communication, with controlled usage and spending.

**Reusable snapshots** make this entire working setup deployable to another contractor without rebuilding everything.

This is the commercial center of gravity. Other features should support this journey or wait.

## **3\. Updated execution roadmap**

I would organize the work into five stages, with explicit exit conditions.

### **Stage 0 — Complete the reliability foundation**

P1, P3 and backpressure locally passed

| Priority | Work | Exit condition |
| ----- | ----- | ----- |
| 1 | Reconcile Track B evidence and update the evidence matrix | Accurate local verdict, preserved artifacts |
| 2 | Review and commit the actual Track B fixes | Clean, reviewed feature-branch commits |
| 3 | Resolve Testcontainers image identity and networking | Same integration tests pass through CI |
| 4 | Validate P2 on Fly.io and Neon staging | Web and worker operate correctly as separate process groups |
| 5 | Issue the final Phase 0 verdict | P1, P2, P3 and backpressure acceptance evidence complete |

**What matters most here:** CI reproducibility and P2 staging are the remaining major proof gaps. We should close them, not invent another round of architecture.

The architecture remains the approved V2.1 baseline. Hono web instances use `DBOSClient`; the separate Fly worker owns DBOS execution. Business events and workflow enqueueing remain transactionally coupled in PostgreSQL. One Neon database serves the application and DBOS schemas.

We should not introduce another queue, another database, or another orchestration layer to solve problems that the chosen architecture is already designed to address.

### **Stage 1 — Prove the production deployment path**

This is where we move from a successful local test harness to an operational service.

The important checks are:

* Fly web and worker process groups run independently.  
* The web process does not accidentally run the DBOS executor.  
* The worker starts with the intended identity and recovers durable work.  
* Business events and workflow enqueueing remain atomic against Neon.  
* Restarts, deployments, and worker termination do not result in duplicate external operations.  
* Backpressure and connection limits remain effective in the deployed environment.  
* A deployment rollback does not compromise workflow or billing state.

This is a **staging acceptance exercise**, not permission to modify production data or remove the existing pg-boss path.

We still need an explicit decision about the treatment of existing workflow state before any destructive cutover. The earlier architecture work correctly recognized that old in-process waits cannot simply be reconstructed from incomplete historical records.

### **Stage 2 — Build the revenue-producing vertical slice**

Once the deployment foundation is proven, I would stop investing heavily in infrastructure and focus on the customer journey.

The first release should have a complete, usable path through:

1. Agency and location onboarding.  
2. Lead capture and CRM pipeline.  
3. Unified customer inbox.  
4. Booking and appointment management.  
5. Workflow automation.  
6. Reliable messaging integrations using the agreed BYO-provider approach.  
7. AI engagement with prepaid wallet limits and attempt controls.  
8. Reusable snapshots that let us replicate a working contractor setup.

The critical acceptance test is not whether each module has a large number of features. It is whether a new roofing lead can enter the system, receive a timely response, become a booked inspection, and receive the correct follow-up without someone manually coordinating every step.

**That is the first product demonstration worth selling.**

### **Stage 3 — Validate with actual paying customers**

Our current commercial hypothesis is approximately $199–$399 per month, with prepaid AI credits. That is a hypothesis, not validated market pricing.

The goal is to get a small number of real contractors using the actual workflow, then expand toward ten paying pilots.

We need to learn:

* Are they receiving more leads than they can handle?  
* Does faster response improve their booking rate?  
* Are they willing to pay to automate this process?  
* Which integrations are essential to their existing operations?  
* What causes them to stop using the product?  
* Does the system save enough time or generate enough additional business to justify the subscription?

This is where the business model becomes real. Technical completeness cannot substitute for willingness to pay.

### **Stage 4 — Expand only after demand is demonstrated**

Once the core workflow is producing value and customers are paying, we can expand into other capabilities:

* More industry-specific snapshots.  
* Additional messaging and telephony integrations.  
* Better AI engagement.  
* Reviews and reputation management.  
* Reporting and analytics.  
* Additional automation templates and distribution channels.

The order should be driven by customer demand and commercial return, not by the list of features a larger competitor happens to offer.

## **4\. What we deliberately defer**

We should resist the temptation to turn every unfinished feature into a priority.

| Defer | Reason |
| ----- | ----- |
| Full GoHighLevel feature parity | It does not help establish our initial market position |
| Courses and communities | Not central to the roofing lead-to-booking journey |
| Affiliate and social management | Can wait until customers demonstrate demand |
| Sophisticated analytics dashboards | Basic operational visibility comes first |
| Advanced multi-provider abstractions | Support the providers needed by the initial customers |
| Custom DLQ and elaborate workflow administration | DBOS already provides durable workflow machinery |
| RLS rollout | First prove compatibility across our actual application, worker, and connection paths |
| Additional infrastructure and queue systems | Avoid adding operational complexity without evidence |

This does not mean deleting existing capabilities. It means not spending our scarce engineering time expanding them before the core product is commercially useful.

## **5\. Where I would spend our next engineering effort**

Here is my priority order, based on impact on the actual business objective:

**1\. Close Phase 0**

Local proof achieved

Track B evidence reconciliation, clean commits, CI Testcontainers proof, then P2 Fly/Neon staging acceptance.

**2\. Demonstrate the complete deployed workflow**

Prove one production-shaped lead-to-booked-inspection journey in staging, including failures and recovery.

**3\. Make onboarding repeatable**

A roofing contractor should be able to get a working location, pipeline, inbox, calendar, and automation setup without a custom engineering project.

**4\. Get the first paying pilots**

Validate the workflow, the price, and the operational value with actual businesses.

**5\. Expand based on evidence**

Add features when they improve conversion, retention, customer value, or distribution.

## **6\. Immediate next action**

I would give the coding agent one bounded closeout assignment, not another broad architecture review:

* Reconcile the attached Track B evidence into `EVIDENCE_MATRIX.md` and the final local runtime verdict.  
* Correct the stale native PostgreSQL environment statements.  
* Review every uncommitted fix and preserve the existing failure artifacts.  
* Commit only the relevant Phase 0 changes, with tests and diff evidence.  
* Keep Docker/Testcontainers CI explicitly blocked until its own integration run passes.  
* Produce a short remaining-work list for CI and P2 Fly/Neon acceptance.  
* Do not push, cut over pg-boss, touch production, or introduce new architecture.

The governing instruction remains: **fix the cause, strengthen the system, and prove the solution—not merely silence the error.**

## **The alignment I want us to preserve**

We have two different goals, but they must not compete indefinitely.

**Engineering goal:** build a reliable, durable, multi-tenant SaaS foundation that can safely run customer workflows and control external provider costs.

**Business goal:** sell a product that helps small contractors turn incoming leads into booked jobs with less manual work.

The first goal supports the second. It is not an end in itself.

My recommendation is to finish the remaining Phase 0 proof, move directly into staging acceptance, and then concentrate the bulk of development effort on the roofing contractor vertical slice and paid pilots. We should not spend another month perfecting the test harness while the customer-facing workflow remains unfinished.

That is the roadmap I recommend we treat as our working direction.

