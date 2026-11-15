# DeepSeek Review

\# Adversarial review (revised) — \`OPENLEVEL\_DBOS\_FLY\_NEON\_ARCHITECTURE\_V2.md\` against \`prompt5.md\`, cross-referenced to \`plan5\_review.md\`

\*\*Revision note:\*\* The original review was written as if V2 had not yet responded to the V1 commentary. Reading \`plan5\_review.md\` (Muse's and Claude's reviews of V1, plus their follow-up simplifications), V2 has in fact resolved most of the specific defects those reviews raised. The verdict, several findings, and the scorecard are revised accordingly. The core critical findings (C1–C5) stand but are sharpened with cross-references. One new major (M9) is added because the cross-reference exposed a compliance gap I missed. A short section documents what V2 fixed, so credit is accurate.

\*\*Scope note (unchanged):\*\* I did not re-run the repository greps or inspect the checkout; repo-specific counts are treated as claims to be audited, not independently verified here.

\---

\#\# Verdict (revised)

\*\*Directionally sound; V2 substantially resolves the attached reviews; not yet a controlling spec.\*\*

The V2 plan correctly rejects V1's outbox pump, web-tier DBOS runtime, dual-write cutover, custom DLQ/admin, per-tenant flags, and 24-hour drain cap. It adopts the specific fixes both reviewers demanded: \`DBOSClient\`-only web, single-executor recovery with fixed \`DBOS\_\_VMID\`, \`delaySeconds\` continuations, surgical datasource adoption, \`MAX\_RECOVERY\_ATTEMPTS\_EXCEEDED\` handling, per-location Chatwoot secrets, encrypted credentials, branch-level Neon restore semantics, pricing corrected for Stripe SaaS fees, and a Phase 1 commercial foundation. Those are real fixes to V1 defects, not cosmetic.

What remains are not "did V2 respond to the reviews?" gaps. They are prompt5-compliance gaps and unresolved mechanics that both reviews flagged at V1 and that V2 has now carried forward as design debt: deferred quantitative models (C1), the unclosed atomic-enqueue dedup pattern (C2), deploy config that does not enforce single-executor fencing (C3), a usage-ledger and recovery-attempt design that is cost-unsafe under non-idempotent AI (C4), a traceability matrix that is still category-level (C5), and — newly identified by cross-reference — a §15 migration accounting that still does not deliver prompt5 §26's five fields for the one applicable item (M9).

\*\*Verdict:\*\* V2 is the right architecture and a clear improvement over V1 and over the prior reviews' baseline. It is not yet acceptable as the controlling specification. Approve it for implementation only after C1–C5 and M9 are closed or explicitly recorded as blockers.

\---

\#\# What the attached reviews confirm V2 fixed

This is the section my original review should have had. Each is a real V1 defect from \`plan5\_review.md\` that V2 has closed:

\- \*\*Dual-write double-execution (Muse V1 \#4).\*\* V2 has no dual-write; Strategy A is a clean cutover with a written owner gate (§3.2, §15). Strategy B "dual-run prohibited" (§15).  
\- \*\*DLQ replay vs. \`return-existing\` dedup (Muse V1 \#5).\*\* V2 drops the custom DLQ entirely; DBOS native status \+ \`outbound\_operations\` (§10, §14). No replay-vs-dedup collision to design.  
\- \*\*24-hour drain cap vs. 7-day waits (Muse V1 \#7).\*\* V2 removed the cap; §15 item 7 is "adopt-if-present ... no 24h cap, no silent fails."  
\- \*\*Connection budget arithmetic 45 vs. 55 (Muse V1 \#6).\*\* V2 §9 splits direct vs. pooled and totals 25/27 direct \+ 10/20 pooled — corrected.  
\- \*\*Web "runs DBOS runtime" overstatement (Muse V1; Claude V1 \#3).\*\* V2 §5, §7.1: web uses \`DBOSClient\` only; no \`launch()\`, no recovery, no dequeue.  
\- \*\*Outbox pump \+ 5s scheduled workflow cost (Claude V1 \#4).\*\* V2 §7.1 rejects the pump on both correctness and cost grounds, and documents the \~17k executions/day figure.  
\- \*\*pg-boss evaluated without \`db\` option, \`startAfter\`, \`singletonKey\`, \`boss.schedule\` (Claude V1 \#5).\*\* V2 §6 evaluates all of these fairly and acknowledges both V1 defects are "fixable in pg-boss."  
\- \*\*DBOS \`delaySeconds\` omitted from wait options (Claude V1 \#5).\*\* V2 §7.4 centers it as the default.  
\- \*\*Neon "split timelines" claim (Claude V1 \#7).\*\* V2 §9 explicitly corrects and credits the review.  
\- \*\*DR runbook missing "workers stopped until provider reconciliation" (Claude V1 \#7).\*\* V2 §11 includes the step.  
\- \*\*Forgeable Chatwoot inbox ID (Claude V1 security).\*\* V2 §8 requires per-location/per-inbox secrets; \`?secret=\` flagged as leak.  
\- \*\*\`client\_slug\` cardinality unresolved (Claude V1 security).\*\* V2 §3.1 finds no uniqueness constraint and documents the many-to-one.  
\- \*\*Square random-suffix / Stripe no-idempotency-key (Claude V1 security).\*\* V2 §8: versioned keys with content component, "same key \+ changed body is an error."  
\- \*\*Graceful shutdown (\`kill\_signal\`/\`kill\_timeout\`) missing (Claude V1 Fly).\*\* V2 §10 sets \`SIGTERM\`/120s.  
\- \*\*\`min\_machines\_running\` misapplied to worker (Claude V1 Fly).\*\* V2 §5 correctly uses \`fly scale count\`.  
\- \*\*Worker count inconsistency; Fly 2x priced at 1x rate (Claude V1 Fly/economics).\*\* V2 §5/§13 uses 1 worker, 1x machines at matching prices.  
\- \*\*Payment fees "\$0 to us" contradiction (Claude V1 economics).\*\* V2 §13 explicitly corrects with 2.9%+30¢ on own subscriptions.  
\- \*\*Invented ±15% / \+5–10% / \>25% placeholders (Muse V1; Claude V1 economics).\*\* V2 removed them, replaced with labeled \`\[Assumption\]\` placeholders and a measurement procedure.  
\- \*\*Unflagged behavior changes (social, reviews) (Claude V1 scope).\*\* V2 §2 defers/retires them; §21 flags intentional change for \`send\_sms\`/\`send\_email\`.  
\- \*\*Representative-only traceability matrix (Muse V1 \#2; Claude V1 §19).\*\* V2 Appendix T expanded from 12 rows to 8 area categories — better, but still not exhaustive (see C5, which stands).  
\- \*\*\`DBOS.registerScheduled\` / \`new WorkflowQueue()\` stale APIs (Claude V1 \#3).\*\* V2 §7.5 uses \`createSchedule\`/\`applySchedules\`/\`backfillSchedule\`; §7.5 uses \`registerQueue\`/\`listenQueues\`.  
\- \*\*\`enqueueInTransaction\` vs. outbox (Claude V1 \#4).\*\* V2 §7.1 adopts \`enqueueInTransaction\`; §7.1 and Appendix R \#5 correctly state \`return-existing\` is unsupported.

That is a substantial majority of the attached-review defects closed. The review below should be read against that baseline: it is auditing the remainder, not the original stack.

\---

\#\# Critical findings (updated)

\#\#\# C1. Three mandatory quantitative deliverables are deferred, not delivered — \*\*sharpened\*\*

\*\*Plan says:\*\* §13 provides formulas and a fixed-stack estimate, then states: \*"Worked numbers belong to the pricing worksheet, not this architecture doc."\* Checkpoint multipliers are \*"\[Assumption\] placeholders until the Phase 2 measurement run."\*

\*\*Why it still fails prompt5, reinforced by the attached reviews:\*\*  
\- §25 required a scenario model at \*\*10 / 50 / 100 / 500 / 1,000 agencies\*\*, explicit assumptions, and calculated \*\*break-even customer count\*\*.  
\- §24 required checkpoint-volume modeling at \*\*10k / 100k / 1M / 10M executions\*\* and multipliers per agent turn, automation, recipient, and batch.  
\- §5 required \*\*cost per 10,000 and 100,000 executions\*\* in the pg-boss vs. DBOS comparison.

Both attached follow-ups reinforce this. \*\*Muse's simplification\*\* argues that profit is decided by AI COGS, not infrastructure, and that the architecture must be paired with an explicit credit meter — a scenario table is the only way to show that. \*\*Claude's follow-up\*\* independently estimates the fixed stack at \~\$200–350/mo and notes the economics depend on usage COGS, not the DBOS choice — again, only a scenario model can evidence this. V2's symbolic formulas and Phase 2 promise are precisely the deferral prompt5 §25 prohibited. Labeled assumptions and a symbolic break-even solve were possible without inventing measured benchmarks; the directive did not permit substituting formulas for the table.

\*\*Correction:\*\* Add a parameterized scenario table with explicit placeholder assumptions, solve break-even symbolically, and include the checkpoint-multiplier measurement procedure with a "blocked until measured" column. If numbers are genuinely unknowable, record them as blockers in Appendix D rather than presenting §13 as complete.

\#\#\# C2. Atomic-enqueue dedup story is still unclosed — \*\*sharpened\*\*

\*\*Plan says (§7.1):\*\* \*"a retried request replays the same UUID and converges via ON CONFLICT, and the workflow itself is started with that UUID so double-enqueue collapses."\* The same paragraph correctly notes \`duplicationPolicy: 'return-existing'\` is unsupported in \`enqueueInTransaction\`.

\*\*Why it still fails, reinforced by the attached review:\*\* The attached Claude review already recorded at V1: \*"the plan's \`return-existing\` dedup claim is also correct... \`enqueueInTransaction\` does not support it."\* V2 has now acknowledged that constraint but has not designed the handler around it. Specifically:  
\- If the business \`INSERT ... ON CONFLICT DO NOTHING\` returns no row, does the handler skip \`enqueueInTransaction\`?  
\- If the handler calls \`enqueueInTransaction\` with an existing workflow ID anyway, does DBOS throw, return the existing, or create a new attempt? The plan does not say, and \`return-existing\` is unavailable to control it.  
\- Gate 7 ("acked work never silently lost") depends on the exact transaction body being written down.

\*\*Correction:\*\* Specify the exact handler body and the duplicate-workflow-ID behavior. The safe pattern — \`INSERT ... ON CONFLICT DO NOTHING RETURNING id\`, call \`enqueueInTransaction\` \*\*only when a row was inserted\*\*, and treat a duplicate-workflow-ID error as success — must appear in the document, not be inferred.

\#\#\# C3. Single-executor fencing is asserted but not enforced by the deployment config — \*\*unchanged, cross-referenced\*\*

\*\*Plan says (§10):\*\* fixed \`DBOS\_\_VMID=worker-1\`, stop-then-start worker deploys, "never two live processes sharing an ID." \*\*§C\*\* puts \`DBOS\_\_VMID\` in \`\[env\]\` with the comment \*"worker group only, via fly scale \+ secrets."\*

\*\*Why it still fails:\*\*  
\- Fly \`\[env\]\` and secrets are \*\*app-wide\*\*; per-process env belongs in the \`\[processes\]\` command string. As written, web also carries \`DBOS\_\_VMID=worker-1\` (harmless today, a trap if a second worker is added).  
\- The config sets no \*\*deploy strategy\*\*. Fly's default rolling deploy does not guarantee the old worker is fully stopped before the replacement starts for a process group with no health checks. Two processes can briefly share \`worker-1\` — the exact split-brain the plan says it prevents.  
\- The runbook describes a manual \`fly machine stop\` → verify → start sequence, but automated deploys do not follow it.

This is a real risk that both attached reviews emphasized at V1 — Claude's V1 review devotes a full blocking defect to it, and its follow-up simplification pins it to "make sure the old Machine is fully stopped before the new one starts." V2 has adopted the principle but not the enforcement.

\*\*Correction:\*\* Put the VMID in the worker command (\`worker \= "ROLE=worker DBOS\_\_VMID=worker-1 node dist/boot.js"\`), set \`\[deploy\] strategy \= "immediate"\` (or a pre-deploy stop hook), and test \*\*Machine replacement\*\*, not process restart.

\#\#\# C4. Usage-ledger reserve/settle/refund lacks a state machine and orphan reconciliation — and the 100-attempt default is a cost bomb under non-idempotent AI — \*\*sharpened\*\*

\*\*Plan says (§12):\*\* \*"reserve before the model call (transactional op), settle on result..., refund on failure-before-billing-point; retries reserve against the same operation UUID so a retried turn cannot double-charge."\* \*\*§11\*\* adopts the default \`MAX\_RECOVERY\_ATTEMPTS\_EXCEEDED\` at 100 attempts. \*\*§8\*\* notes Anthropic has no documented idempotency key and states duplicates \*"cost money, not correctness — bounded by wallet reservations."\*

\*\*Why it still fails, reinforced by the attached review:\*\* The attached Claude V1 review already recorded the crash-loop concern: \*"A workflow that repeatedly crashes the process never writes a DLQ row. The recovery-attempt cap isn't discussed."\* V2 has adopted 100 as the default cap but has not designed around it. The consequences are:

\- \*\*Platform COGS is not bounded by the wallet.\*\* If the wallet reservation is created once and a workflow retries a non-idempotent Anthropic call up to 100 times, the customer is reserved once; the \*\*platform pays 100 model calls\*\*. The sentence "bounded by wallet reservations" is correct for customer billing and false for platform COGS.  
\- \*\*Orphan reservations can persist forever.\*\* If a worker dies after reserve and before settle/refund, the wallet stays reserved unless a sweeper expires it. No state machine (\`reserved → settled \| refunded \| expired\`) and no reconciliation job are defined.  
\- \*\*Concurrent turns and tenant quotas are asserted, not designed.\*\* Prompt5 §9 explicitly required correctness under workflow retry, worker crash, concurrent agent turns, and tenant quotas. V2 claims row-lock serialization but does not specify expiry, sweeper cadence, or test.

\*\*Correction:\*\* Define the ledger state machine, reservation expiry, a reconciliation sweep, and \*\*per-workflow \`maxRecoveryAttempts\` (or per-step retry limits) for money-spending workflows\*\* so a poison model step cannot burn unbounded provider spend. Add a test that a crash-after-provider-success before settlement neither double-charges the customer nor silently spends past the wallet.

\#\#\# C5. Traceability matrix is still a representative sample — \*\*reinforced by the attached Muse review\*\*

\*\*Plan says:\*\* Appendix T claims coverage of "all 8 areas."

\*\*Why it still fails:\*\* Entries are category summaries — "contact CRUD shapes," "per-tenant unique indexes," "campaign send endpoint" — not route-by-route/repo-by-repo rows. Prompt5 §30: \*"It must be useful before implementation, not merely a representative sample deferred until coding."\* The attached \*\*Muse V1 review (\#2)\*\* flagged exactly this defect in V1's §12.1 (\*"representative only... does not satisfy §18"\*). V2 expanded from 12 rows to 8 area categories but did not move to the route/repo-level enumeration the directive and the review required. With 230 endpoints and 53 repo test files claimed, launch-critical contracts should be named individually.

\*\*Correction:\*\* Expand to named routes/repos/behaviors for launch-critical contracts (auth, tenancy, booking, payments, campaigns, webhooks, agent tools), and mark everything else explicitly out of launch scope. The matrix should be usable to verify behavior preservation before implementation, not after.

\---

\#\# Major findings

\#\#\# M1. Evidence discipline is uneven — \*\*reinforced by both attached reviews\*\*

Specific problems, plus the cross-references:

\- \*\*§3.1 "9 resolver call sites"\*\* — count stated without the command.  
\- \*\*§3.1 "230 exact" endpoints\*\* — command shown but not path scope; fixed-string method literals can match non-route occurrences. "Exact" is overclaimed. The attached \*\*Muse V1 review\*\* flagged V1's \`grep \-c 'app.(get\|post\|...)'\` as counting lines not registrations; V2 improved the method but did not close the path-scope issue.  
\- \*\*§3.1 "0 files" touching real Postgres\*\* — grep for \`new Pool(\` and \`PgDatabase(\` can miss \`pg.Client\`, \`postgres\`, \`testcontainers\`, \`@neondatabase/serverless\`. Both attached reviews noted V1's version of this method was unreliable; V2's fixed-string is better but incomplete.  
\- \*\*§4 RLS compatibility\*\* — \*"verified across multiple practitioner sources"\* is exactly the non-official sourcing both attached reviews flagged as insufficient against prompt5's official-docs requirement. Mark \`\[Assumption\]\` until Neon docs confirm.  
\- \*\*§6 pg-boss \`boss.schedule\`\*\* — sourced as \*"verified via API references in search results"\*, contradicting Appendix S and prompt5's official-docs requirement.  
\- \*\*§8 social and Anthropic idempotency\*\* — secondary sources; prompt5 §19 required official API docs for every claimed idempotency/reconciliation capability.

The ledger's "Verified" label is doing too much work. It should distinguish "observed in checkout," "cited official docs," and "test passed."

\#\#\# M2. Connection budget is arithmetically corrected but not verifiable — \*\*unchanged\*\*

§9's 25/27 direct \+ 10/20 pooled checks out and correctly fixes V1's direct/pooled conflation, which both attached reviews flagged. But:

\- Prompt5 §18 required \*\*Neon connection limits\*\*; none are cited.  
\- The worker's "20 direct" line bundles "steps \+ datasource \+ sysdb client pool (default 10)" without showing whether ordinary step queries use a separate app pool or the datasource pool.  
\- No DBOSClient non-transactional pool is budgeted for web (e.g., \`getWorkflow\`/status calls).  
\- The \`\[Assumption\]\` label is honest; the budget is not yet a budget.

\#\#\# M3. pg-boss comparison improved but still does not engage with tenant grouping — \*\*softened but stands\*\*

V2 §6 is materially better than V1 on \`db\`-option transactional enqueue, \`startAfter\`, \`singletonKey\`, and \`boss.schedule\`. But prompt5 §5 also listed \*"Queue grouping and concurrency"\* and \*"tenant grouping"\* to investigate; V2 reduces pg-boss tenant fairness to \*"Manual (no partitions)"\* without citing docs on grouping/singleton semantics or explaining why they do not satisfy the requirement. The verdict may still be right; the fair-comparison requirement is not met on that row.

\#\#\# M4. Product strategy omits required differentiation, switching costs, distribution, and pricing scenarios — \*\*reinforced by Muse's follow-up\*\*

Prompt5 §6 required differentiation, switching costs, distribution channels, and why customers would pay instead of GoHighLevel. §9 required pricing scenarios and the willingness-to-pay evidence needed. V2 gives an ideal customer and wedge, correctly refuses to invent prices — but swings to \*\*no pricing scenarios at all\*\*, and does not analyze distribution or switching costs beyond snapshots/templates. Muse's follow-up devotes a full section to \*"Sell snapshots and templates, not workflows"\* as the moat — V2 gestures at this but does not develop the differentiation or distribution argument.

\#\#\# M5. Roadmap does not provide the required per-phase matrix — \*\*unchanged\*\*

Prompt5 §28 required each phase to state: deliverables, dependencies, acceptance tests, customer value, cost impact, operational burden, rollback strategy, definition of done. V2's Phase 0 has a DoD; Phases 1–2 have value and rollback; Phase 3 is one line. The matrix is incomplete, especially for Phase 3 items that carry independent cost/ops decisions.

\#\#\# M6. Region selection weakly justified; Neon region unspecified — \*\*unchanged\*\*

§17 says \`iad\` is justified by "US market evidence in §2 (AZ/NC leads)" — that is a repository schema comment, not market evidence. Prompt5 §17 required choosing Fly \*\*and Neon\*\* regions based on target geography, Neon availability, latency, and residency. Neon's region is not named.

\#\#\# M7. Chatwoot hosting mode unresolved — \*\*reinforced by Claude's follow-up\*\*

§8 says \*"If Chatwoot is self-hosted... it is the largest non-DB ops liability."\* The plan does not establish whether it is self-hosted or cloud, and treats \`.env.example\` hostnames as non-proof (correctly). Claude's follow-up is explicit: \*"If you're operating Chatwoot yourself, it's a Rails, Redis and Sidekiq stack, and your biggest ops liability."\* For an architecture doc, this should be an explicit \`\[Unknown\]\` with an owner decision, not a conditional aside.

\#\#\# M8. §31 final report not delivered as an enumerated response — \*\*unchanged\*\*

Prompt5 §31 required a concise 12-item report. V2 embeds most content across §1, §2, §12, §13, §18, and appendices, but does not provide the enumerated checklist. Formal non-compliance.

\#\#\# M9 (new). §15 migration accounting still does not deliver prompt5 §26's five fields for the one applicable item

Prompt5 §26 requires, \*for every applicable item\*: Migration strategy, Compatibility requirements, Cutover behavior, Recovery behavior, Rollback behavior. V2 §15 presents \`Item \| Status \+ evidence\` — two conceptual columns, not five. For Strategy A, most items are correctly N/A with evidence. \*\*But item 7 ("Long-running waits — Adopt-if-present") is explicitly applicable\*\* (contingent on a prod DB existing), and its cell states only the policy (\*"one script reads \`waiting\` \`workflow\_runs\` rows..., notifies owners, marks honestly; no 24h cap, no silent fails"\*). It does not state:

\- \*\*Compatibility requirements:\*\* what \`workflow\_runs\` fields exist that would let the script reconstruct a due time, and what state a \`waiting\` row carries today.  
\- \*\*Cutover behavior:\*\* what happens to a \`waiting\` row when the new worker starts; whether the row is adopted into a DBOS continuation, or is failed and the tenant notified.  
\- \*\*Recovery behavior:\*\* if the adoption script itself crashes mid-run, is it idempotent? Does it re-read the same rows?  
\- \*\*Rollback behavior:\*\* if the adoption has to be reverted, what state does the row return to?

The attached \*\*Claude V1 review\*\* specifically asked: \*"nothing says whether a wake timestamp is persisted."\* V2 §15 does not answer that. If wake timestamps are not persisted, item 7 is not "adopt-if-present" — it is "notify-and-fail," and the document should say so honestly.

\*\*Correction:\*\* Expand item 7 to the five fields, or downgrade the item to "notify-only, no adoption" with the wake-timestamp evidence stated. If adopted, add the \`workflow\_runs\` schema facts to Appendix L.

\---

\#\# Minor findings (updated)

\- \*\*§1 overstates §3.2.\*\* "No live production state was found" should be "no evidence of live production state was found in the repository," consistent with §3.2's residual-unknown caveat.  
\- \*\*Schema disposition absent.\*\* 58 tables are counted; courses/communities are retired from launch scope; there is no table-level keep/defer/drop list. The launch schema's real surface is not established.  
\- \*\*Sleep \`\<15 min\` residual use case unexplained.\*\* If delayed continuations are the default, either justify the residual or drop it.  
\- \*\*Brevo 2021 changelog\*\* for idempotency TTL should be re-verified as current.  
\- \*\*"No DBOS Cloud (closed to new users per \`llms.txt\`)"\*\* should be a dated \`\[Assumption\]\`, not a permanent "never recommend."  
\- \*\*Concurrency numbers\*\* (agent 2/20, dispatch 5/50, bulk 1/4) are labeled \`\[Assumption\]\` but not related to memory, connections, model RPM, or provider rate limits as §10 required. State the derivation rule.  
\- \*\*"Federation" rate limiting\*\* (§11) is unexplained; clarify what is federated.  
\- \*\*Appendix L\*\* does not include the counting findings (228/182/230/58/0/9), so the ledger does not cover all material claims.  
\- \*\*Dunning/failed-payment subscription lifecycle\*\* is absent from §12.  
\- \*\*\`transaction\_completion\` runtime DML grant\*\* is implied by "app role: runtime DML on both schemas" but not shown. \`app\` can write DBOS internal tables — a broad privilege worth documenting.  
\- \*\*Migration tool unnamed.\*\* §10 says \`release\_command\` runs advisory-locked versioned \`db/migrations/\`, but does not name \`dbmate\` or \`node-pg-migrate\`. Prompt5 §17 required a reproducible strategy; the attached Muse simplification explicitly recommends naming the tool. Pin one.  
\- \*\*Three roles vs. Muse's two-role suggestion.\*\* Defensible under prompt5 §18 ("at minimum distinguish migration from runtime"), but the \`readonly\` role's day-one value should be stated (admin/metrics reads) so it is not a diagram-only addition.  
\- \*\*§15 item 7 "adopt-if-present"\*\* does not state whether \`workflow\_runs\` stores a wake timestamp (see M9).  
\- \*\*C2\*\* should be tested directly as a gate: a duplicate submit that hits a conflicting business row must produce exactly one workflow execution and zero duplicate provider calls, with the handler pattern stated in Appendix C.

\---

\#\# Compliance scorecard (updated)

\| Requirement \| Status \| Change vs. original \| Note \|  
\|---\|---\|---\|---\|  
\| §3 migration vs. launch, two strategies \| \*\*Pass\*\* \| — \| Strategy A \+ written gate; §1 wording overstates \|  
\| §4 challenge architecture \| \*\*Pass\*\* \| — \| Outbox, dual engine, flags, custom DLQ/admin all addressed \|  
\| §5 fair pg-boss vs. DBOS, cost/10k/100k \| \*\*Partial\*\* \| — \| V2 materially improved pg-boss evaluation; tenant-grouping gap; cost-per-exec deferred; one weak source \|  
\| §6 product wedge, differentiation, distribution \| \*\*Partial\*\* \| — \| Wedge and ICP present; differentiation/distribution/pricing scenarios thin \|  
\| §7 agency model, \`client\_slug\`, RLS \| \*\*Partial\*\* \| — \| Model good; RLS compatibility unsourced; \`client\_slug\` count method missing \|  
\| §8 commercial model \| \*\*Pass\*\* \| — \| Hybrid BYO messaging \+ platform AI well argued \|  
\| §9 billing/metering foundational \| \*\*Partial\*\* \| — \| Design present; ledger state machine and orphan reconciliation missing; 100-attempt cost bomb \|  
\| §10 DBOS integration, queues \| \*\*Partial\*\* \| — \| Web/worker split correct; config VMID/deploy issues \|  
\| §11 three transaction mechanisms \| \*\*Partial\*\* \| — \| Distinguished correctly; enqueue dedup unclosed \|  
\| §12 decomposition \| \*\*Pass\*\* \| — \| Fan-out in workflow code; agent turn decomposed \|  
\| §13 wait strategy at 10k/50k/100k \| \*\*Partial\*\* \| — \| Recommendation made; required scale comparison not quantified \|  
\| §14 schedules/bulk \| \*\*Pass\*\* \| — \| Current APIs; chunked campaigns; object-storage deferral \|  
\| §15 executor/recovery, Conductor \| \*\*Partial\*\* \| — \| Design present; fencing not enforced \|  
\| §16 versioning \| \*\*Partial\*\* \| — \| Choice made; alternatives not compared as required (V2 does adopt patch discipline per attached Claude's recommendation) \|  
\| §17 Fly deployment \| \*\*Partial\*\* \| — \| Most specified; deploy strategy/VMID wrong; region thin; migration tool unnamed \|  
\| §18 Neon/privileges, connection budget \| \*\*Partial\*\* \| — \| Arithmetic corrected per attached review; Neon limits missing; worker breakdown ambiguous \|  
\| §19 provider model, Chatwoot \| \*\*Partial\*\* \| — \| Per-location secrets added per attached Claude; social/Anthropic secondary; hosting unknown \|  
\| §20 security \| \*\*Pass\*\* \| — \| Encrypted credentials, OAuth, audit, redaction — matches attached Claude's recommendation \|  
\| §21 behavior changes, \`workflow\_runs\` \| \*\*Pass\*\* \| — \| Log-only → gated real sends; projection table — matches attached Muse's "stop preserving bugs" \|  
\| §22 admin/observability \| \*\*Pass\*\* \| — \| DBOS-native management; signals vs. paging — matches both follow-ups \|  
\| §23 whole-system recovery \| \*\*Pass\*\* \| — \| Ten failures covered; restore sequence includes workers-stopped (per attached Claude) \|  
\| §24 retention \+ checkpoint model \| \*\*Partial\*\* \| — \| Retention defined; checkpoint-volume model absent \|  
\| §25 unit economics \+ scenarios \| \*\*Fail/Partial\*\* \| — \| Formulas only; no scenario table or solved break-even — the single largest remaining gap \|  
\| §26 migration accounting \| \*\*Partial\*\* \| \*\*Downgraded from Pass\*\* \| Item 7 applicable but not five-fielded; wake-timestamp persistence unstated (see M9) \|  
\| §27 acceptance tests \| \*\*Pass\*\* \| — \| 7 gates \+ secondary; real PG for DBOS — matches both follow-ups \|  
\| §28 roadmap \| \*\*Partial\*\* \| — \| Four phases; per-phase matrix incomplete \|  
\| §29 18 recommendations \| \*\*Pass\*\* \| — \| Appendix R answers all; \#18 formula-only \|  
\| §30 document, evidence, traceability \| \*\*Partial\*\* \| — \| Doc structure good; ledger incomplete; matrix still category-level (see C5) \|  
\| §31 final report \| \*\*Fail\*\* \| — \| No enumerated 12-item report \|

\---

\#\# Bottom line (updated)

V2 is the right architecture, and — this is the important revision — it has substantially resolved the specific defects in \`plan5\_review.md\`. The web/worker split, the outbox rejection, the single-worker \+ patch discipline, the \`delaySeconds\` continuations, the surgical datasource adoption, the corrected Neon and Fly economics, the per-location Chatwoot secret requirement, the seven gates, and the Phase 1 commercial foundation all trace directly to the attached reviews' blocking and major findings. That is not a patch list; it is a rebuild.

The plan is still not approvable as the controlling specification. The remaining gaps are the prompt5-compliance items and unresolved mechanics that both attached reviews flagged at V1 and that V2 has carried forward as design debt:

1\. \*\*The three quantitative models\*\* (scenario/break-even, checkpoint volume, cost per 10k/100k) — or explicit blocker status. C1.  
2\. \*\*A closed atomic-enqueue pattern\*\* with duplicate-workflow-ID behavior. C2.  
3\. \*\*A deploy config that enforces single-executor fencing\*\* — per-process VMID and immediate/stop-then-start strategy. C3.  
4\. \*\*A usage-ledger state machine, orphan sweep, and cost-bounded recovery attempts for non-idempotent AI.\*\* C4.  
5\. \*\*A route/repo-level traceability matrix\*\* for launch-critical contracts. C5.  
6\. \*\*A five-field §15 migration accounting for item 7, including wake-timestamp evidence.\*\* M9.  
7\. \*\*Source-discipline cleanup\*\* — mark unsourced/weak claims as assumptions, audit the "exact" counts, name the migration tool.

Until those are closed, the document is a strong draft architecture with several material gaps hidden behind confident labels — but a much stronger draft than the version my original review described, because it has already incorporated most of the adversarial commentary it claims to have accepted.

# Muse Review

\#\# Verdict after reading prompt5 and plan5\_review

V2 is now verifiable, and most of my earlier provenance objection is resolved. Prompt5 is the controlling directive, V2 follows its shape: 18 sections matching prompt5 §30, 9 ADRs matching §30, 18 recommendations in Appendix R matching §29, 7 critical gates matching §27, and a clean-start strategy matching §26.

V2 is sound after specific corrections. It is not yet build-ready. The substance is largely right, but V2 does not do what prompt5 §1 requires it to do: record provenance problems and note each rejection of the reviews. And it defers or thins out several items prompt5 requires to be decided in the document, not in a later worksheet or Phase 2 measurement.

Plan5 is still absent from this packet. V2 claims it inspected \`docs/plans/plan5.md\`, but it does not record the fallback prompt5 §1 requires if plan5 is absent or differs: record the provenance problem and follow the V2 assignment. That claim remains unverifiable here.

\#\# What prompt5 changes from the earlier review

My earlier review demanded a six-column compatibility matrix for all 11 migration items, based on prompt3 §19. Prompt5 §26 supersedes that. It says: if no live state exists, mark the item not applicable with evidence, do not invent a migration. V2 §15 does exactly that: items 1 to 6, 8 to 11 marked N/A with evidence, item 7 adopt-if-present with no 24-hour cap. That is compliant with prompt5, not a failure.

The same supersession applies to the SaaS list shift and the ADR field count. Prompt5 §30 requires 18 sections and 9 ADRs with 8 fields, not prompt3 counts. V2 has 18 sections and 9 ADRs. Each ADR does contain the 8 fields when business and operational impact are counted separately: recommendation, alternatives, simplicity case, business impact, operational impact, evidence, uncertainty, revisit. The earlier 8 versus 7 concern is resolved.

\#\# What V2 gets right against prompt5

\- \*\*§1 to §3, clean start with a gate:\*\* §3.2 weighs evidence for and against live state, recommends Strategy A, and requires owner confirmation in writing before Phase 2 deletes pg-boss paths. Strategy B is kept condensely in §15, not built fully for a customer who may not exist.  
\- \*\*§4, challenge the assembly:\*\* §1, §5, §7, §10, §14 reject outbox plus pump, second engine, per-tenant flags, custom DLQ, custom admin UI, separate reconcile per provider, and blue-green machinery. That matches the 12-item challenge list.  
\- \*\*§5, fair pg-boss comparison:\*\* §6 lists pg-boss transactional enqueue via \`db\` option, \`startAfter\`, \`singletonKey\`, \`boss.schedule\`, workers, retry and retention, then compares on the prompt5 dimensions and makes one recommendation: DBOS-only.  
\- \*\*§7, agency model:\*\* §4 gives \`agencies\`, \`agency\_members\`, \`locations.agency\_id\`, roles owner, admin, member enforced in middleware, agency billing, location quotas, branding, snapshots, and tenant isolation via \`agency\_id\` plus \`location\_id\` validated at step 1\. §3.1 investigates \`client\_slug\`: nullable, non-unique, 9 resolver sites use \`client\_slug ?? slug\`, many-to-one permitted, no observed instance in the single-location seed.  
\- \*\*§9, no invented prices:\*\* V2 never uses \$97, \$297, or \$497. §2 requires 10 paid pilots at a stated price, not surveys, before pricing commits. That correctly rejects the plan5\_review simplified proposal, which did invent those prices.  
\- \*\*§10 to §12, DBOS integration:\*\* §5 and §7.1 use \`DBOSClient\` only in web, no launch, no recovery, no dequeue. §7.1 uses \`enqueueInTransaction\` with stable business UUID plus unique constraint, since \`return-existing\` is unsupported. §7.2 adopts datasources surgically for 4 writers, others explicitly not exactly-once. §7.3 decomposes fan-out in workflow code, not in steps, and agent turns into 7 durable units. §8 gives exactly one primary guarantee per provider from the five categories in prompt5 §11, fixing V1 combos.  
\- \*\*§14, schedules and bulk:\*\* §7.5 uses current schedule APIs, no exactly-once claim, idempotent handlers, backfill per operation, global schedules only, chunked campaigns with per-recipient UUIDs, unsubscribe and DND re-check, rate control via \`partitionRateLimit\`, cancellation, metering, uncertain quarantine, no step looping hundreds of sends.  
\- \*\*§15 to §16, recovery and versioning:\*\* §10 uses fixed \`DBOS\_\_VMID=worker-1\`, fencing by verified stopped state, stop-then-start deploys, Machine replacement tested by killing the Machine. Versioning uses pinned version plus \`DBOS.patch()\`, old paths retained, \`deprecatePatch\` only after executions complete. V2 never uses Claude \`enablePatching\`, which prompt5 §16 forbids as outdated clone instruction. That is a correct silent qualification, but see below.  
\- \*\*§18, Neon and roles:\*\* §9 corrects the Neon restore claim, branch-level overwrite, one database with \`app\` plus \`dbos\` schemas, 3 roles compared against 2, 3, and 4, no superuser, no invented EXECUTE, connection budget split min and target, direct versus pooled distinct, labeled Assumption.  
\- \*\*§19, provider model:\*\* §8 uses one \`outbound\_operations\` table, stable IDs, versioned Stripe and Square keys with content version, Twilio reconcile via SIDs plus \`StatusCallback\`, Brevo TTL handling, Anthropic best-effort, Vapi manual recovery, Chatwoot app dedup. Chatwoot binding verdict is correct: global secret plus payload \`inbox.id\` does not authenticate the inbox, per-location secrets plus registry before launch.  
\- \*\*§22 to §23, ops and recovery:\*\* §14 uses Fly logs plus Sentry plus Conductor at trigger, no custom admin UI, 5 operator actions via \`resumeWorkflow\` and \`forkWorkflow\`, \`rewindWorkflow\` not assumed, \`MAX\_RECOVERY\_ATTEMPTS\_EXCEEDED\` for crash loops. §11 gives the 10-failure whole-system spec, workers stay stopped on restore, reconcile DBOS versus business versus provider, RPO and RTO as Needs approval targets.  
\- \*\*§26 to §27, migration and tests:\*\* §15 marks N/A with evidence, no dual-write, no 24-hour cap. §16 lists the 7 critical gates verbatim and the 10 secondary tests, Testcontainers for DBOS behavior, PGlite for app tests, no green-baseline claim until the suite runs.  
\- \*\*§28 to §30, roadmap and deliverable:\*\* §17 has 4 phases, relative size, no dates, Phase 1 commercial before Phase 2 durable core. Appendix L is the six-field evidence ledger with file and line refs and fixed-string methods. Appendix T covers all 8 traceability areas. Appendix S cites official docs accessed 2026-11-14, TS docs for TS claims, SDK clone supplemental only with commit \`e94db66\`.

\#\# What V2 still fails against prompt5

\#\#\# 1\. §1, rejections are promised but not listed

V2 header says: reviews treated as adversarial commentary per §1, accepted where valid, rejected where contradicted, each rejection noted.

A search of V2 finds only that one sentence about rejection. There is no rejection list.

Prompt5 preamble says: do not blindly accept either Muse simplified proposal or Claude. V2 does qualify several, but it never names them:

\- Muse proposed \$97, \$297, \$497. V2 correctly drops them per prompt5 §9, but never says it rejected them.  
\- Muse proposed single-process web plus worker in one Machine, and \`DBOS.startWorkflow\` directly. V2 correctly uses \`DBOSClient\` plus two process groups and \`enqueueInTransaction\`, but never says it rejected the single-process and \`startWorkflow\` ideas.  
\- Muse proposed full platform-owned providers. V2 correctly chooses hybrid, BYO messaging plus platform AI, per prompt5 §8, but never says it qualified Muse.  
\- Claude proposed \`enablePatching\`. V2 correctly uses \`DBOS.patch()\`, but never mentions \`enablePatching\`, so a reader cannot tell it was considered and rejected.

Fix: add a short §1 rejection table: review claim, prompt5 or docs contradiction, V2 decision. Without it, §1 compliance is asserted, not shown.

\#\#\# 2\. §3, status should be Unknown, not established Strategy A

Prompt5 §3 says: if available evidence cannot establish whether real customers or production jobs exist, label the status Unknown.

V2 §3.2 says: proceed as Strategy A, new launch, with residual unknown handled by a hard gate. That is the right safety behavior, but the wrong label. An external prod DB cannot be disproven from the repo, which is exactly the Unknown case.

Fix: label status Unknown, with Strategy A as the preferred conditional strategy, gated on written owner confirmation. Do not present Strategy A as established fact.

\#\#\# 3\. §6, distribution and differentiation are missing

V2 §2 gives ideal customer, wedge, essential, defer, retire, and WTP evidence rule. It does not identify potential distribution channels, differentiation versus GoHighLevel, or switching costs, all required by prompt5 §6.

Fix: add one paragraph: channels, why an agency switches, what locks them in, snapshots, white-label, wallet, or migration cost. Do not invent demand, but name the channels to test in the 10 pilots.

\#\#\# 4\. §7, RLS demonstration is an assertion, not a demonstration

Prompt5 §7 requires demonstrating how transaction-local tenant context works across ordinary queries, DBOS transactional operations, worker connections, and pooled connections, with privileged roles that bypass RLS.

V2 §4 says \`SET LOCAL app.tenant\_id\` inside an explicit transaction is compatible with transaction-mode pooling, verified across multiple practitioner sources, must be re-verified against Neon docs. That is an assertion from non-official sources, not a demonstration across the four contexts, and it violates V2 own official-docs-only standard.

The decision is correct: do not enable RLS at launch, pilot on 3 tables in Phase 3\. The evidence is not. Fix by either providing the four-context demonstration with official Neon and Postgres docs, or by stating explicitly that RLS is deferred and the demonstration is a Phase 3 gate, not claimed now.

\#\#\# 5\. §9 and §25, two margin models and worked scenarios are deferred

Prompt5 §9 requires building two commercial scenarios, BYO versus platform-funded, and modeling their margins separately. Prompt5 §25 requires a scenario model for 10, 50, 100, 500, and 1000 agencies with explicit assumptions, and calculations for MRR, usage revenue, COGS, infra, payment processing, contribution margin, gross margin, break-even, sensitivity, and checkpoint cost.

V2 §13 gives formulas, a skeleton list of inputs, and says worked numbers belong to the pricing worksheet, not this doc. It gives no worked numbers, no two margin models, no line items for Neon history storage, branch-hours, or network egress, all required by §25.

The decision to avoid invented percentages is correct, and §25 allows formulas only when no benchmark exists. It does not allow deferring the entire scenario model. Fix by adding one worked skeleton with explicit placeholder assumptions clearly labeled as placeholders, for example locations per agency, seats, turns per location per day, model mix, plan price, churn, support hours, with MRR, COGS, and break-even solved for that placeholder set, plus the BYO versus platform-funded margin split. Label every input as placeholder to be replaced by pilot data.

\#\#\# 6\. §10, concurrency limits are arbitrary

Prompt5 §10 says: do not invent arbitrary concurrency settings without relating them to memory, database connections, model capacity, and provider rate limits.

V2 §7.5 gives agent partition 2 and global 20, dispatch 5 and 50, bulk 1 and 4, labeled Assumption, tied to the §9 connection budget, tuned from backlog metrics, not arithmetic. That ties them to connections only, not to memory, model capacity, or provider rate limits.

Fix: tie each limit to at least one of those four factors, or state that the limits are starting values with a load-test procedure that will set them from those factors in Phase 2\.

\#\#\# 7\. §13, delay continuations add a state machine without measured advantage

Prompt5 §13 says: do not introduce an elaborate polling state machine without a measured advantage.

V2 §7.4 chooses \`delaySeconds\` continuations over \`DBOS.sleep\` because sleep memory residency is undocumented. That is a documentation argument, not a measurement. The continuation design itself requires a journey table with \`{journeyId, dueAt}\`, cancellation of both journey row and delayed continuation, and stale-continuation cleanup, none of which V2 specifies.

Fix: specify the journey table, writer, cancellation path, maximum delay checked, and stale cleanup, and state that the choice will be validated by a Phase 2 measurement of parked-journey memory versus continuation overhead at 10k, 50k, and 100k journeys. Do not present the choice as already measured.

\#\#\# 8\. §15 and §17, fencing, restart, and executor rollback are underspecified

Prompt5 §15 requires specifying how Fly replacement preserves ID, how a failed worker is confirmed stopped, how a zombie is fenced, how a new process discovers and recovers, how rollback preserves executor and versions, and what happens on forced replacement. Prompt5 §17 requires restart policy, worker count mechanism, and deploy behavior.

V2 §10 gives fencing and stop-then-start, but Appendix C puts \`DBOS\_\_VMID \= "worker-1"\` in global \`\[env\]\`, which applies to web too. That would make web look like the worker executor. \`DBOS\_\_VMID\` must be set per Machine, not in global \`\[env\]\`. V2 does not specify Fly restart policy, does not state that worker deploys pause background work, and does not specify how rollback preserves executor ID and workflow versions beyond redeploy prior image.

Fix: correct the sketch to per-Machine env, state restart policy, state explicitly that worker deploys are not zero-downtime, and state rollback keeps the same \`DBOS\_\_VMID\` and the same pinned version plus patch markers.

\#\#\# 9\. §16, backward-compatible change taxonomy is missing

Prompt5 §16 requires defining for every workflow code change which changes are backward-compatible and which alter step number or order.

V2 §10 says breaking step-order changes get patch markers, old paths retained, \`deprecatePatch\` only after executions complete. It does not define what counts as backward-compatible, for example changing step internals without changing order, adding a step at the end, or changing a non-durable helper.

Fix: add a short taxonomy: safe without patch, requires patch, requires new workflow version.

\#\#\# 10\. §22, rewind and full thresholds are deferred

Prompt5 §22 requires defining when each of \`resumeWorkflow\`, \`forkWorkflow\`, and \`rewindWorkflow\` is appropriate, and providing real alert thresholds and response procedures, labeled proposed until tested.

V2 §14 defines resume for cancelled and attempts-exceeded, fork for fixed-and-retry, and says rewind is evaluated at implementation, not assumed. That defers rewind. It gives thresholds only for backlog over 500 for 10 minutes and p95 over 2 seconds for 5 minutes, not for the other paging signals it lists: error-budget burn, stuck workflows, DB saturation, wallet-settlement failures.

Fix: define rewind or state explicitly that rewind is not used at launch, and give a proposed threshold plus runbook pointer for each paging signal, even if the threshold is a placeholder.

\#\#\# 11\. §24, four-scale checkpoint model is missing

Prompt5 §24 requires modeling checkpoint volume and cost at 10k, 100k, 1M, and 10M executions per month, and estimating the multiplier per agent turn, automation, campaign recipient, and import batch, and evaluating Pro quota against gross margin.

V2 §13 gives a formula and says multipliers are Assumption placeholders until Phase 2 measurement. It gives no four-scale table and no margin evaluation, because it has no tier prices. That is honest, but it is not the §24 model.

Fix: add a four-scale table with placeholder multipliers clearly labeled, showing checkpoint count and cost at each scale, and the scale at which Pro quota is exceeded. That satisfies §24 without inventing measured multipliers.

\#\#\# 12\. §28, phase specs are incomplete

Prompt5 §28 requires for each phase: deliverables, dependencies, acceptance tests, customer value, cost impact, operational burden, rollback, definition of done.

V2 §17 gives deliverables in prose, customer value, rollback, and DoD, but does not give dependencies, cost impact, or operational burden per phase. Phase 1 in particular is overloaded: agencies, roles, Stripe, wallet, encrypted credentials plus OAuth, onboarding, dashboard, all size L. That is three phases compressed.

Fix: split Phase 1 into 1a agency plus Stripe plus wallet plus plan gates, and 1b encrypted credentials plus OAuth plus onboarding, and add dependencies, cost impact, and operational burden per phase.

\#\# Smaller gaps still open from the earlier review

\- \*\*§2 versus Appendix R counts:\*\* §2 lists 5 retain, 4 improve, 4 defer, 1 retire, courses and communities. Appendix R item 15 says 7 wedge keeps, 4 deferred, 2 retired, campaigns and voice improved. The retired count differs, 1 versus 2, and the wedge count differs, 5 versus 7\. Reconcile the two lists.  
\- \*\*Wallet lock duration:\*\* §12 says concurrent turns serialize per-wallet via row lock. Prompt5 §9 requires correctness under retry, crash, concurrent turns, and quotas. V2 does not state lock duration. Fix by stating lock is held only for reservation, milliseconds, never across a model call, then settle in a second short transaction.  
\- \*\*Enqueue conflict handler:\*\* §7.1 says duplicate retries hit the same UUID plus unique constraint and converge. It does not state the handler behavior on unique violation: roll back, look up existing workflow by UUID, return its status, do not create a second business row. Add that.  
\- \*\*Degraded reads:\*\* §11 says web serves degraded reads during Neon outage. If Neon is down, reads fail. Define degraded reads as cached or static reads only, with writes returning 503\.  
\- \*\*Credential access control:\*\* §11 says encrypted credentials with key ID and rotation, master key in Fly secret, but does not state that only the worker decrypts, web never decrypts. Add that separation.  
\- \*\*Neon limits and datasource pool:\*\* §9 lumps datasource pool and sysdb client pool into worker direct 20\. Prompt5 §18 requires defining datasource pool separately and stating Neon connection limits. Break out the datasource pool and state the Neon limit for the chosen plan.  
\- \*\*Twilio pricing attribution:\*\* §13 cites Twilio pricing page for \$0.0083 per segment, Appendix S says aggregators concur \$0.0083. One is the source. If it is aggregators, label §13 as secondary, as is done for Anthropic.  
\- \*\*Appendix T completeness:\*\* Appendix T covers all 8 areas, which is a major improvement over V1 representative rows. It still covers routes as groups, not all 230 endpoints individually. For a planning doc that is reasonable, but prompt5 §30 says not merely representative. State explicitly that Appendix T is complete at area and behavior-group level, and that endpoint-level rows will be generated from route registration in Phase 0, rather than implying it covers every endpoint.

\#\# Fixes before build, in order

1\. Add a §1 rejection table naming each Muse and Claude claim V2 rejects or qualifies, with the prompt5 or docs contradiction.  
2\. Relabel §3 status as Unknown, with Strategy A conditional on written owner confirmation.  
3\. Add distribution, differentiation, and switching costs to §2.  
4\. Fix Appendix C \`DBOS\_\_VMID\` scoping to per-Machine, state restart policy, state worker deploys pause background work, and state rollback preserves executor and version.  
5\. Specify the journey table, cancellation, maximum delay, and measurement plan for \`delaySeconds\` in §7.4, and the wallet lock duration and enqueue conflict handler in §7.1 and §12.  
6\. Split Phase 1 into 1a and 1b, and add dependencies, cost impact, and operational burden per phase in §17.  
7\. Add the four-scale checkpoint table, the two margin models, and one worked placeholder scenario in §13, with all inputs labeled placeholders.  
8\. Add the backward-compatible taxonomy, rewind definition or non-use statement, full paging thresholds, and RLS four-context demonstration or Phase 3 gate in §10, §14, and §4.  
9\. Reconcile §2 and Appendix R capability counts, fix Twilio attribution, and state credential decryption separation.

After those patches, V2 is the document to build from. It keeps DBOS power where it matters, native recovery, partitioned fairness, patching, delayed continuations, and transactional enqueue, and it drops the museum cost that made V1 unshippable. The remaining work is not re-architecting. It is making the new mechanisms, enqueue dedup, delay continuations, wallet locking, and single-worker fencing, exact enough to implement without inventing them under schedule pressure.  
