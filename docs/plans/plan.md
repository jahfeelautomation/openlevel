## Goal

Execute `prompt1.md` as written: investigate the local OpenLevel checkout and produce the DBOS + Fly.io + Neon implementation plan it specifies. Planning only — no source, schema, dependency, or infrastructure changes.

## Success Criteria

- A single new plan document exists at `openlevel/docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md` (created; that directory does not exist yet), covering all 18 sections prompt1 §13 requires.
- Every repository-specific claim in it cites verified file paths/symbols; every framework claim cites inspected official DBOS/Neon/Fly.io docs; facts, assumptions, recommendations, and unresolved questions are labeled as such.
- Final report answers prompt1 §14's six questions (files/tests inspected, tests executed + results, evidence-backed vs. needs-approval decisions, production-readiness risks, plan location).
- Strict working rules honored: nothing modified except the new plan doc; no installs, deploys, commits, or secret exposure.

## Approach

Treat prompt1 as the exhaustive checklist and the repo as ground truth. Phase Zero recon first (verify `deepwiki.md` claims against code, count and run tests), then draft the target architecture from evidence, then write the document in one pass. Key verified starting facts shaping the work: `bootstrap()` in `server/index.ts` confirms the pg-boss + Hono same-process coupling; `server/jobs/` contains the four files prompt1 names plus co-located tests; test files number 182 (close to the claimed ~190); `vitest.config.ts` shows PGlite-backed integration tests; git tree is clean except untracked `deepwiki.md` and `docs/plans/`.

Assumption (correctable at review): "under docs/plans folder" locates prompt1; the deliverable goes to the `docs/architecture/...` path prompt1 §13 mandates, not back into `docs/plans/`. See open question below.

## Steps

1. **Baseline the checkout.** Record git branch/commit/status; read `package.json`, lockfile, `tsconfig.json`, Vite config, build scripts; confirm Node ≥22 toolchain present.
2. **Map the application.** Read server composition (`server/index.ts`, `server/app-env.ts`, `server/dev-server.ts`), `server/db/` + `db/` schema/migration mechanism, middleware (`auth`, `location-access`), all `server/routes/` contracts, all `server/repos/` tenant scoping, `server/lib/` domain logic and provider adapters (Anthropic, Chatwoot, Twilio, Stripe/payments), agent config/tool permissions/approval behavior, `src/` API usage, `openconnector/` mobile surface, Docker/env docs.
3. **Map async execution.** Document `boss.ts`, `agent-reply.ts`, `workflow-dispatcher.ts`, `workflow-runner.ts`: triggers, payloads, tenant context, retry/backoff, ordering, concurrency, idempotency assumptions, in-process wait timers, resumption state.
4. **Testing baseline.** Count test files/tests; run `typecheck` and `test` (non-destructive); record pass/fail/skip, runtime, flakes, PGlite vs. fake-DB vs. real-Postgres split; never weaken or skip a test.
5. **DBOS/Neon/Fly research.** Inspect current official docs for the TypeScript SDK (workflows, steps, queues, scheduling, versioning, concurrency/partitioning), Neon pooled-vs-direct guidance for the DBOS system DB, and Fly process groups/`release_command`/health checks. Record exact doc URLs; verify every API named in the plan exists in the recommended SDK version.
6. **Design the target.** Preserve Hono contracts/repos/adapters; map each pg-boss responsibility to DBOS workflows/steps/queues with retry/recovery/acceptance tests; design idempotency (stable workflow IDs, keys, outbox, reconciliation) for SMS/email/payments; tenant-aware partitioning and quotas; durable waits; Neon connection budget and schema/database separation; `Dockerfile` + `fly.toml` with web/worker process groups; observability, admin, backup/RPO/RTO, and threat model.
7. **Commercial + economic pass.** Inventory SaaS gaps (registration, provisioning, billing-for-our-SaaS vs. customer invoicing, metering, quotas, suspension, onboarding/offboarding) and draft the unit-economics model from documented pricing only, assumptions labeled.
8. **Write the plan doc.** Create `openlevel/docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md` with all 18 required sections, traceability matrix, ADRs, Mermaid diagrams, directory/config inventories, and deployment + production-readiness checklists.
9. **Final report.** Report inspected files/tests, executed test results, evidence-backed vs. needs-approval decisions, blocking risks, and plan location.

## Validation Plan

- `git status --short` before and after: only the new plan file (plus pre-existing untracked items) present; no tracked file modified.
- `npx tsc -p openlevel/tsconfig.json --noEmit` and `npm test --prefix openlevel` (or repo's `vitest run`): observed results recorded verbatim in plan and report, never claimed without running.
- Checklist audit of the deliverable against prompt1 §13: all 18 sections present, §14 end-report questions answered, every repo claim has a path/symbol, every framework claim has an inspected doc URL.
- Highest-risk validation: the DBOS resilience test layer (§9, 19 scenarios) and duplicate-side-effect analysis (SMS/email/payment crash-after-success) must be explicit and test-mapped — this is where the plan will be adversarially reviewed.

## Risks / Open Questions

- **Output path (assumed, please confirm):** deliverable goes to `openlevel/docs/architecture/OPENLEVEL_DBOS_FLY_NEON_IMPLEMENTATION_PLAN.md` per prompt1 §13. Say so if you want it under `openlevel/docs/plans/` instead.
- Test suite may be slow/flaky (PGlite cold starts noted in vitest config) or require real Postgres; will record environment limits rather than force green.
- DBOS/Neon/Fly docs may have changed since prompt1 was written (e.g., Neon pooling guidance, SDK APIs); any drift becomes a labeled finding, not a silent substitution.
- Pricing research is estimate-only; every cost figure will carry its source or be marked an assumption.
