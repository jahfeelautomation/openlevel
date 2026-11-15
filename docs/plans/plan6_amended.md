## Goal

Execute `docs/plans/plan6.md` as amended by `docs/plans/plan6.1_review.md` §7 (9 amendments): produce `docs/architecture/OPENLEVEL_DBOS_FLY_NEON_ARCHITECTURE_V2_1.md`, closing C1–C6/M1–M18 per the review's §4 order and §5 gating. This file records the amendments; it does not replace plan6 (byte-identical).

## The 9 amendments (review §7 → execution)

1. **Inventory-only first.** Endpoint/table enumeration captures file:line plus count method with NO dispositions; MVP dispositions assigned only after the vertical recommendation. Traceability covers launch-critical plus cross-cutting surfaces; grouped out-of-scope marking for the rest (no 230-row pre-implementation audit).
2. **C2 handler in V2.1 §7.1.** Keep `enqueueInTransaction` (never swap to `enqueue()` for dedup); distinguish `workflowIDReusePolicy` from `duplicationPolicy`; require pinned-SDK compile verification; unique business-event insert with enqueue-only-on-new-row; duplicate path reads existing status; durable idempotency retention separate from workflow-history retention. Option validity unknown until compiled/tested — neither assumed valid nor invalid.
3. **C3 Fly lifecycle fencing.** One worker Machine, worker-only VMID (never app-wide `[env]`), one-at-a-time rolling or operator-controlled stop/verify/start; no canary/bluegreen/`immediate`-as-fence; forced-replacement proof gate. No custom fencing service for MVP.
4. **C4/C5 operation/attempt model.** Operation (stable ID, budget, billing) vs. attempts (own IDs, pre-call durable write, fingerprint); USD micro-unit cap plus token and attempt caps; uncertain reservations quarantined, never auto-refunded; 4 crash tests; no unsupported external exactly-once language.
5. **C1 launch-mix economics.** Model platform-AI + BYO messaging first with explicit placeholders and the 24/7 high-usage tail; managed messaging as labeled future sensitivity only.
6. **M1 pools.** Every pool separate with DBOSClient default (documented 10 absent custom pool) and per-machine multiplication; `SHOW max_connections` as provisioning procedure.
7. **Split pre-launch batch.** Four workstreams: (a) product/offer; (b) ops/security/billing; (c) journeys/queues/traceability; (d) migration/versioning. Owner approvals marked pending; C6 specifies vertical, pilot offer, acquisition hypotheses, differentiation, 10-paid-pilot bar.
8. **Evidence + close-out.** Name `docs/plans/v2.1_review.md` as scorecard source; author self-audit in an appendix; rejection register naming the 6 contested alternatives; `executed-test` stated zero; 12-item report once; no source/schema/test/infra changes.
9. **Wording.** "No questions block drafting; named owner decisions gate production/commercial launch" (not "no blocking open questions"); "targeted V2.1 correction revision preserving the V2 architecture and §7 direction" (not "correction pass, not rewrite").

## Amended execution order (review §4)

- **Step 0 (done):** root `/Users/sherwin/Documents/openlevel/openlevel`, `master` @ `2634f8cd0eac`, status `M .gitignore` + untracked `deepwiki.md`, `docs/architecture/`, `docs/plans/`; V2.1 path absent; C1–C6/M1–M18 headings verified present in local `v2.1_review.md` (24 headings); 230 endpoints + 58 tables inventoried to working notes without dispositions; `workflow_runs` schema read (no wake-timestamp column → M10 notify-only); federation defined from `server/lib/federation-types.ts` (Acme Hub gateway `/federation/*` wire contract).
- **Step 1:** C2 handler, C3 fencing, C4/C5 state machines + tests, M1 pools.
- **Step 2:** vertical recommendation + pilot offer + acquisition tests; then MVP dispositions + compact traceability.
- **Step 3:** M2/M3/M4/M5/M6/M7/M8/M10/M11/M12/M13/M14/M15 + RLS deferral + count reconciliation + rewind policy.
- **Step 4:** ledger, rejection register, appendix self-audit, 12-item report, V2.1 assembly, final audits.

## Gating (§5)

Pre-implementation blockers: C2, C3, C4, C5, tenant/consent/credential boundaries. Pre-launch gates (designed now, proven later): C1, C6, M1, M2, M3, M4-benchmarks, M7, M10-if-live-state, M12, M13/M14-live, M15. Deferred: full 230/58 audits, managed-messaging forecast, Conductor, multi-worker, RLS rollout, benchmarks execution.

## Boundaries

Planning-execution only. No toolchain → tests/benchmarks designed with pass criteria, never executed. No Neon/Fly access → limits/fencing proofs are specified procedures with placeholders. Owner inputs batched; drafting never blocks. V2, V1, plan6 byte-identical; new artifacts only this file and V2.1.
