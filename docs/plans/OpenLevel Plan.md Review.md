\#\# Verdict

Plan.md would not reliably produce a prompt1-compliant plan. It gets the spirit right, recon first, evidence labeling, planning only, but it compresses most of prompt1's hardest requirements into single phrases, omits migration entirely, and asserts as verified several facts it never evidences. Executed as written, it would likely pass a superficial 18-section check while failing prompt1's own adversarial review at the end.

\#\# What plan.md gets right

\- \*\*Planning only, recon first:\*\* Correctly treats prompt1 as the checklist and the repo as ground truth, and puts Phase Zero before design.  
\- \*\*Evidence discipline:\*\* Success Criteria require file paths/symbols for repo claims, inspected doc URLs for framework claims, and labels for facts, assumptions, recommendations, and unresolved questions.  
\- \*\*Test honesty:\*\* Validation requires observed test results recorded verbatim, never claimed without running, and no weakening or skipping tests.  
\- \*\*Idempotency focus:\*\* Step 6 names stable workflow IDs, keys, outbox, and reconciliation for SMS/email/payments, and Validation correctly flags duplicate-side-effect analysis as highest risk.  
\- \*\*Drift as finding:\*\* Risks correctly say DBOS/Neon/Fly doc drift becomes a labeled finding, not a silent substitution.

Those strengths do not compensate for the gaps below, because the gaps are in the areas prompt1 says it will scrutinize hardest.

\#\# Blockers

\#\#\# 1\. Migration and cutover are missing entirely

Prompt1 §10 requires a phased migration, Phase 0 through Phase 7, plus a precise pg-boss to DBOS transition procedure covering pending jobs, active jobs, failed jobs, dead-letter jobs, existing workflow state, long-running waits, duplicate events, existing run IDs, retry history, and rollback. It also forbids letting old and new systems independently execute the same customer-facing side effect, and forbids shadow mode from sending real messages.

Plan.md has no migration step at all. Steps 1 through 9 go from baseline to design to writing the doc, with no cutover, no dual-run guard, no rollback procedure, and no phase-completion conditions. A plan written from this outline could describe an ideal target architecture with no safe path to get there. This is the single largest omission.

\#\#\# 2\. Tenant model is never defined

Prompt1 §3 explicitly warns: do not assume \`location\_id\` and SaaS tenant ID are identical, and distinguish organization/agency, location/sub-account, individual operator, customer/contact, workflow execution, and DBOS workflow execution.

Plan.md never mentions that distinction, never mentions agency versus location versus operator, and never defines what a tenant is for isolation, partitioning, quotas, or billing. Since tenant isolation, tenant-aware queues, and SaaS economics all depend on that definition, every downstream section built from this plan would rest on an undefined term.

\#\#\# 3\. Commercial architecture is reduced to a phrase

Prompt1 §6 requires evaluating three tenancy approaches, A: shared Fly app plus shared Neon DB, B: shared app plus database-per-tenant, C: dedicated app plus dedicated DB, each across nine dimensions, infrastructure cost, complexity, operational burden, isolation, backup/restore, migration complexity, scaling, support, and tier suitability, then recommending a starting architecture.

Plan.md Step 7 never names A/B/C, never lists those dimensions, and omits agency/location ownership, plan enforcement, data export, white-label branding, custom domains, and per-tenant integration credentials from its SaaS gap inventory. It also omits prompt1 §11's required separation of eight cost categories and its metering, quotas, warnings, hard limits, and upgrade-path design. The economics pass comes after design in Step 7, so cost cannot constrain design as prompt1 intends.

\#\#\# 4\. Alternatives and ADRs are name-dropped, not specified

Prompt1 §12 requires challenging the architecture across nine alternatives, DBOS alongside pg-boss, complete replacement, single process versus separate groups, shared versus separate DBOS system DB, shared versus per-tenant DB, Fly single versus dedicated apps, PGlite versus real PostgreSQL for DBOS testing, incremental versus larger cutover, and outbox versus direct enqueue, each with options, advantages, disadvantages, failure modes, operational implications, cost implications, recommendation, and why alternatives were rejected, in ADR format.

Plan.md Step 8 says "ADRs" once and never lists which decisions need one or which alternatives must be evaluated. An executor following the plan could write zero ADRs and still claim Step 8 was done.

\#\#\# 5\. Fly.io and Neon deliverables are compressed beyond verifiability

Prompt1 §7 lists about 20 required deployment deliverables, including evaluating two configurations and recommending one, release\_command running once per deployment, no migrations on every web/worker startup, migration failure stopping deployment, worker not exposed publicly, autostop/autostart tradeoffs, graceful shutdown, rollback, and the DBOS bundling restriction: do not blindly bundle the DBOS workflow registry through Vite, esbuild, Rollup, or another bundler.

Plan.md Step 6 compresses all of that into "\`Dockerfile\` \+ \`fly.toml\` with web/worker process groups." It never mentions the bundling restriction, release\_command semantics, migration ordering versus DBOS system DB initialization, autostop risk to background work, or the two-configuration evaluation. The bundling point alone is a likely fatal build bug if missed.

Similarly, prompt1 §5 requires a three-way Neon decision, separate schemas versus separate databases versus separate projects, with tradeoffs, plus roles/privileges, migration ordering, Neon branching, versioned incremental migrations, and why an idempotent schema reapply may be insufficient. Plan.md says only "schema/database separation" and "connection budget."

\#\#\# 6\. Testing conformance is incomplete and miscounted

Prompt1 §9 requires a traceability matrix in the form: existing behavior to existing test to proposed DBOS implementation to new test to acceptance criterion. Plan.md never mentions that matrix format. It also never requires evaluating whether PGlite is suitable for DBOS integration testing, using disposable real PostgreSQL such as Testcontainers when necessary, or separating fast unit tests from genuine PostgreSQL/DBOS integration tests.

Worse, Validation claims the DBOS resilience layer has "19 scenarios." Prompt1 §9 lists 18, numbered 1 through 18\. That off-by-one error suggests the plan author did not actually count the list the plan will be judged against.

\#\#\# 7\. Output path handling contradicts prompt1 and blocks execution

Prompt1 §13 says create \`docs/architecture/OPENLEVEL\_DBOS\_FLY\_NEON\_IMPLEMENTATION\_PLAN.md\`, do not overwrite an existing file, and if the path exists choose a clearly named new version. Prompt1 also says "No additional clarification is required" and to record unresolved decisions rather than guess or block.

Plan.md does three conflicting things:

\- Asserts the deliverable path with an added \`openlevel/\` prefix, \`openlevel/docs/architecture/...\`, without resolving whether the checkout root is \`openlevel/\` or its parent. If the root is \`openlevel/\`, the plan's path double-counts it.  
\- Asserts in Success Criteria that the directory "does not exist yet," a claim presented without evidence.  
\- Turns the path into a blocking question: "please confirm" whether to use \`docs/plans/\` instead. That reintroduces the clarification prompt1 explicitly removed.

The correct behavior per prompt1 is: resolve the repo root at execution time, check whether the target exists, use a versioned name if it does, and record the choice, not ask for permission to proceed.

\#\# Major gaps by prompt1 section

\| Prompt1 section \| Plan coverage \| Verdict \|  
\| \--- \| \--- \| \--- \|  
\| §3 Recon \| Lists most areas, but omits sessions, the org/location/operator/customer taxonomy, and the claimed versus actual coverage gap analysis for the 80/50/50 test breakdown \| Partial, with a critical omission \|  
\| §4 DBOS design \| Covers mapping and retries, but omits determinism, serialization/replay, workflow argument hygiene, and the 10 explicit investigations: agent reply, workflow dispatch, resumption, long waits, scheduled/recurring, inbound webhooks, outbound messaging, appointment booking, cancellation/failure, DLQ inspection/replay \| Partial \|  
\| §4 Correctness \| Covers stable IDs, keys, outbox, reconciliation, but omits duplicate webhook delivery, duplicate enqueue, provider timeout with uncertain outcome, poison messages, and DLQ retention/recovery \| Partial \|  
\| §5 Neon \| Mentions pooled versus direct and connection budget, omits three-way placement decision, roles, branching, versioned migrations, and migration versus DBOS init ordering \| Weak \|  
\| §6 SaaS \| Omits A/B/C evaluation and most commercial gaps \| Missing \|  
\| §7 Fly \| Omits two-config evaluation, release\_command, autostop, bundling restriction, and most deliverables \| Weak \|  
\| §8 Day 2 \| Reduces observability, admin, backup, and security to nouns, omits the 10 logging correlation fields, 14 metrics, 9 admin capabilities, PITR/RPO/RTO/restore testing, and 14-item threat list \| Weak \|  
\| §9 Testing \| Omits traceability matrix format, PGlite versus DBOS evaluation, Testcontainers, and miscounts scenarios as 19 not 18 \| Weak \|  
\| §10 Migration \| No step, no cutover, no dual-run guard, no shadow-mode guard \| Missing \|  
\| §11 Economics \| "Unit-economics model from documented pricing only," omits eight cost categories, metering design, and quota/limit design \| Weak \|  
\| §12 Alternatives \| Mentions ADRs once, lists no alternatives \| Missing \|  
\| §13 Deliverable \| Covers 18 sections, diagrams, inventories, checklists, but omits realistic estimates rule and "do not invent precise delivery dates" \| Partial \|  
\| §14 Working rules \| Omits bans on creating/altering Fly apps and Neon DBs/branches, schema changes, destructive commands, and inventing details \| Partial \|

\#\# Precision and consistency errors

\- \*\*Unverified "verified starting facts":\*\* Approach claims \`bootstrap()\` in \`server/index.ts\` confirms pg-boss plus Hono coupling, \`server/jobs/\` contains four files plus co-located tests, test files number 182, and git tree is clean except untracked \`deepwiki.md\` and \`docs/plans/\`. No branch, commit, line numbers, counting method, or timestamp is given. This is exactly what prompt1 forbids: treating preliminary findings as verified facts. The plan violates its own evidence standard in the paragraph that states it.  
\- \*\*Inconsistent path base:\*\* Plan uses \`server/index.ts\`, \`server/jobs/\`, and \`openlevel/tsconfig.json\` interchangeably. It cannot be right about both bases at once. The inconsistency proves the repo-root question is unresolved.  
\- \*\*Missing pg-boss baseline numbers:\*\* Prompt1 §2 gives the baseline to preserve: four retries, exponential backoff, five-second initial delay, 300-second maximum delay, batch size one, separate dead-letter queues for agent replies and workflow dispatch. Plan.md Step 3 says "retry/backoff" without any of those values. Without capturing them, behavioral fidelity cannot be checked.  
\- \*\*Missing DBOS versioning and blue-green:\*\* Prompt1 stresses workflow versioning and blue-green deployment so old executions finish on compatible code, plus §9 test 16 on version compatibility. Plan.md mentions versioning once in research, never in design, deployment, or cutover.  
\- \*\*Hedged validation commands:\*\* Validation says "\`npx tsc \-p openlevel/tsconfig.json\` and \`npm test \--prefix openlevel\` (or repo's \`vitest run\`)". The "or" means there is no deterministic command. It also does not guard the case where \`node\_modules\` is absent: prompt1 forbids installing/upgrading dependencies, so the executor must stop and record that limit rather than install to get tests running.  
\- \*\*"In one pass" writing:\*\* Approach says "write the document in one pass." That invites baking early errors into all 18 sections, with no re-verification loop to check that the connection budget, \`fly.toml\`, cost model, and migration plan agree with each other after drafting.  
\- \*\*No needs-approval enumeration:\*\* Step 9 promises to report evidence-backed versus needs-approval decisions, but never lists which decisions are presumptively needs-approval, such as tenancy model, RPO/RTO targets, quotas, pricing assumptions, and DBOS system DB placement. An executor could present all of them as settled recommendations.

\#\# What would fail prompt1's final scrutiny

Prompt1 ends with seven scrutiny points: every behavior mapped, DBOS actually solves current problems, no hidden duplicate-side-effect risks, Neon sound, Fly preserves in-flight compatibility, tenant isolation and cost controls enforceable, genuinely economical for a small operator. As written, plan.md leaves at least four of those, Neon, Fly compatibility, tenant/cost enforceability, and economics, without enough specified work to pass.

\#\# Fixes required before execution

1\. \*\*Add a migration step\*\* with Phase 0 through Phase 7, cutover checklist for the 10 items in §10, dual-run prohibition, shadow-mode prohibition on real external writes, and phase-completion conditions.  
2\. \*\*Add a tenant-model step\*\* defining organization/agency, location, operator, customer, workflow execution, and DBOS workflow execution, and stating explicitly whether \`location\_id\` equals tenant ID, with evidence.  
3\. \*\*Add an alternatives step\*\* listing the nine §12 decisions, each to be documented with options, failure modes, operational and cost implications, recommendation, and rejection rationale, in ADR format.  
4\. \*\*Expand Fly, Neon, Day 2, and commercial steps\*\* from nouns into checklists drawn from §5, §6, §7, §8, and §11, including A/B/C tenancy, bundling restriction, release\_command, autostop, the 10 logging fields, 14 metrics, 9 admin capabilities, and eight cost categories.  
5\. \*\*Fix testing:\*\* Correct 19 to 18 scenarios, require the five-column traceability matrix, require a PGlite versus DBOS suitability finding, and require separation of fast unit tests from real PostgreSQL/DBOS integration tests.  
6\. \*\*Fix the output path:\*\* Resolve repo root at execution time, check existence, use a versioned filename if the target exists, and remove the blocking "please confirm" question. Record the choice instead.  
7\. \*\*Remove or evidence the "verified facts":\*\* Either delete the 182 test files, \`bootstrap()\`, and clean-tree claims from the plan, or attach branch, commit, counting method, and file/line evidence for each. Do not let the plan itself make unevidenced claims.  
8\. \*\*Capture the pg-boss baseline\*\* explicitly: four retries, exponential backoff, 5s initial, 300s max, batch size one, separate DLQs, plus triggers, payloads, tenant context, ordering, concurrency, and idempotency assumptions per job.  
9\. \*\*Add determinism, versioning, and durable waits:\*\* Require nondeterministic operations inside steps, workflow argument hygiene, blue-green/version compatibility, and durable waits surviving restarts, Machine replacement, deployments, scaling, and DB interruptions, plus whether existing run state can be reused.  
10\. \*\*Make validation deterministic:\*\* Pin exact typecheck and test commands after recon, state the stop condition if dependencies are missing or real PostgreSQL is unavailable, and add a final cross-section consistency check across Neon budget, \`fly.toml\`, cost model, and migration plan.

Until at least items 1, 2, 5, 6, and 7 are patched, do not execute plan.md as written.  
