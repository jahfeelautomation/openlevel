## Goal

Implement `docs/plans/v2.1_review.md`: close its 6 Critical findings (C1–C6) and 18 Major findings (M1–M18) against the V2 architecture, producing a corrected, implementation-ready document at `docs/architecture/OPENLEVEL_DBOS_FLY_NEON_ARCHITECTURE_V2_1.md`. Correction pass, not a rewrite — V2's §7 direction is preserved. Planning-execution only: no source, schema, test, or infrastructure changes.

## Success Criteria

- V2.1 document exists at the direct path (verified absent; V2 and V1 stay byte-identical), carrying V2 forward verbatim except sections replaced per the correction order, each replacement traceable to its C/M item.
- All 6 Critical findings closed to their stated Acceptance paragraphs: C1 scenario/checkpoint economics with measured-vs-unmeasured columns; C2 handler pseudocode plus race/replay tests; C3 enforced worker-only identity with automated fencing and forced-replacement proof design; C4 wallet/attempt state machines, sweeper, spend caps, and 4 crash tests; C5 replay protocol with quarantine semantics and no unsupported exactly-once language; C6 single vertical plus paid pilot offer.
- All 18 Majors resolved or explicitly dated-gated, including: M1 per-pool budget with DBOSClient/datasource pools; M10 item 7 as five-field adoption or honest notify-only; M12 pinned migration tool plus exact grants; M16 provenance labels on every ledger claim; M17 rejection register plus explicit 12-item final report.
- Scorecard re-audit: every §5 row re-graded with section evidence; no row left at Fail/blocker without a dated gate and owner.
- Working tree gains only the V2.1 document; `git status` before/after recorded.

## Approach

Follow the review's §6 correction order exactly: pre-implementation items 1–6 first (C2, C3, C4, C5, C1, pool budget), then pre-launch items 7–14. Targeted repo re-verification precedes drafting for the four items that need repo evidence (`workflow_runs` schema for M10, full 230-endpoint inventory with dispositions for the traceability completion, 58-table disposition list, federation-term definition). Evidence discipline from V2 carries over and tightens per M16: six provenance labels (observed, counted, official-doc, executed-test, assumption, unknown), fixed-string or parser methods on every count and negative, official URLs with access dates, SDK clone supplemental-only with commit. Two honest boundaries: no toolchain here means tests are designed with pass criteria, never executed or claimed green; no Neon/Fly access means `SHOW max_connections`, benchmarks, and fencing proofs ship as specified procedures with labeled placeholders, never as results. Owner inputs (region, Chatwoot hosting, Strategy A confirmation, first vertical) are batched into one approval list, not dripped as blockers.

## Steps

1. **Snapshot + repo evidence.** Resolve git root, record branch/SHA/status, confirm V2.1 path. Read `workflow_runs` schema plus runs-repo methods; enumerate all 230 endpoints with file:line and disposition (launch-critical, retained-unpromoted, deferred, retired, excluded); list all 58 tables with keep/defer/retire disposition; define or remove the federation term.
2. **C2 atomic enqueue.** Specify the §2.1 six-step handler with explicit `workflowIDReusePolicy: 'return-existing'`, business-row conflict path, caller response, and post-retention behavior; re-verify the TS client reference; add race/replay acceptance tests including post-completion and post-retention duplicates.
3. **C3 fencing.** Worker-only executor identity via boot wrapper (remove app-wide `[env]` VMID); restart policy, serial stop/fence/start procedure with automation-vs-operator gating, heartbeat/readiness signal, graceful-shutdown sequence, rollback ID/version preservation, forced-replacement/crash-loop/overlap tests. Re-verify Fly restart-policy and deploy-strategy docs; never present `immediate` as a fence.
4. **C4 wallet.** Reservation (`reserved → settled | refunded | expired`) and provider-attempt state machines; per-run spend caps plus step/recovery retry bounds for model calls; expiry sweeper with cadence, locking, idempotency; short-lived row locks only; unknown-outcome reconcile-before-retry rule; the 4 crash tests proving billing correctness and COGS ceiling.
5. **C5 replay protocol.** Attempt-ID state machine with pre-call durable write, replay-inspects-first rule, stable-key reuse within provider windows, quarantine + explicit at-most-once trade-off where providers lack idempotency/lookup, callback/operator/customer reconciliation paths; purge unsupported exactly-once wording from matrix and appendices.
6. **C1 economics.** Placeholder-but-calculated 5-scale agency model under BYO and managed scenarios with all listed inputs; MRR/COGS/margin/break-even; sensitivity cases; cost per 10k/100k executions per engine; checkpoint volume at 10k–10M with per-unit multipliers and a not-measured column. Formulas plus results, every input labeled.
7. **M1 pool budget.** Per-pool table (Hono reads, web DBOSClient with verified default, web txn pool, worker system pool, datasource pool, migrator/admin) with max size, endpoint, machine count, idle/min, peak; `SHOW max_connections` procedure for provisioning time; explicit headroom math.
8. **Pre-launch batch.** Single vertical + paid offer + acquisition hypotheses (C6); journey lifecycle with cancel/reschedule/expiry/stale rules plus 10k/50k/100k benchmark designs (M4); complete route inventory plus named launch-critical traceability (M-§2.5); Phase 1A/1B split with full per-phase fields (M8); region decision procedure + Chatwoot hosting Unknown (M2/M3); RLS explicit deferral with gated pilot spec (M-§2.4); credential trust boundary + message consent invariants (M13/M14); subscription/wallet lifecycle with dunning (M15); item 7 verdict (M10); worker heartbeat + provisional thresholds + launch resume/fork/cancel policy (M11); pinned migration tool + grant matrix (M12); versioning taxonomy + patch review rule (M7); fairness property + noisy-tenant test + pg-boss grouping comparison (M5); queue derivation formulas as unconfigured (M6).
9. **Accuracy sweep (M18).** Fixed-stack labels, Stripe-fee geography caveat, Twilio attribution, dated DBOS Cloud note, degraded-reads correction, sleep-rule removal or justification, datasource-scope caveat, provider-matrix wording.
10. **Ledger + register + report (M16/M17).** Six-field ledger with provenance per claim and count methods plus raw outputs; rejection/qualification register covering at minimum the four named proposals; explicit 12-item final report checklist.
11. **Assemble V2.1.** V2 text carried forward, corrected sections replaced in §6 order; appendices updated (ledger, sources with access dates, configs, runbooks); §7 direction statement retained verbatim.
12. **Audits + report.** Re-grade every scorecard row with evidence; verify counts, labels (no bare "Verified", no "exact" without proof), banned phrases (exactly-one-POST, 24-hour cap, app-wide VMID, Python-proof-of-TS); final `git status`; concise correction report mapping each C/M item to its V2.1 section.

## Validation Plan

- Each C1–C5 item checked against its review Acceptance paragraph verbatim; C6/M items against their Required-correction bullets.
- Ledger audit: every material claim carries one of the six provenance labels; every count names its method; every external claim has an official URL plus access date.
- Banned-content grep: unsupported exactly-once external language, invented percentages, Python-doc proof of TS behavior, hardcoded machine paths, app-wide executor identity.
- `git status` before/after: V2.1 is the only new artifact; V2, V1, and all plans byte-identical.
- Highest-risk validation: the C2 handler pseudocode against the pinned TS client reference, and the C3 fencing procedure against Fly's documented machine/deploy semantics — the two load-bearing mechanisms.

## Risks / Open Questions

- Tests and benchmarks are designed here, not executed (no toolchain, no Neon/Fly access); acceptance rests on design review plus specified procedures, and the document must say so on every affected claim.
- Cited official URLs may have moved since the review; moved or thinned pages become recorded gaps with fallback citations, not silent substitutions.
- Owner inputs (region, Chatwoot hosting, Strategy A sign-off, first vertical, price points) arrive as one batch; drafting never blocks on them.
- No blocking open questions for execution. Undecidables are labeled assumptions or owner-approval items in V2.1.
