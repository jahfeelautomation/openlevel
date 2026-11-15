## Goal

Execute [prompt1.md](/Users/sherwin/Documents/openlevel/openlevel/docs/plans/prompt1.md) as amended by [prompt2.md](/Users/sherwin/Documents/openlevel/openlevel/docs/plans/prompt2.md): investigate the local OpenLevel checkout and produce the DBOS + Fly.io + Neon architecture document. This plan supersedes [plan.md](/Users/sherwin/Documents/openlevel/openlevel/docs/plans/plan.md) (which stays untouched); all 10 of prompt2's mandatory amendments are binding. Planning only — no source, schema, dependency, or infrastructure changes, and no implementation work.

## Success Criteria

- A single new document exists at `docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md` relative to the git root resolved by `git rev-parse --show-toplevel` (verified: `/Users/sherwin/Documents/openlevel/openlevel`, so the deliverable is `/Users/sherwin/Documents/openlevel/openlevel/docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md`), covering all 18 sections prompt1 §13 requires.
- An evidence ledger underpins every repository-specific claim (source file, symbol, observed behavior, corresponding tests); verified behavior is distinguished from assumptions and proposed improvements.
- Tenant identity is traced end-to-end (HTTP auth → repos → job payloads → workflow args/steps → retries/recovery → scheduled execution → webhooks → agent tools/provider callbacks), with every loss/forgery/confusion point identified.
- DBOS runtime topology (init, workflow registration, launch, recovery) is verified against official SDK docs as workable across separate Fly web/worker process groups before being recommended.
- Every important integration has a crash-after-provider-success analysis with its mechanism (idempotency key, transactional outbox, provider dedup, reconciliation, or manual intervention); no exactly-once claim without a demonstrated mechanism.
- An event-by-event compatibility matrix maps every pg-boss queue/job and workflow state transition (pending, running, retries, dead letters, delayed, historical run IDs) to its DBOS equivalent, with a rollback strategy that never lets both systems execute the same side effect.
- Final report answers prompt1 §14's six questions and prompt2's five approval criteria (behavioral fidelity, tenant isolation, durable execution, operational simplicity, commercial viability).
- Working tree preserved: no existing tracked or untracked file modified; exact before-and-after `git status` reported.

## Approach

Evidence before prose. Build the ledger, compatibility matrix, DBOS capability verification, decision records, and risk analysis as working artifacts first (in-session, not as repo files), then assemble the final document and audit it against the 18 required sections — never a single unverified drafting pass. Grounded starting facts: repo root is `/Users/sherwin/Documents/openlevel/openlevel` with `docs/architecture/` not yet existing; git tree holds only the pre-existing untracked `deepwiki.md` and `docs/plans/`; `bootstrap()` in `server/index.ts` couples pg-boss workers and Hono in one process; `server/jobs/` holds the four prompt1-named files with co-located tests; 182 test files vs. the claimed ~190; `vitest.config.ts` uses PGlite with no global setup files, and only `server/lib/vault.test.ts` references `process.env` among server tests (verification of test side effects still required before any run); npm commands come from `package.json` scripts (`typecheck`, `test`), never from memory.

## Steps

1. **Resolve paths and snapshot the tree.** Run `git rev-parse --show-toplevel`; record branch, commit, and full `git status`; confirm the deliverable path above. This snapshot is the before-image for the final report.
2. **Baseline the checkout.** Read `package.json`, lockfile, `tsconfig.json`, Vite config, build scripts; confirm the Node ≥22 toolchain; note Docker/env/deployment docs.
3. **Map the application into the evidence ledger.** For each claim record file, symbol, observed behavior, and tests: server composition, `server/db/` + `db/` schema/migration mechanism (`schema.sql`, `migrate.ts`, `seed.ts`), middleware, every route contract, every repo's tenant scoping, domain libs, provider adapters, agent config/tool permissions/approval behavior, `src/` API usage, `openconnector/` surface.
4. **Trace tenant identity end-to-end.** Follow tenant/location identity across HTTP auth/authorization, repo queries/transactions, job payloads, workflow args/steps, retries/recovery, delayed/scheduled execution, inbound webhooks, and agent tools/provider callbacks. List every point where context could be lost, forged, or confused across a restart, retry, or delayed run.
5. **Map async execution.** Document `boss.ts`, `agent-reply.ts`, `workflow-dispatcher.ts`, `workflow-runner.ts`: triggers, payloads, tenant context, retry/backoff, DLQ, ordering, concurrency, idempotency assumptions, in-process wait timers, resumption state.
6. **Inspect before testing, then run the baseline.** Read test setup, env handling, and integration mocks first; confirm no production credentials or real customer-facing operations can trigger; discover commands from `package.json` scripts. Then count files/tests and run `typecheck` and `test`, recording pass/fail/skip, runtime, flakes, and the PGlite vs. fake-DB vs. real-Postgres split. Never weaken or skip a test.
7. **Verify DBOS/Neon/Fly capabilities from official docs.** Confirm TypeScript SDK init, workflow registration, launch, recovery, transactions, versioning, and queue concurrency/partitioning; how web and worker processes share the registry and system database across Fly process groups; Neon pooled-vs-direct behavior for the DBOS system DB; Fly `release_command`, health checks, and process-group semantics. Record exact doc URLs; recommend nothing the docs don't support.
8. **Analyze external side effects as invariants.** For each important integration (Anthropic, Chatwoot, Twilio, payments, SMS/email), work the crash-after-provider-success case and assign its mechanism: idempotency key, transactional outbox, provider-side dedup, reconciliation, or manual intervention.
9. **Build the compatibility matrix and migration design.** Map every queue/job and workflow state transition to its DBOS equivalent (pending, running, retries, dead letters, delayed, historical run IDs); define cutover ordering, the pg-boss/DBOS mutual-exclusion rule, and rollback per phase.
10. **Design the target and record ADRs.** Preserve Hono contracts/repos/adapters; design workflows/steps/queues, tenant-aware partitioning/quotas, durable waits, Neon connection budget and separation, `Dockerfile` + `fly.toml`, observability, admin surface, backup/RPO/RTO, threat model, SaaS gaps, and unit economics (documented pricing only, assumptions labeled). Write decision records for material choices first.
11. **Assemble, then audit.** Compose the final document from the ledger, matrix, verification notes, ADRs, and risk analysis; audit it against prompt1 §13's 18 sections, §14's working rules, and prompt2's five approval criteria; correct until stable.
12. **Final report.** Report inspected files/tests, executed test results, evidence-backed vs. needs-approval decisions, blocking risks, before-and-after `git status`, and the plan location.

## Validation Plan

- `git status --short` before and after: the only new artifact is the architecture document; no tracked or untracked file modified (including `docs/plans/plan.md` and `docs/plans/plan_prompt2.md`).
- Test/setup inspection precedes any test run; executed commands are exactly the `package.json` scripts; results recorded verbatim, never claimed without running.
- Ledger audit: every repository-specific architectural claim in the deliverable resolves to a ledger entry (file + symbol + observed behavior + tests).
- Compatibility audit: every pg-boss queue/job and workflow state in step 5 appears in the matrix with a DBOS equivalent, cutover handling, and rollback; mutual exclusion of old/new executors stated.
- Section audit: all 18 prompt1 §13 sections present; prompt2 amendments 1–10 each visibly satisfied; five approval criteria answerable from the document.
- Highest-risk validation: tenant-context integrity across retry/recovery/delayed execution, and the crash-after-provider-success mechanisms — the two areas prompt2 flags for adversarial review.

## Risks / Open Questions

- PGlite-backed suite may be slow/flaky and may not cover DBOS semantics; genuine DBOS behavior may need disposable real Postgres — record environment limits rather than forcing green.
- Official DBOS/Neon/Fly docs may have drifted from prompt1's assumptions; drift becomes a labeled finding with URLs, never a silent substitution.
- Pricing research is estimate-only; every cost figure carries its source or is marked an assumption.
- Open questions: None — per prompt2, do not stop for clarification; anything not decidable from the repo and official docs is recorded in the deliverable as a labeled assumption or unresolved question for human approval.
