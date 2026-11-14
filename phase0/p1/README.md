# P1 prototype — atomic enqueue (V2.1 §7.1)

Status: **code-complete, typechecked, DB-backed tests BLOCKED**.
Compiles clean (`npx tsc -p phase0/tsconfig.json --noEmit`); execution needs
a live database (runbook). Nothing below is marked PASS without a run.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | `p1_business_event` + discrepancy tables |
| `worker-schema.sql` | `p1_execution_log` (execution counting) |
| `dbos-adapter.ts` | Sole DBOS SDK seam; throws until bound at Gate B |
| `handler.ts` | §7.1 six-step contract implementation |
| `worker.ts` | `p1-echo` worker (typechecked; runs at Gate C) |
| `p1.test.ts` | 9 DB tests: race, rollback, completion, 409, retention, expiry-renew, expiry-race, reuse, vanish |
| `outcome.test.ts` | 2 unit tests, green without a DB |
| `backpressure.test.ts` | 1 flood + retry-convergence test |

## Run procedure (after Gates A+B+C)

```bash
# 1. Scratch database only — never production, never shared staging data.
psql "$P1_DATABASE_URL" -f phase0/p1/schema.sql
psql "$P1_DATABASE_URL" -f phase0/p1/worker-schema.sql

# 2. Compile gate: bind dbos-adapter.ts to the installed SDK, then:
npm run typecheck            # must pass with zero errors

# 3. Worker (separate terminal):
P1_DATABASE_URL='...' node --import tsx phase0/p1/worker.ts

# 4. Tests:
P1_DATABASE_URL='...' npx vitest run --config phase0/vitest.phase0.config.ts phase0/p1/p1.test.ts
```

## Acceptance mapping (plan6.2 §2 + addendum §1)

- Concurrent race → `concurrent identical requests` test + execution-log count.
- Rollback → `rollback leaves neither` test + DBOS not-found check.
- Post-completion duplicate → `duplicate after completion` test.
- Post-retention duplicate → `duplicate after workflow-history deletion` test.
- Post-expiry duplicate → generation-renewal tests (single + 8-way race).
- 409 conflict → `same key different hash` test + discrepancy row.
- Reuse-policy compile check → Gate B adapter binding record.

## Prohibited in P1

Plain `enqueue()` for dedup, type casts around SDK types, `tsx` in any
production path, touching `server/` or `db/`, running against anything
but a scratch database.
