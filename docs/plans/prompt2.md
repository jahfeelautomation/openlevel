OpenLevel Prompt 2

I reviewed Muse's proposed plan. **My verdict: approve with a few mandatory amendments before telling Muse to proceed.**

One important distinction: this is Muse's *execution plan for producing the architecture document*, not yet the actual DBOS implementation architecture. It correctly understands that the repository and test suite must be investigated before architectural decisions are finalized.

plan(20261114-061035).md

## **What Muse got right**

The approach is sound in five important respects:

1. Repository reconnaissance comes before architectural assumptions.  
2. It intends to preserve the existing tests rather than weaken them.  
3. It recognizes the pg-boss-to-DBOS transition as a semantic migration, not a simple API substitution.  
4. It includes commercial economics and Day 2 operations.  
5. It prohibits source modifications, deployments, and infrastructure changes.

These are exactly the right priorities.

## **What I would change**

| Area | My assessment | Required adjustment |
| ----- | ----- | ----- |
| Deliverable path | Unnecessary ambiguity | Do not ask for confirmation. Resolve the Git repository root and use the path specified in the original prompt. |
| Test execution | Good, but insufficiently cautious | Inspect test configuration for external side effects before running tests. Discover commands from `package.json`, not guesses. |
| DBOS architecture | Needs deeper examination | Verify process lifecycle, workflow registration, transaction boundaries, versioning, and Neon connection behavior. |
| Tenant isolation | Needs stronger emphasis | Trace tenant identity through HTTP requests, repository access, background execution, webhooks, and agent tools. |
| Migration | Good foundation | Require an explicit event-by-event compatibility matrix and rollback strategy. |
| Document production | Too optimistic | Build an evidence ledger and decision records before assembling the final document. |

The biggest architectural omission I want addressed is **tenant identity propagation across durable workflows**.

It is not enough for an HTTP repository to filter by `location_id`. Every asynchronous workflow must preserve the same authorization boundary, even after a restart, retry, or delayed execution.

Likewise, a workflow retry must not accidentally reuse another tenant's context.

## **Send this amendment to Muse**

Your proposed execution plan is approved, subject to the following mandatory amendments.

1. **Resolve the output path automatically.** Do not ask me to confirm it. Use `git rev-parse --show-toplevel` to identify the repository root and create the document at `docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md` relative to that root. Follow the original prompt's deliverable requirement.  
2. **Establish an evidence ledger before drafting.** For every important repository-specific architectural claim, record the actual source file, symbol, observed behavior, and corresponding tests. Distinguish verified behavior from assumptions and proposed improvements.  
3. **Be particularly rigorous about tenant identity propagation.** Trace tenant and location identity across:  
   * HTTP authentication and authorization.  
   * Repository queries and transactions.  
   * Background job payloads.  
   * DBOS workflow arguments and steps.  
   * Workflow retries and recovery.  
   * Delayed and scheduled execution.  
   * Inbound webhooks.  
   * Agent tools and external provider callbacks.  
4. Identify every point where tenant context could be lost, forged, or confused.  
5. **Investigate DBOS runtime topology explicitly.** Verify how the TypeScript SDK initializes, registers workflows, launches, and recovers executions in separate Fly process groups. Establish how web and worker processes share the workflow registry and system database. Do not assume the proposed split works until the official SDK documentation supports it.  
6. **Treat external side effects as critical business invariants.** Analyze the crash-after-provider-success scenario for every important integration. Specify which operations need idempotency keys, transactional outbox, provider-side deduplication, reconciliation, or manual intervention. Never promise exactly-once external execution without a demonstrated mechanism.  
7. **Strengthen migration compatibility.** Produce a mapping from every existing queue/job and workflow state transition to its proposed DBOS equivalent. Include pending jobs, running jobs, retries, dead letters, delayed executions, historical run IDs, and rollback. Explicitly prevent pg-boss and DBOS from executing the same side effect concurrently.  
8. **Protect the existing environment when testing.** Inspect test setup, environment variables, and external integration mocks before executing tests. Never use production credentials or trigger real customer-facing operations. Discover actual npm commands from the repository scripts rather than assuming their names.  
9. **Do not write the architecture document in a single unverified pass.** Complete the repository evidence, compatibility mapping, DBOS capability verification, architecture decisions, and risk analysis first. Then assemble the final document and audit it against the original prompt's 18 required sections.  
10. **Preserve the working tree.** Do not modify any existing tracked or untracked file. The only permitted new artifact is the requested architecture document. Preserve existing untracked files and report the exact before-and-after Git status.

Proceed with the investigation and produce the requested implementation plan. Do not stop for clarification on the output path or decisions that can be investigated from the repository and official documentation.

Remember: the deliverable is a production architecture for a profitable multi-tenant SaaS business, not merely a successful DBOS integration.

## **My approval criteria**

When Muse returns the actual architecture document, I will use these as the five decisive questions:

**Behavioral fidelity**

Can we demonstrate that the new system preserves the old application's tested behavior?

**Tenant isolation**

Can one customer ever access another customer's data, workflow, credentials, or agent context?

**Durable execution**

Can we safely recover from crashes without losing business events or accidentally repeating external operations?

**Operational simplicity**

Can one operator deploy, monitor, troubleshoot, restore, and upgrade the platform without a dedicated DevOps team?

**Commercial viability**

Can the platform serve its first paying customers economically, with usage controls that protect gross margins?

**My position:** Let Muse proceed with these amendments. Don't let it start implementing yet. We should first approve the architecture and its migration sequence, then issue a separate implementation assignment with measurable acceptance criteria.

