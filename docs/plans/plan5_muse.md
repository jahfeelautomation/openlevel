## Goal

Execute the Final Prompt in `docs/plans/plan5.md` (its `FINAL EXECUTION DIRECTIVE`, §§1–27): investigate the checkout and produce `docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md` (or a versioned alternative if the target exists). Planning only — no implementation, no pre-existing file modified, no further planning cycles.

## Success Criteria

- The 18-section architecture document exists per directive §§4/22, answering the five fundamental questions; the final report delivers the nine §26 items plus the five-question statement.
- All plan5 corrections over `plan_prompt4.md` are applied: migration mapping kept separate from the five §19 fields with ownership inside cutover; side-effect checks labeled as 12 original + 2 additions; threats audited as at-least-18; compatibility matrix built before drafting while traceability stays a post-assembly audit; consistency audit bounded at three passes; cleanup restricted to demonstrably new artifacts.
- Conflict rule honored throughout: prompt3 is the technical spec, the final directive controls wherever it explicitly corrects or clarifies; no dependency on any other prompt file; prior plans are read-only references.
- Working tree preserved: before-and-after `git status` (before-state already includes the user-directed `.gitignore` edit) with all pre-existing files byte-identical.

## Approach

Follow the directive's 17-step sequence exactly (§23), evidence before prose: baseline → backfilled six-field ledger → traces → verification → matrix → retention → economics → ADRs → assembly → three separate audits → final status. Two grounded starting facts shape execution: `node` and `node_modules` are both absent in this environment, so step 2 begins with a toolchain gate and, if it fails, records the test-execution limitation per §3/§5 rather than installing anything; and the directive's 16-item SaaS list (§16) differs slightly from prompt3 §16 (organization provisioning vs. ownership, subscription plans added, suspension/reactivation merged) — the directive's list governs and the variance gets noted. The gitignored SDK reference clone is never authoritative; any claim touched from it needs path, commit, and a confirming official-doc URL.

## Steps

1. **Root + snapshot (§4).** Resolve root via `git rev-parse --show-toplevel`; record root, branch, commit SHA, full `git status`, and `docs/architecture/` plus target-file existence; confirm output path.
2. **Baseline (§§5–6).** Full §5 inventory; recount all test figures (never quote prior claims); toolchain gate, then inspect-before-run and execute discovered typecheck/test commands, recording all four statuses plus runtime, flakes, DB-tier split, and gaps. Open and backfill the ledger; classify every conclusion.
3. **Tenant model (§7).** Define the nine entities from code with an evidenced `location_id` verdict and ownership map; trace all 14 boundaries; name the trusted identity source; list every loss/forge/confuse/leak point.
4. **pg-boss baseline (§8).** The four job files plus all discovered consumers; 15 fields per queue/job; verify the six-setting baseline from code/tests only; dissect the wait scheduler.
5. **DBOS + Neon + Fly verification (§§9/14/15).** Verify the 14 SDK capability areas, web/worker topology, and `sleep` vs. suspension (residency, edition, licensing) against six wait-survival conditions plus run-state reuse and blue-green; decide Neon placement, connection budget, and migration ordering; evaluate Fly A/B and recommend one with reasons, with bundling, `release_command`, and honest setup prerequisites.
6. **Matrix before drafting (§§10/12).** Map all 13+ workloads; build the 11-item migration matrix with mapping separate from the five fields; set mutual exclusion, shadow ban, and freeze/drain/migrate/verify/reactivate.
7. **Retention, economics, ADRs (§§13/16/17/18/20/21).** Options A/B/C × two workloads × 16 dimensions with defined (not run) benchmarks; tenancy A/B/C × nine dimensions; 16 SaaS capabilities; eight cost categories with cited official pricing and contribution formula; nine eleven-field ADRs; ten logging fields, 14 metrics, nine admin capabilities, RPO/RTO as needs-approval; at-least-18 threat analysis.
8. **Assemble + three audits (§§19/22/23).** Compose the 18-section document; then separately audit traceability (five-column matrix, 18 scenarios, PGlite-vs-Postgres finding, six tiers), migration (eight §23 checks including shadow), and consistency (12 areas, max three passes, then escalate).
9. **Report (§§24–26).** Full §24 count audits over lists not totals; final `git status`; nine-item report with cleaned artifacts listed.

## Validation Plan

- Deterministic commands from package scripts only; stop-and-record (never install) on missing toolchain, dependencies, or real Postgres.
- Ledger audit: every repo claim resolves to a six-field entry; every framework claim to an official URL plus verified capability.
- Definition audits: mapping-vs-fields separation holds; 12+2 labeling exact; threat count ≥18 reported exactly; matrix-before-drafting ordered before assembly in the working sequence.
- Highest-risk validation: retention-decision evidence, tenant-context survival across retry/recovery/delay, and per-operation recovery guarantees.

## Risks / Open Questions

- Test execution may be fully or partially blocked here (no `node`, no `node_modules`); that becomes a recorded limitation with reduced verification, not a failure to work around.
- PGlite may not support DBOS internals; unavailability of real Postgres narrows DBOS-test claims accordingly.
- Doc or pricing drift since prompt1 becomes labeled findings with URLs, never a silent substitution.
- No blocking open questions for execution. Undecidables are recorded as labeled assumptions or needs-approval decisions in the deliverable and ADRs.
