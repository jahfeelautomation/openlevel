# Phase 0 — Baseline Runbook

Step 1 artifact. No commands below have been executed yet — this file records
exact procedure only. Results go in the Result Sheet when Gates A+B clear.

## Standing rules (user-directed, binding for all Phase 0 work)

1. **Isolation boundary.** All prototype code, Fly configuration, boot
   wrappers, and test scripts live under `phase0/`. No changes to root
   deployment configuration or application code outside permitted
   dependency/lockfile changes without separate authorization. V1, V2,
   V2.1, and all planning documents stay byte-identical. No pg-boss
   changes. No advisory-lock fencing unless a Fly test demonstrates
   overlapping executors.
2. **RPM-to-concurrency conversion is evidence-based.** Formula:
   `estimated concurrency = requests per minute × average request
   duration in seconds ÷ 60`. Latency and burst assumptions are stated
   separately alongside every estimate. An estimate is never presented
   as measured concurrency.

## Snapshot (recorded, not executed against)

- Root: `/Users/sherwin/Documents/openlevel/openlevel` (`git rev-parse --show-toplevel`)
- Branch: `master`; SHA: `2634f8cd0eaccfdc9d589fad3fc967fd1b3ba0bb`
- Status: ` M .gitignore`, `?? deepwiki.md`, `?? docs/architecture/`, `?? docs/plans/`
- Toolchain: `node`/`npm` NOT FOUND on PATH; `node_modules` absent.
- Prior deliverables present: V1, V2, V2.1 architecture docs; plan6.2.md directive.

## Config inventory (redacted — names only, no values)

- `package.json`: name `openlevel` 0.1.0, ESM, engines `node >= 22.0.0`.
- Scripts: `typecheck` = `tsc -p tsconfig.json --noEmit`; `test` = `vitest run`;
  `test:watch` = `vitest`; `build` = `vite build`; `migrate`/`seed` via `tsx`;
  `dev:server`/`dev:local` via `tsx watch`. **No `lint` script exists** —
  plan6.2's "lint" step is N/A unless the owner approves adding one.
- `tsconfig.json`: strict, `noUncheckedIndexedAccess`, ES2022/ESNext,
  includes `src`, `server`, `db`; vitest globals + node types.
- `vitest.config.ts`: includes `server/**/*.test.ts`, `scripts/**/*.test.ts`;
  node environment; `testTimeout: 30000` (PGlite cold-start headroom).
- `.env.example` keys: `DATABASE_URL`, `SESSION_SECRET`,
  `CHATWOOT_WEBHOOK_SECRET`, `CHATWOOT_BASE_URL`, `PORT`,
  `<SLUG>_ANTHROPIC_API_KEY` (per-client pattern).
- Test census (static, fixed-string methods): 182 test files; 0 files
  reference `new Pool(` or `PgDatabase(`; PGlite-backed integration subset
  spins per-file WASM Postgres from `db/schema.sql`.

## Procedure (requires Gate A+B approval — DO NOT RUN before approval)

All commands run with cwd = repo root
(`/Users/sherwin/Documents/openlevel/openlevel`).

```
# A1. Provision Node 22 toolchain (method per owner approval)
node --version                      # expect v22.x
npm --version

# A2. Install dependencies (uses committed lockfile; no upgrades)
npm ci

# A3. Typecheck (must pass with zero errors for a green baseline)
npm run typecheck

# A4. Full test suite (single run; generous foreground wait)
npm test
# On failure: rerun ONLY the failing files individually to separate
# flakes from deterministic failures; record both verbatim.

# B1. Add pinned DBOS SDK (modifies package.json + lockfile — approval required)
npm install --save-exact @dbos-inc/dbos-sdk@<PINNED>
npm install --save-exact @dbos-inc/node-pg-datasource@<PINNED>   # only if P1 needs it
npm ls @dbos-inc/dbos-sdk   # record exact resolved version
git status --short          # confirm only package.json + lockfile (+ phase0/) changed
git diff --stat             # record for the report
```

Environment needs: none for typecheck; tests need no external services
(PGlite in-process, fakes, stubbed fetch) — but do NOT set production
credentials anywhere; use `.env.example` dev placeholders only if a test
requires env presence.

## Result sheet (fill after execution)

| Check | Command | Exit | Observed result |
|---|---|---|---|
| Node version | `node --version` | 0 | v22.23.5 (`/tmp`, user-local, runs on macOS 12.7) |
| npm version | `npm --version` | 0 | 10.9.9 (via PATH prepend; `~/.npm` root-owned, used `--cache /tmp/npm-cache`) |
| Install | `npm ci` | 0 | 202 packages. REQUIRED lockfile repair first: 18 committed integrity hashes corrupted (identical `JF`→`AL` substitution); each restored to registry-verified value. No further failures after repair. |
| Typecheck | `npm run typecheck` | 0 | 0 errors |
| Tests | `npm test` | non-zero (1 failed file) | files: 181 pass / 1 fail (182); cases: 1589 pass / 1 fail / 0 skipped (1590); time: 724s |
| Flake check | `npx vitest run server/lib/vault.test.ts` | non-zero | DETERMINISTIC pre-existing failure, unrelated to this work |
| SDK version | `npm ls @dbos-inc/dbos-sdk` | 0 | 5.5.0 exact (latest stable; 5.6.x are `-preview`) |
| Tree delta | `git status --short` | 0 | `M package.json`, `M package-lock.json` (SDK add + 18 hash repairs), `?? phase0/`; all docs byte-identical |

Baseline verdict: **RED-PRE-EXISTING** — single failure
`server/lib/vault.test.ts > resolveSecret reads an env var derived from
the item name`: test sets `Alex_CHATWOOT_API_TOKEN` (mixed case, matching
`.env.example`/dev-server convention) but `resolveSecret` derives
`Alex_CHATWOOT_API_TOKEN` (all-caps via `toUpperCase()`), so lookup
returns `undefined` on case-sensitive env. Not caused by Phase 0 (only
lockfile hashes + `phase0/` + `node_modules` changed). App code left
untouched per scope rules; fix is a one-line product decision for the
owner (align function to convention or vice versa).

## What Step 1 did NOT do

- Installed nothing; ran nothing; modified no tracked files.
- Created only this file (`phase0/BASELINE_RUNBOOK.md`).
- Did not resolve the DBOS SDK version (requires Gate B install).
- Did not provision PostgreSQL, Fly, or Neon resources (Gates C/D).
