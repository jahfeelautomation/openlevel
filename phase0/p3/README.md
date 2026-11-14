# P3 prototype — wallet + provider-attempt safety (V2.1 §§8/12)

Status: **code-complete, typechecked, DB-backed tests BLOCKED**. Requires live database per the runbook for execution; nothing below is marked PASS without a run. Gates A+B+C
(toolchain, install, scratch real PostgreSQL). Nothing here has run.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | `p3_operation`, `p3_attempt`, `p3_wallet`, `p3_settlement` |
| `fake-provider.ts` | Fault-injecting model API + independent charge log (JSONL) |
| `wallet.ts` | Reserve/dispatch/settle/sweep state machines |
| `runner.ts` | Killable child process for real crash tests |
| `p3.test.ts` | 4 crash + sweeper + SIGKILL + reserve-race + 2 sweeper-race + exhaustion tests (9 DB tests) |

## Key design points (V2.1 §12)

- Attempt states: `prepared → dispatching → succeeded | failed | uncertain`.
- `uncertain` is terminal-for-automation: quarantine only, never auto-retry,
  never auto-refund. The sweeper refunds only attempts proving no dispatch.
- Wallet row locks live inside short reserve/settle transactions only.
- Settlement is idempotent by `(operation_id, attempt_id)` unique key.
- Sweeper cadence (5 min) is **[assumption]** provisional until measured.

## Run procedure (after Gates A+B+C)

```bash
psql "$P3_DATABASE_URL" -f phase0/p3/schema.sql
P3_DATABASE_URL='...' P3_PROVIDER_LOG=/tmp/p3-provider.jsonl \
  npx vitest run --config phase0/vitest.phase0.config.ts phase0/p3/p3.test.ts
```

## Acceptance mapping (plan6.2 §4 + addendum §4)

- crash-1/2/3/4 → the four named tests with provider-log + ledger assertions.
- Measurable crash-3: exactly one provider charge, one operation ID,
  identifiable attempt, unique settlement keys, quarantine on uncertainty.
- Exhaustion → concurrent test: balance never negative, losers fail closed.
