/**
 * P3 crash runner (Phase 0, isolated). Spawned by p3.test.ts as a child
 * process so crash tests kill a REAL process, not a mock.
 *
 * Env in: P3_DATABASE_URL, P3_PROVIDER_LOG, P3_OPERATION_ID (existing op),
 * P3_CRASH_AT (none|after-reserve|after-dispatching|before-settle),
 * P3_MODE (fake provider mode), P3_CAPS_JSON.
 *
 * Flow: reserve (if unbilled) -> dispatchAttempt -> settle.
 * Exits 0 on full completion, 137 on injected crash, 1 on error.
 */
import { Pool } from 'pg';
import {
  dispatchAttempt,
  listUnresolvedAttempts,
  recoverStaleAttempts,
  reserve,
  settle,
  type SpendCaps,
} from './wallet.js';
import { assertDisposableUrl } from '../db-guard.js';

async function main(): Promise<void> {
  const url = process.env.P3_DATABASE_URL ?? '';
  assertDisposableUrl(url, 'P3_DATABASE_URL');
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const operationId = process.env.P3_OPERATION_ID ?? '';
    const crashAt = process.env.P3_CRASH_AT ?? 'none';
    const leaseMs = Number(process.env.P3_LEASE_MS ?? '30000');
    const caps = JSON.parse(process.env.P3_CAPS_JSON ?? '{}') as SpendCaps;
    if (!operationId) throw new Error('P3_OPERATION_ID required');

    // Recovery inspection (M-08): transition stale dispatches, then refuse
    // to dispatch while anything is unresolved — reconcile first.
    const recovered = await recoverStaleAttempts(pool, leaseMs, operationId);
    const unresolved = await listUnresolvedAttempts(pool, operationId);
    if (unresolved.length > 0) {
      console.log(JSON.stringify({ refused: 'unresolved-attempts', recovered, unresolved }));
      process.exit(3);
    }

    const res = await reserve(pool, operationId, caps.budgetUsdMicro);
    if (res === 'already-reserved') console.log(JSON.stringify({ resumed: true }));
    if (crashAt === 'after-reserve') process.exit(137);

    const fakeMode = (process.env.P3_MODE ?? 'ok') as 'ok' | 'die-before-response' | 'timeout-unknown' | 'fail';
    const outcome = await dispatchAttempt(pool, {
      operationId,
      inputTokens: 100,
      outputTokens: 50,
      mode: fakeMode,
      caps,
      hooks: {
        afterDispatchingWrite: async () => {
          if (crashAt === 'after-dispatching') process.exit(137);
        },
      },
    });
    if (outcome.state !== 'succeeded') {
      // Exit 4, not 0: an unsettled operation is unfinished work, and a
      // zero exit here would read as success in batch harnesses.
      console.log(JSON.stringify({ stalled: outcome.state }));
      process.exit(4);
    }
    if (crashAt === 'before-settle') process.exit(137);
    await settle(pool, operationId, outcome.attemptId, outcome.costUsdMicro);
    if (crashAt === 'after-settle') process.exit(137);
    console.log(JSON.stringify({ settled: true, attemptId: outcome.attemptId }));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
