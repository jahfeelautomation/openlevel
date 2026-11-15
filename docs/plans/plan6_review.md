# Muse Review

\#\# Verdict on plan6

Plan6 is well scoped and honest about its boundaries. It preserves V2 direction, it does not promise executed tests or measured benchmarks it cannot run, and its validation plan correctly names C2 and C3 as the two load-bearing mechanisms.

It is not yet safe to execute as written. Step 2 contains a blocker that contradicts V2 and prompt5 on the atomic enqueue mechanism, Step 1 assigns dispositions before the vertical that determines them is chosen, and several items are named opaquely enough that an executor cannot verify them without \`v2.1\_review.md\`, which is not in this packet.

\#\# Provenance gap first

Plan6 says: implement \`docs/plans/v2.1\_review.md\`, close its 6 Critical findings C1 to C6 and 18 Major findings M1 to M18.

\`v2.1\_review.md\` is not in this packet. I cannot verify that plan6 summary of C1 to C6 and M1 to M18 matches the review, that the §6 correction order it claims to follow is the review order, that the §5 scorecard it says to re-grade exists with those rows, or that the Acceptance paragraphs it says to check verbatim say what plan6 implies.

That is the same chain problem as before: prompt5 to V2 to v2.1\_review to plan6. Plan6 does one thing right here: it says validation is checking each C1 to C5 item against its review Acceptance paragraph verbatim. That is only possible if the executor has the review file open. Before execution, attach \`v2.1\_review.md\` and confirm plan6 mapping, or plan6 cannot be audited.

\#\# What plan6 gets right

\- \*\*Correction, not rewrite:\*\* V2 text carried forward verbatim except sections replaced per the correction order, each replacement traceable to its C or M item, V2 and V1 stay byte-identical, only V2.1 is new. That matches prompt5 §2.  
\- \*\*Honest boundaries:\*\* No toolchain means tests are designed with pass criteria, never executed or claimed green. No Neon or Fly access means \`SHOW max\_connections\`, benchmarks, and fencing proofs ship as specified procedures with labeled placeholders, never as results. Cited URLs that moved become recorded gaps with fallback citations, not silent substitutions.  
\- \*\*Owner inputs batched:\*\* Region, Chatwoot hosting, Strategy A confirmation, first vertical, and price points arrive as one approval list, not dripped as blockers. Drafting never blocks on them. That is the right way to handle Unknowns.  
\- \*\*C1 economics:\*\* Placeholder but calculated 5-scale model under BYO and managed scenarios, MRR, COGS, margin, break-even, sensitivity, cost per 10k and 100k executions per engine, checkpoint volume at 10k to 10M with per-unit multipliers and a not-measured column. That closes the V2 gap on prompt5 §25 and §24, provided every input is labeled placeholder.  
\- \*\*C4 wallet:\*\* Reservation state machine \`reserved to settled or refunded or expired\`, provider-attempt state machine, per-run spend caps plus step and recovery retry bounds, expiry sweeper with cadence, locking, idempotency, short-lived row locks only, unknown-outcome reconcile-before-retry, and 4 crash tests. That closes the wallet lock duration and COGS ceiling gaps.  
\- \*\*C5 replay:\*\* Attempt-ID state machine with pre-call durable write, replay-inspects-first, stable-key reuse within provider windows, quarantine plus explicit at-most-once trade-off where providers lack idempotency or lookup, callback, operator, and customer reconciliation, and purge of unsupported exactly-once wording. That closes the V2 exactly-once language problem.  
\- \*\*M1 pool budget:\*\* Per-pool table with Hono reads, web \`DBOSClient\` with verified default, web transaction pool, worker system pool, datasource pool, migrator and admin, each with max size, endpoint, machine count, idle and min, peak, plus \`SHOW max\_connections\` procedure and explicit headroom math. That fixes V2 lumping datasource and sysdb pools into worker direct 20\.  
\- \*\*M12, M16, M17:\*\* Pinned migration tool plus exact grants, six provenance labels on every ledger claim, rejection register plus explicit 12-item final report checklist. That closes prompt5 §1 and §31.  
\- \*\*M18 accuracy sweep:\*\* Fixed-stack labels, Stripe-fee geography caveat, Twilio attribution, dated DBOS Cloud note, degraded-reads correction, sleep-rule removal or justification, datasource-scope caveat, provider-matrix wording. That is a good catch-all for the minor V2 gaps, including the sleep under 15 minutes rule, which was arbitrary.

\#\# Critical blocker: Step 2 contradicts V2 and prompt5 on atomic enqueue

V2 §7.1 and prompt5 §11 both state the same constraint: \`duplicationPolicy: 'return-existing'\` is unsupported for \`enqueueInTransaction\`. Dedup therefore comes from stable business UUID plus unique constraint in the application layer.

Plan6 Step 2 says: specify the §2.1 six-step handler with explicit \`workflowIDReusePolicy: 'return-existing'\`, business-row conflict path, caller response, and post-retention behavior.

Three problems:

1\. \*\*It never mentions \`enqueueInTransaction\`.\*\* Atomic enqueue in V2 means business write plus enqueue commit together in one Postgres transaction. \`enqueue()\` with \`return-existing\` cannot do that. If Step 2 means replace \`enqueueInTransaction\` with \`enqueue()\` plus \`return-existing\`, it loses atomicity and must explain how a crash between business write and enqueue is reconciled. If Step 2 means keep \`enqueueInTransaction\`, then \`return-existing\` is unavailable and the step is wrong.  
2\. \*\*It uses a different option name.\*\* V2 and prompt5 say \`duplicationPolicy\`. Plan6 says \`workflowIDReusePolicy\`. Those may be the same concept under a renamed option in the pinned SDK, or they may be different options on different methods. Plan6 must not assert the name. It must re-verify the pinned TS client reference first and state which method supports which option.  
3\. \*\*It presupposes the answer.\*\* Plan6 Validation says C2 is highest-risk and must be checked against the pinned TS client reference. That is correct. But Step 2 already presupposes \`return-existing\` is available. And Risks says no blocking open questions for execution. That contradicts C2 being highest-risk and pending verification. C2 is blocking until the reference is checked.

Fix Step 2 to read as a verification-gated decision, not an assertion:

\- Re-verify the pinned TS client reference for \`enqueueInTransaction\` and for \`enqueue\`.  
\- If \`return-existing\` is unsupported in \`enqueueInTransaction\`, keep V2 manual dedup: stable business UUID plus unique constraint, with the handler behavior on conflict spelled out: roll back, look up existing workflow by UUID, return its status, do not create a second business row.  
\- If \`return-existing\` is used via \`enqueue\`, specify the atomicity loss and the reconciliation path for a crash between write and enqueue.  
\- In either case, specify post-retention behavior: what happens to a duplicate after workflow history is deleted at 30 days, and after the business row is retained or deleted.

Do not execute Step 2 until that verification is written into the step.

\#\# Ordering flaw: Step 1 assigns dispositions before Step 8 chooses the vertical

Step 1 says: enumerate all 230 endpoints with file and line and disposition, launch-critical, retained-unpromoted, deferred, retired, excluded, and list all 58 tables with keep, defer, retire disposition.

Step 8 says: single vertical plus paid offer plus acquisition hypotheses, C6.

You cannot assign launch-critical disposition without knowing the vertical. The same applies to table dispositions that depend on which capabilities are deferred or retired for that vertical.

Fix: split Step 1\. In Step 1, enumerate endpoints with file and line and count method, and tables with schema facts, with no disposition. Assign dispositions in Step 8, after C6 chooses the vertical. Otherwise Step 1 will invent dispositions that Step 8 later has to redo.

\#\# Missing or opaque items

\- \*\*§3 Unknown labeling:\*\* My V2 review flagged that V2 labels status as Strategy A when prompt5 §3 requires Unknown when live state cannot be established. Plan6 batches Strategy A confirmation as an owner input, but never says V2.1 will relabel §3 as Unknown with Strategy A conditional on confirmation. Add that explicitly, or confirm v2.1\_review does not require it.  
\- \*\*§2 versus Appendix R counts:\*\* V2 §2 lists 5 retain, 4 improve, 4 defer, 1 retire. Appendix R item 15 says 7 wedge keeps, 4 deferred, 2 retired. Plan6 does not name reconciling those counts. If v2.1\_review requires it, make it explicit in Step 8 or Step 9\. If it does not, it is still a V2 inconsistency that V2.1 should fix.  
\- \*\*Rewind:\*\* Step 8 says worker heartbeat plus provisional thresholds plus launch resume, fork, and cancel policy. Prompt5 §22 requires defining when each of resume, fork, and rewind is appropriate. Plan6 omits rewind. State explicitly: rewind is not used at launch, or define when it is used. Do not drop it silently.  
\- \*\*Four named proposals:\*\* Step 10 says rejection register covering at minimum the four named proposals, but plan6 never names them. Name them in plan6: Muse \$97, \$297, \$497 prices, Muse single-process web plus worker, Muse \`startWorkflow\` or direct enqueue, Claude \`enablePatching\`, or whatever v2.1\_review names. An executor cannot verify coverage of unnamed proposals.  
\- \*\*§2.1 reference:\*\* Step 2 says §2.1 six-step handler. V2 §2 is product strategy, not a handler. The handler belongs in V2.1 §7.1. Clarify whether §2.1 refers to v2.1\_review §2.1 or to a new V2.1 section, and place the handler in §7.1.  
\- \*\*Attempt versus operation:\*\* Step 5 says attempt-ID state machine. V2 §8 has \`outbound\_operations\` with a stable operation UUID. Clarify the hierarchy: operation, stable ID, maps to multiple attempts, each attempt with its own ID and pre-call durable write. Do not conflate operation and attempt.  
\- \*\*Federation term:\*\* Step 1 says define or remove the federation term. That is valid. V2 uses it once, in Postgres-backed rate limiting for login plus public plus federation, without defining it. V2.1 should define it or delete it. Good catch, keep it.  
\- \*\*Per-location Chatwoot secrets:\*\* V2 §8 requires per-location secrets plus registry before launch. Plan6 M13 credential trust boundary may cover it, but plan6 never names per-location Chatwoot secrets. Confirm it is retained in V2.1, not lost in the trust-boundary rewrite.  
\- \*\*C6 scope:\*\* Step 8 says C6 is single vertical plus paid offer plus acquisition hypotheses. My V2 review also required distribution channels, differentiation versus GoHighLevel, and switching costs. Confirm C6 includes those, not just vertical plus offer, or add them to Step 8\.  
\- \*\*M4 journey table:\*\* Step 8 says journey lifecycle with cancel, reschedule, expiry, and stale rules plus 10k, 50k, and 100k benchmark designs. That covers lifecycle, but not the journey table schema, writer, cancellation path, or maximum delay. Add table spec to M4, or the lifecycle rules have no store to enforce them.  
\- \*\*Label migration:\*\* Plan6 introduces six provenance labels: observed, counted, official-doc, executed-test, assumption, unknown. V2 ledger used Verified, Assumption, and similar. Specify how old V2 labels map to the new six, so carried-forward V2 text does not mix label systems.  
\- \*\*V2.1 path verified absent:\*\* Success Criteria says V2.1 path verified absent. Re-verify at execution time with \`ls\`, do not assume it from plan6. If the path exists, use a versioned alternative per prompt5 §30.

\#\# Fixes before execution

1\. Rewrite Step 2 as verification-gated: re-verify the pinned TS client reference for \`enqueueInTransaction\` versus \`enqueue\`, state which method supports which reuse option, preserve atomicity or specify reconciliation if atomicity is lost, and list C2 as blocking until verified. Remove the no blocking open questions claim for C2.  
2\. Split Step 1: enumerate endpoints and tables with file and line and methods in Step 1, assign dispositions in Step 8 after C6 chooses the vertical.  
3\. Attach \`v2.1\_review.md\` and confirm plan6 mapping of C1 to C6, M1 to M18, §6 order, §5 scorecard, and Acceptance paragraphs. Without it, validation is unverifiable.  
4\. Name the four proposals in Step 10, add §3 Unknown relabeling, add §2 versus Appendix R reconciliation, add rewind decision, add per-location Chatwoot secrets retention, and add journey table spec to M4.  
5\. Clarify the §2.1 reference and place the handler in V2.1 §7.1, clarify operation versus attempt in Step 5, and specify label migration for the six provenance labels.

After those fixes, plan6 is a sound correction plan. Its core instinct is right: do not rewrite V2, fix the load-bearing mechanisms first, C2, C3, C4, C5, C1, and pool budget, then the pre-launch batch, with honest placeholders where measurement is impossible here.

# Deepseek Review

\# Adversarial review — \`plan6.md\` against the corrections it claims to implement

\*\*Verdict:\*\* A strong execution plan with correct sequencing, honest provenance discipline, and the right call on the two highest-risk mechanisms. Two substantive defects (F1, F2), one structural risk (F3), and several under-specifications that will let a writer satisfy the plan formally while leaving the affected C/M items substantively open. Approvable for execution after the F1/F2/F3 fixes; safer after F4–F7.

\*\*Provenance note (echoing the standard the prior reviews applied):\*\* \`v2.1\_review.md\` is not attached. Plan6's numbering (C1–C6, M1–M18) does not match the last visible review (C1–C5, M1–M9). From the way the Steps name items, V2.1-review is a renumbered/expanded merge of the attached Muse and Claude V1 reviews plus the revised adversarial review of V2 — but I cannot verify that plan6 covers all of it. This is the same chain-of-provenance problem the attached Muse review flagged against plan5, and the plan should not repeat it silently. \*\*Minimum fix:\*\* attach \`v2.1\_review.md\` (or record its IDs and Acceptance paragraphs in plan6's own steps) so the scorecard re-grade in Step 12 has a fixed target.

\---

\#\# What plan6 gets right (kept)

\- \*\*Sequencing follows the prior reviews' fix order\*\* — C2, C3, C4, C5, C1, pool budget, then pre-launch batch. Correct dependency order.  
\- \*\*Honest boundaries stated twice\*\* — no toolchain means tests are "designed with pass criteria, never executed or claimed green"; no Neon/Fly access means \`SHOW max\_connections\`, benchmarks, and fencing proofs ship as procedures. That is the discipline the prior reviews required.  
\- \*\*Six provenance labels\*\* and \*\*fixed-string/parser methods on every count and negative\*\* closes the "Verified does too much work" defect.  
\- \*\*\`never present immediate as a fence\`\*\* in Step 3 is the exact correction the prior review of V2 required.  
\- \*\*C3 acceptance includes forced-replacement/crash-loop/overlap tests\*\*, not just graceful restart. Correct.  
\- \*\*C4 acceptance names the 4 crash tests\*\* and the spend ceiling. Correct shape.  
\- \*\*C5 includes "purge unsupported exactly-once wording"\*\* rather than trying to design around it. Correct.  
\- \*\*Batching owner inputs\*\* into one approval list rather than dripping them as blockers is the right project discipline.  
\- \*\*Scorecard re-audit with section evidence\*\* and \*\*no row left at Fail/blocker without dated gate and owner\*\* matches the review's own closing requirement.  
\- \*\*Highest-risk validation calls out C2 handler and C3 fencing\*\* explicitly. That is the pair I would have chosen too.

\---

\#\# Critical findings

\#\#\# F1. C2's proposed mechanism is asserted, not verified — and may not exist

\*\*Plan6 Step 2:\*\* \*"Specify the §2.1 six-step handler with explicit \`workflowIDReusePolicy: 'return-existing'\`..."\*

\*\*Why this is the highest-risk item in the plan:\*\*

\- V2 §7.1 and the attached Claude V1 review both state \`enqueueInTransaction\` does \*\*not\*\* support \`duplicationPolicy: 'return-existing'\`.  
\- \`workflowIDReusePolicy\` is a distinct concept from \`duplicationPolicy\`. It may exist on \`startWorkflow\`, and it may accept a \`'return-existing'\` value — but whether \`enqueueInTransaction\` accepts it, and what the legal values are, is not established anywhere in the attached evidence.  
\- The plan hedges with \*"re-verify the TS client reference"\*, but a hedge is not a decision. If the option does not exist, Step 2 as written will produce a handler design based on a non-existent API, and the C2 Acceptance paragraph (which the Success Criteria say must be satisfied verbatim) may be unachievable.

\*\*Correction before execution:\*\* Step 2 must specify:

1\. \*\*Which API\*\* carries \`workflowIDReusePolicy\` (TS client reference name and signature) and whether \`enqueueInTransaction\` accepts it.  
2\. \*\*If not supported\*\*, the fallback: business row \`INSERT ... ON CONFLICT DO NOTHING RETURNING id\`, then \`enqueueInTransaction\` \*\*only when a row was inserted\*\*, then treat duplicate-workflow-ID on \`enqueueInTransaction\` as a successful idempotent response. This is the pattern V2 §7.1 gestures at and my prior review recommended; it is the safe path regardless of \`workflowIDReusePolicy\`'s existence.  
3\. \*\*A note in V2.1 §7.1\*\* stating which mechanism is used and why, so the reader is not dependent on an unverified option name.

Otherwise the plan will produce a V2.1 whose central atomicity claim rests on the same unverified mechanism V2 was criticized for.

\#\#\# F2. "No blocking open questions" contradicts the four batched owner inputs — and two of them gate C/M items

\*\*Plan6 Risks/Open Questions:\*\* \*"No blocking open questions for execution. Undecidables are labeled assumptions or owner-approval items in V2.1."\*

\*\*Plan6 Context/Approach simultaneously:\*\* \*"Owner inputs (region, Chatwoot hosting, Strategy A confirmation, first vertical) are batched into one approval list, not dripped as blockers."\*

\*\*Success Criteria simultaneously:\*\* \*"C6 single vertical plus paid pilot offer."\* — C6 cannot be closed without a vertical.

\*\*Why this fails:\*\* two of the four batched inputs are the substance of C/M items:

\- \*\*C6\*\* is "single vertical \+ paid offer \+ acquisition hypotheses." With no vertical, V2.1 can only say \`\[Needs approval — owner: vertical\]\`. Success Criterion "C6 closed to its stated Acceptance paragraph" then fails.  
\- \*\*M2\*\* (per Step 8\) is "region decision procedure." If the region is unknown, V2.1 can only present a procedure, not a decision. If the Acceptance for M2 requires a decision, it fails; if it requires a procedure, then region is not actually a batched input.

\*\*Correction:\*\* Plan6 must choose honestly and say which:

\- (a) \*\*V2.1 ships with \`\[Needs approval — owner: vertical\]\` and \`\[Needs approval — owner: region\]\`\*\*, and the scorecard marks C6 and M2 as "closed on owner sign-off" — a dated gate, per the Success Criteria's own rule about Fail/blocker rows.  
\- (b) \*\*Owner supplies vertical and region before Step 8\*\*, and the four batched inputs shrink to two (Strategy A and Chatwoot hosting).  
\- (c) \*\*Split the C6 deliverable\*\* into "vertical selection framework \+ named candidate list" (closable now) plus "named vertical" (gated on owner).

As written, the plan's own Success Criteria ("C6 closed") cannot be true if the plan's own Approach says the vertical is batched. This is the same class of error as V2's overconfident "Verified" labels — the plan is being asked to correct it in V2.1, not reproduce it in itself.

\#\#\# F3. Step 8 is a mega-step bundling \~a dozen M items, which makes the scorecard re-grade unsound

\*\*Plan6 Step 8 enumerates:\*\* C6, M4, traceability completion, M8, M2/M3, RLS deferral, M13/M14, M15, M10, M11, M12, M7, M5, M6 — all in one step.

\*\*Why this fails Step 12:\*\* Step 12 says \*"re-grade every scorecard row with evidence."\* If Step 8 is one step, then any one of its sub-items being incomplete leaves Step 8 "in progress" and \*\*no C/M item can be closed\*\* — either all twelve close, or none do. That collapses the scorecard re-audit into a single fail/pass bit.

\*\*Correction:\*\* Break Step 8 into lettered sub-steps grouped by domain, each mapping to named M items, e.g.:

\- \*\*8a. Product and offer.\*\* C6, WTP evidence, differentiation, distribution hypotheses.  
\- \*\*8b. Roadmap, migration, versioning.\*\* M8, M10, M7, M12.  
\- \*\*8c. Ops and safety.\*\* M2, M3, RLS deferral, M11, M13, M14, M15.  
\- \*\*8d. Fairness, queues, journey.\*\* M4, M5, M6, traceability completion.

That lets Step 12 re-grade each M item against the evidence in its own sub-step.

\---

\#\# Major findings

\#\#\# F4. C6 is under-specified for a C-level finding

Step 8 allocates one line to C6: \*"Single vertical \+ paid offer \+ acquisition hypotheses (C6)."\* For a C-level finding, plan6 should specify the \*\*minimum content\*\* V2.1 must contain to close it:

\- \*\*One named vertical\*\* (e.g., "roofing contractors, US Southwest, 2–10 crews" — the specificity level, not the specific choice).  
\- \*\*One named paid offer\*\*: price band, term length, what is included/excluded, pilot terms (duration, discount, what is explicitly not free).  
\- \*\*3–5 acquisition hypotheses\*\*, each with channel, message, and a falsifiable decision threshold (e.g., "if cold-email reply rate \<2% over 200 sends, retire the channel").  
\- \*\*Willingness-to-pay evidence threshold\*\* — the prompt5 §9 standard ("10 paid pilots at a stated price, not surveys") should be restated as V2.1's acceptance bar.

Without these enumerated, a writer can satisfy C6 with a paragraph naming a vertical and a price and call it closed.

\#\#\# F5. C4's spend-cap unit is unspecified

Step 4 says \*"per-run spend caps plus step/recovery retry bounds for model calls"\* but does not say the cap is expressed in dollars, tokens, or calls. The choice determines the mechanism:

\- \*\*Dollars\*\*: requires a pre-computed cost estimate per run; can be wrong if the model upgrades.  
\- \*\*Tokens\*\*: requires a token-price table; can drift when the provider changes pricing.  
\- \*\*Calls\*\*: requires knowing model context length; can be wrong under tool-chain changes.

The state machine must name the unit, or the 4 crash tests in C4 cannot have pass criteria. This is a small but decisive specification gap.

\#\#\# F6. C3's fencing mechanism is unnamed

Step 3 specifies the \*\*discipline\*\* (worker-only VMID, serial stop/fence/start, never \`immediate\` as a fence, forced-replacement test) but not the \*\*mechanism\*\*. Candidate mechanisms:

\- \*\*DB-backed advisory lock\*\* (\`pg\_advisory\_lock\` on a key derived from \`DBOS\_\_VMID\`) held for the life of the process — strongest, exercises the same DBOS sysdb the worker depends on.  
\- \*\*Fly API poll\*\* for machine \`state \== "stopped"\` before starting the new process — matches Fly's machine semantics but is a different failure surface.  
\- \*\*DBOS executor-ID handoff with a short quarantine window\*\* — uses DBOS's own recovery semantics but requires an app-side coordinator.

V2.1 should name one (or compare two and pick). Otherwise the forced-replacement test has no specific behavior to assert.

\#\#\# F7. "Correction pass, not a rewrite" is contradicted by the scope

Plan6 asserts "Correction pass, not a rewrite — V2's §7 direction is preserved." The scope is:

\- 6 C-items, 18 M-items, accuracy sweep, audits, re-grade.  
\- Four repo re-verifications (workflow\_runs, 230-endpoint inventory, 58-table disposition, federation term).  
\- Per-pool budget table with DBOSClient default verified.  
\- Scenario/checkpoint economics table.  
\- Fencing procedure.  
\- Replay protocol.  
\- Banned-phrase sweep.

This touches §3, §7, §9, §10, §11, §12, §13, §15, §16, §17, §18, Appendix T, and Appendix L. That is not a correction pass in any ordinary sense; it is a substantial multi-section rewrite preserving §7's direction statement. Either drop the "not a rewrite" framing or size it (approximate replacement count, expected delta in document length, sections substantively replaced vs. verbatim carried forward). The plan should also specify that V2.1's section-by-section provenance map records each section as one of: \`carried-forward-verbatim\`, \`carried-forward-with-amendments\`, \`replaced\`, \`new\`.

\#\#\# F8. The endpoint inventory and table disposition risk being prose, which is exactly the failure V2 was reviewed for

Step 1 says \*"enumerate all 230 endpoints with file:line and disposition ... list all 58 tables with keep/defer/retire disposition."\* This is the correct scope — but plan6 does not specify the \*\*format\*\*. V2's failure was producing category-level summaries in place of route-level matrices. A writer can satisfy Step 1 with a bulleted list and the scorecard re-grade in Step 12 cannot verify coverage.

\*\*Correction:\*\* specify the columns. For endpoints: \`method \| path \| file:line \| disposition (launch-critical / retained-unpromoted / deferred / retired / excluded) \| launch-critical Y/N \| existing test file\`. For tables: \`table \| disposition (keep / defer / retire) \| phase or gate \| references (repo \+ test)\`. Fixed-column tables, not bullets, or Step 12's coverage check has nothing to verify against.

\#\#\# F9. The scorecard to be re-graded is unnamed, and if it ships in §5 of V2.1 the audit is circular

Step 12 says \*"re-grade every scorecard row with evidence."\* Which scorecard?

\- V2's Appendix R (18 recommendations)?  
\- V2's §18.3 ADR table?  
\- The prompt5-requirements scorecard from the prior review?  
\- A new §5 in V2.1?

If V2.1 ships a \*\*new §5\*\*, the scorecard is self-graded: the document being audited supplies its own pass/fail table. That is a circularity the prior reviews flagged in different terms.

\*\*Correction:\*\* name the source scorecard (I would require the prompt5 §5-requirement table from the prior review, extended to C1–C6/M1–M18), and place the \*\*graded\*\* table in a \*\*review appendix\*\* of V2.1 (marked "graded by independent review, dated"), not in a top-level §5.

\---

\#\# Minor findings

\- \*\*F10. \`executed-test\` provenance label will be applied zero times in this pass.\*\* Plan6 should say so explicitly and reserve it for a future run, so a reader cannot infer that any V2.1 claim is test-passed.  
\- \*\*F11. The four "named proposals" in the rejection register (Step 10, M17) are not named.\*\* They come from \`v2.1\_review.md\`, which is not attached. Plan6 should name them by short label (e.g., "per-tenant Chatwoot secrets — accepted; outbox pump — rejected; \`return-existing\` dedup — rejected by API; per-tenant feature flags — rejected") so a reader can verify the register actually covers what the review asked.  
\- \*\*F12. The banned-phrase rule is coarse.\*\* Banning "exactly-one-POST" will collide with a legitimate C2 claim: if the safe pattern is adopted (insert-returning \+ enqueue-on-insert), the handler can honestly claim \*\*exactly one enqueue\*\* provided the mechanism is stated. Restate as: \*no unqualified "exactly once" for external providers — the mechanism must be named and the provider docs must support it; for internal DB mutations, "exactly once" is allowed when the mechanism is stated.\*  
\- \*\*F13. "§2.1 six-step handler" — where is §2.1?\*\* Step 2 references "§2.1." V2 §2 is product strategy. The reference must be to V2.1's new §7.1 (or to a section of \`v2.1\_review.md\`). Plan6 does not say which; a reader will not find §2.1 in V2. Fix the cross-reference before it propagates into V2.1.  
\- \*\*F14. "Federation" term (Step 1).\*\* The plan says to define or remove the term, but does not say which — or what "remove" means (delete the use, or replace with a named concept). Specify: either a one-sentence definition or a named replacement.  
\- \*\*F15. Phase 0 prototype requirement for C2 and C3.\*\* V2.1's roadmap should name "prototype the C2 handler and C3 fencing in Phase 0" as an acceptance criterion, distinct from the design pass. Plan6's highest-risk-validation section implies this but does not require it. Without a prototype gate, design-only validation is treated as complete validation — exactly the pattern the prior reviews criticized.  
\- \*\*F16. \`transaction\_completion\` grant should be explicit in M12's grant matrix.\*\* V2 §9 implied \`app\` writes both schemas, which includes DBOS internal tables including \`transaction\_completion\`. The grant matrix (Step 8, M12) should name this explicitly, not bundle it under "DML on both schemas."  
\- \*\*F17. V2's header should get a superseded-by pointer.\*\* Success Criteria say V2 stays byte-identical — correct — but nothing says a reader opening V2 in six months will know V2.1 exists. Add a one-line header edit to V2 recording supersession, logged in the migration log. (The alternative — no pointer, byte-identical — is defensible if the plan states that choice; it does not.)  
\- \*\*F18. Owner sign-offs should be recorded in V2.1's owner-decisions appendix with timestamps and named owners.\*\* Plan6 says owner inputs are batched, but V2.1 must record them as named decisions with dates (as the prior reviews required of price/pilot decisions), not imply them by an "Approach" line.  
\- \*\*F19. Sensitivity cases should name the expensive-tenant tail.\*\* V2 §13 correctly identified the "autonomous 24/7 inbox" tenant as the only scenario that can go negative. Step 6 says "sensitivity cases" without requiring that specific case. Named tails, not "sensitivity cases" in the plural, or a writer can pick benign variations and call the sensitivity done.  
\- \*\*F20. Scorecard rows that depend on owner inputs are not marked as such.\*\* Even after F2 is resolved, the scorecard re-grade should flag C6, M2, and any M item with an \`\[Assumption\]\` or \`\[Needs approval\]\` residual as \*\*"closed to the extent the input is available; gated on owner."\*\* Otherwise the re-grade will quietly grade "closure" for items that are actually "closed pending input."

\---

\#\# Scorecard: can plan6 close the items it names?

\| Item \| Plan step \| Can plan6 close it as written? \| Gate \|  
\|---\|---\|---\|---\|  
\| C1 \| Step 6 \| \*\*Yes\*\*, if the model shows per-input assumption columns and a not-measured column \| Labels every input \|  
\| C2 \| Step 2 \| \*\*Risky\*\* \| F1 (verify API or fall back) \|  
\| C3 \| Step 3 \| \*\*Yes\*\*, if F6 (mechanism) and F15 (Phase 0 prototype) are resolved \| F6, F15 \|  
\| C4 \| Step 4 \| \*\*Yes\*\*, if F5 (cap unit) is resolved \| F5 \|  
\| C5 \| Step 5 \| \*\*Yes\*\*, if the provider matrix carries a key-window column \| Step 5 must require it \|  
\| C6 \| Step 8 \| \*\*No\*\* \| F2 (no vertical → no close) and F4 (under-specified) \|  
\| M1 \| Step 7 \| \*\*Yes\*\* \| — \|  
\| M2 \| Step 8 \| \*\*Risky\*\* \| F2 (no region → no close) \|  
\| M3 \| Step 8 \| \*\*Yes\*\*, as \`\[Unknown\]\` with owner \| — \|  
\| M4 \| Step 8 \| \*\*Yes\*\*, if benchmark designs are procedures with pass criteria, not results \| — \|  
\| M5 \| Step 8 \| \*\*Yes\*\* \| — \|  
\| M6 \| Step 8 \| \*\*Yes\*\* \| — \|  
\| M7 \| Step 8 \| \*\*Yes\*\* \| — \|  
\| M8 \| Step 8 \| \*\*Yes\*\* \| — \|  
\| M10 \| Step 1 \+ 8 \| \*\*Yes\*\*, if the schema read produces a \*\*named fact\*\* ("wake timestamp persisted: yes/no") driving the adopt-vs-notify choice \| Step 1 must produce the fact \|  
\| M11 \| Step 8 \| \*\*Yes\*\* \| — \|  
\| M12 \| Step 8 \| \*\*Yes\*\*, if F16 (\`transaction\_completion\` grant named) \| F16 \|  
\| M13 / M14 \| Step 8 \| \*\*Yes\*\* \| — \|  
\| M15 \| Step 8 \| \*\*Yes\*\* \| — \|  
\| M16 \| Step 10 \| \*\*Yes\*\*, if F10 (\`executed-test\` zero-times note) is included \| F10 \|  
\| M17 \| Step 10 \| \*\*Partial\*\* — register content and the four named proposals are unspecified \| F11 \|  
\| M18 \| Step 9 \| \*\*Yes\*\* \| — \|

\*\*Six rows close only with the referenced fix; two rows (C6, M2) cannot close within the plan without an owner decision.\*\* Plan6's Success Criteria assert all 6 C and 18 M items close; the scorecard says they cannot, as written.

\---

\#\# Bottom line (revised)

Plan6.md is a good execution plan: sequenced correctly, honest about what cannot be validated here, and it names the right two highest-risk mechanisms (C2 handler and C3 fencing). It will produce a materially better V2.1 than V2 — one that is closer to what the attached reviews asked for.

But it is not yet internally consistent with its own Success Criteria, and one of its central mechanisms may not exist. Before execution:

1\. \*\*Close F1.\*\* Verify or replace \`workflowIDReusePolicy: 'return-existing'\` with the insert-returning fallback. Name the mechanism now, in the plan.  
2\. \*\*Close F2.\*\* Either mark C6 and M2 as \`\[Needs approval\]\` in V2.1 and adjust the Success Criteria, or obtain the vertical and region before Step 8\.  
3\. \*\*Split Step 8\*\* into 8a–8d mapping to named M items (F3).  
4\. \*\*Enumerate C6's minimum content\*\* (F4) and \*\*specify the C4 cap unit and the C3 fencing mechanism\*\* (F5, F6).  
5\. \*\*Add a Phase 0 prototype acceptance gate\*\* for C2 and C3 (F15).  
6\. \*\*Name the scorecard source\*\* and place the graded table in a review appendix (F9); \*\*name the four rejection-register proposals\*\* (F11); \*\*reword the banned-phrase rule\*\* (F12); \*\*record owner sign-offs in V2.1's owner-decisions appendix\*\* (F18); \*\*specify endpoint and table inventory column formats\*\* (F8); \*\*name the expensive-tenant sensitivity case\*\* (F19); and \*\*mark owner-gated scorecard rows as gated\*\* (F20).

With those in place, plan6 is approvable for execution. Without them, it will produce a V2.1 that formally inherits the review's language while reproducing the same class of overclaim — declared closure on items whose required inputs or mechanisms are not actually available — that the review was created to correct.  
