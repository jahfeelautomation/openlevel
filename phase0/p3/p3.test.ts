/**
 * P3 acceptance tests (Phase 0). Run ONLY against a scratch real-PostgreSQL
 * database (Gates A+B+C). Env: P3_DATABASE_URL, P3_PROVIDER_LOG (temp file).
 *
 * Each crash test spawns runner.ts as a real child process and kills it
 * (exit 137) at the crash point, then asserts ledger + provider-log truth.
 * Pass criteria are plan6.2 §4 + addendum §4, quoted per test.
 */
import { spawn } from 'node:child_process';
import { test, describe, beforeEach, afterAll, expect } from 'vitest';
import { Pool } from 'pg';
import { countCharges, readProviderLog } from './fake-provider.js';
import {
  createOperation,
  recoverStaleAttempts,
  settle,
  sweepExpired,
  type SpendCaps,
} from './wallet.js';
import { assertDisposableUrl } from '../db-guard.js';

const DATABASE_URL = process.env.P3_DATABASE_URL ?? process.env.PHASE0_DATABASE_URL ?? '';
const gated = DATABASE_URL === '' ? test.skip : test;

const CAPS: SpendCaps = {
  budgetUsdMicro: 100_000, // $0.10
  maxInputTokens: 10_000,
  maxOutputTokens: 2_000,
  maxProviderAttempts: 3,
  priceInMicroPerToken: 100, // $0.10/MTok in
  priceOutMicroPerToken: 500, // $0.50/MTok out
};

function runCrasher(operationId: string, crashAt: string, mode = 'ok'): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'phase0/p3/runner.ts'],
      {
        env: {
          ...process.env,
          P3_DATABASE_URL: DATABASE_URL,
          P3_OPERATION_ID: operationId,
          P3_CRASH_AT: crashAt,
          P3_MODE: mode,
          P3_CAPS_JSON: JSON.stringify(CAPS),
        },
      },
    );
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

describe('P3 wallet + attempt safety (requires P3_DATABASE_URL)', () => {
  let pool: Pool;
  beforeEach(async () => {
    assertDisposableUrl(DATABASE_URL, 'P3_DATABASE_URL|PHASE0_DATABASE_URL');
    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    await pool.query(
      'TRUNCATE p3_settlement, p3_attempt, p3_operation, p3_wallet; INSERT INTO p3_wallet (agency_id, balance_credits_micro) VALUES (\'ag-1\', 1000000)',
    );
    // Respect an orchestrator-provided journal path (shared across the run so
    // reconcile.mjs can audit it afterwards); otherwise use a per-process file.
    if (!process.env.P3_PROVIDER_LOG) {
      process.env.P3_PROVIDER_LOG = `${process.env.TMPDIR ?? '/tmp/'}p3-provider-${process.pid}.jsonl`;
      const { rmSync } = await import('node:fs');
      rmSync(process.env.P3_PROVIDER_LOG, { force: true });
    }
  });
  afterAll(async () => {
    await pool?.end().catch(() => undefined);
  });

  const mkop = async (): Promise<string> =>
    createOperation(pool, {
      agencyId: 'ag-1',
      locationId: 'loc-1',
      purpose: 'p3-test-turn',
      provider: 'fake-anthropic',
      caps: CAPS,
    });

  gated('crash-1: after reservation, before dispatch → refundable, zero provider calls', async () => {
    const op = await mkop();
    expect(await runCrasher(op, 'after-reserve')).toBe(137);
    expect(countCharges(op)).toBe(0);
    const reserves = await pool.query(
      `SELECT count(*)::int AS n FROM p3_settlement WHERE operation_id = $1 AND kind = 'reserve'`,
      [op],
    );
    expect(reserves.rows[0].n).toBe(1); // exactly one reservation record (M-14)
    const swept = await sweepExpired(pool, -1); // expire everything immediately
    expect(swept.refunded).toBe(1);
    const bal = await pool.query(`SELECT balance_credits_micro FROM p3_wallet WHERE agency_id = 'ag-1'`);
    expect(Number(bal.rows[0].balance_credits_micro)).toBe(1000000);
  });

  gated('crash-2: after dispatching write, outcome unknown → uncertain, no blind retry', async () => {
    const op = await mkop();
    expect(await runCrasher(op, 'after-dispatching', 'timeout-unknown')).toBe(137);
    // Recovery inspection transitions the stuck row; nothing auto-retries.
    const recovered = await recoverStaleAttempts(pool, -1, op);
    expect(recovered.length).toBe(1);
    const attempts = await pool.query(`SELECT state FROM p3_attempt WHERE operation_id = $1`, [op]);
    expect(attempts.rows.length).toBe(1);
    expect(attempts.rows[0].state).toBe('uncertain');
    expect(countCharges(op)).toBe(0);
    // A fresh runner refuses to dispatch while anything is unresolved (M-08).
    expect(await runCrasher(op, 'none', 'ok')).toBe(3);
    const attemptsAfter = await pool.query(`SELECT count(*)::int AS n FROM p3_attempt WHERE operation_id = $1`, [op]);
    expect(attemptsAfter.rows[0].n).toBe(1);
    // Sweeper must NOT refund: recovery quarantined the operation.
    const swept = await sweepExpired(pool, -1);
    expect(swept.refunded).toBe(0);
    const st = await pool.query(`SELECT billing_state FROM p3_operation WHERE operation_id = $1`, [op]);
    expect(st.rows[0].billing_state).toBe('reserved');
  });

  gated('provider timeout marks attempt uncertain without throwing or retrying', async () => {
    const wallet = await import('./wallet.js');
    const op = await mkop();
    await wallet.reserve(pool, op, 100_000);
    process.env.P3_FAKE_TIMEOUT_MS = '200';
    try {
      const outcome = await wallet.dispatchAttempt(pool, {
        operationId: op,
        inputTokens: 100,
        outputTokens: 50,
        mode: 'timeout-unknown',
        caps: CAPS,
      });
      expect(outcome.state).toBe('uncertain');
    } finally {
      delete process.env.P3_FAKE_TIMEOUT_MS;
    }
    expect(countCharges(op)).toBe(1); // charge landed before the timeout
    const n = await pool.query(`SELECT count(*)::int AS n FROM p3_attempt WHERE operation_id = $1`, [op]);
    expect(n.rows[0].n).toBe(1); // no automatic second attempt
  });

  gated('crash-3: provider accepted, crash before settlement → exactly one charge, explicit reconcile', async () => {
    const op = await mkop();
    expect(await runCrasher(op, 'none', 'die-before-response')).toBe(137);
    // Measurable assertions (addendum §4):
    expect(countCharges(op)).toBe(1); // provider log: exactly one accepted charge
    const ops = await pool.query(`SELECT count(*)::int AS n FROM p3_operation WHERE operation_id = $1`, [op]);
    expect(ops.rows[0].n).toBe(1); // exactly one stable operation ID
    // Recovery settles with the ACTUAL attempt cost read from the ledger (M-14).
    const att = await pool.query(`SELECT attempt_id, cost_usd_micro FROM p3_attempt WHERE operation_id = $1`, [op]);
    expect(att.rows.length).toBe(1);
    const actualCost = Number(att.rows[0].cost_usd_micro);
    expect(actualCost).toBe(100 * CAPS.priceInMicroPerToken + 50 * CAPS.priceOutMicroPerToken);
    await settle(pool, op, att.rows[0].attempt_id, actualCost);
    await settle(pool, op, att.rows[0].attempt_id, actualCost); // replay: must not double-settle
    const settlements = await pool.query(
      `SELECT count(*)::int AS n, sum(amount_micro)::bigint AS total FROM p3_settlement WHERE operation_id = $1 AND kind = 'settle'`,
      [op],
    );
    expect(settlements.rows[0].n).toBe(1);
    expect(Number(settlements.rows[0].total)).toBe(actualCost);
    expect(countCharges(op)).toBe(1); // still exactly one charge after recovery
    expect(readProviderLog().filter((e) => e.operationId === op && e.charged).length).toBe(1);
  });

  gated('crash-4: real kill after settlement → single settle, exact balance (m-13)', async () => {
    const op = await mkop();
    expect(await runCrasher(op, 'after-settle')).toBe(137);
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM p3_settlement WHERE operation_id = $1 AND kind = 'settle'`,
      [op],
    );
    expect(before.rows[0].n).toBe(1);
    const bal = await pool.query(`SELECT balance_credits_micro FROM p3_wallet WHERE agency_id = 'ag-1'`);
    expect(Number(bal.rows[0].balance_credits_micro)).toBe(1000000 - CAPS.budgetUsdMicro);
    // Replayed completion is idempotent by (operation, attempt).
    const att = await pool.query(`SELECT attempt_id, cost_usd_micro FROM p3_attempt WHERE operation_id = $1`, [op]);
    await settle(pool, op, att.rows[0].attempt_id, Number(att.rows[0].cost_usd_micro));
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM p3_settlement WHERE operation_id = $1 AND kind = 'settle'`,
      [op],
    );
    expect(after.rows[0].n).toBe(1);
  });

  gated('sweeper refunds only provably-undispatched reservations', async () => {
    const wallet = await import('./wallet.js');
    // A: reserved, old, failed attempt (no dispatch ever succeeded) → refundable.
    const opA = await mkop();
    await wallet.reserve(pool, opA, 10_000);
    await pool.query(
      `INSERT INTO p3_attempt (attempt_id, operation_id, sequence, request_fingerprint, state, finished_at)
       VALUES ('att-a1', $1, 1, 'fp-a1', 'failed', now())`,
      [opA],
    );
    // B: reserved, old, uncertain attempt → must NOT be refunded.
    const opB = await mkop();
    await wallet.reserve(pool, opB, 10_000);
    await pool.query(
      `INSERT INTO p3_attempt (attempt_id, operation_id, sequence, request_fingerprint, state, finished_at)
       VALUES ('att-b1', $1, 1, 'fp-b1', 'uncertain', now())`,
      [opB],
    );
    // C: reserved, old, stuck dispatching (crashed, never resolved) → must NOT be refunded.
    const opC = await mkop();
    await wallet.reserve(pool, opC, 10_000);
    await pool.query(
      `INSERT INTO p3_attempt (attempt_id, operation_id, sequence, request_fingerprint, state, started_at)
       VALUES ('att-c1', $1, 1, 'fp-c1', 'dispatching', now())`,
      [opC],
    );
    // Age all three past the sweep horizon.
    await pool.query(`UPDATE p3_operation SET created_at = now() - interval '1 hour'`);
    const swept = await wallet.sweepExpired(pool, 60_000);
    expect(swept.refunded).toBe(1);
    const states = await pool.query(
      `SELECT operation_id, billing_state FROM p3_operation WHERE operation_id = ANY($1)`,
      [[opA, opB, opC]],
    );
    const byId = new Map(states.rows.map((r: { operation_id: string; billing_state: string }) => [r.operation_id, r.billing_state]));
    expect(byId.get(opA)).toBe('refunded');
    expect(byId.get(opB)).toBe('reserved');
    expect(byId.get(opC)).toBe('reserved');
  });

  gated('external SIGKILL mid-provider-call leaves exactly one charge, quarantined', async () => {
    const op = await mkop();
    // Runner hangs inside the fake provider call (charge already durable).
    const child = spawn(process.execPath, ['--import', 'tsx', 'phase0/p3/runner.ts'], {
      env: {
        ...process.env,
        P3_DATABASE_URL: DATABASE_URL,
        P3_OPERATION_ID: op,
        P3_CRASH_AT: 'none',
        P3_MODE: 'timeout-unknown',
        P3_CAPS_JSON: JSON.stringify(CAPS),
      },
      stdio: 'ignore',
    });
    try {
      // Wait until the dispatching row is durable, then kill from outside.
      const start = Date.now();
      for (;;) {
        const r = await pool.query(`SELECT state FROM p3_attempt WHERE operation_id = $1`, [op]);
        if (r.rows.length > 0 && r.rows[0].state === 'dispatching') break;
        if (Date.now() - start > 15000) throw new Error('dispatching row never appeared');
        await new Promise((res) => setTimeout(res, 100));
      }
      // M-12: wait for BOTH the durable dispatch row AND the provider-side
      // charge before killing — killing before the charge would prove nothing
      // about the uncertain path.
      const chargedAt = Date.now();
      for (;;) {
        if (countCharges(op) >= 1) break;
        if (Date.now() - chargedAt > 15000) throw new Error('provider charge never landed');
        await new Promise((res) => setTimeout(res, 100));
      }
      child.kill('SIGKILL');
      await new Promise((resolve) => child.on('close', resolve));
      expect(countCharges(op)).toBe(1);
      const att = await pool.query(`SELECT state FROM p3_attempt WHERE operation_id = $1`, [op]);
      expect(att.rows.length).toBe(1);
      expect(att.rows[0].state).toBe('dispatching');
      // Recovery inspection transitions the stuck row; sweeper must not refund.
      expect(await recoverStaleAttempts(pool, -1, op)).toHaveLength(1);
      const swept = await sweepExpired(pool, -1);
      expect(swept.refunded).toBe(0);
      const st = await pool.query(`SELECT billing_state FROM p3_operation WHERE operation_id = $1`, [op]);
      expect(st.rows[0].billing_state).toBe('reserved');
    } finally {
      child.kill('SIGKILL');
    }
  });

  gated('concurrent reserves on one operation debit exactly once (M-10)', async () => {
    const wallet = await import('./wallet.js');
    const op = await mkop();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const N = 8;
    const racers = Array.from({ length: N }, () => gate.then(() => wallet.reserve(pool, op, 10_000)));
    await new Promise((r) => setTimeout(r, 100));
    release();
    const results = await Promise.all(racers);
    expect(results.filter((r) => r === 'reserved').length).toBe(1);
    expect(results.filter((r) => r === 'already-reserved').length).toBe(N - 1);
    const bal = await pool.query(`SELECT balance_credits_micro FROM p3_wallet WHERE agency_id = 'ag-1'`);
    expect(Number(bal.rows[0].balance_credits_micro)).toBe(1000000 - 10_000);
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM p3_settlement WHERE operation_id = $1 AND kind = 'reserve'`,
      [op],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  gated('sweeper racing an in-flight dispatch never refunds it (M-11)', async () => {
    const wallet = await import('./wallet.js');
    const op = await mkop();
    await wallet.reserve(pool, op, 10_000);
    await pool.query(`UPDATE p3_operation SET created_at = now() - interval '1 hour' WHERE operation_id = $1`, [op]);
    // Dispatch starts (writes dispatching row via hook), sweep runs mid-flight.
    const dispatching = wallet.dispatchAttempt(pool, {
      operationId: op,
      inputTokens: 100,
      outputTokens: 50,
      mode: 'ok',
      caps: CAPS,
      hooks: {
        afterDispatchingWrite: async () => {
          const swept = await wallet.sweepExpired(pool, -1);
          expect(swept.refunded).toBe(0);
        },
      },
    });
    const outcome = await dispatching;
    expect(outcome.state).toBe('succeeded');
    const st = await pool.query(`SELECT billing_state FROM p3_operation WHERE operation_id = $1`, [op]);
    expect(st.rows[0].billing_state).toBe('reserved');
  });

  gated('concurrent sweepers refund exactly once (M-11)', async () => {
    const wallet = await import('./wallet.js');
    const op = await mkop();
    await wallet.reserve(pool, op, 10_000);
    await pool.query(`UPDATE p3_operation SET created_at = now() - interval '1 hour' WHERE operation_id = $1`, [op]);
    const [a, b] = await Promise.all([wallet.sweepExpired(pool, -1), wallet.sweepExpired(pool, -1)]);
    expect(a.refunded + b.refunded).toBe(1);
    const refunds = await pool.query(
      `SELECT count(*)::int AS n, sum(amount_micro)::bigint AS total FROM p3_settlement WHERE operation_id = $1 AND kind = 'refund'`,
      [op],
    );
    expect(refunds.rows[0].n).toBe(1);
    const bal = await pool.query(`SELECT balance_credits_micro FROM p3_wallet WHERE agency_id = 'ag-1'`);
    expect(Number(bal.rows[0].balance_credits_micro)).toBe(1000000);
  });

  gated('concurrent turns exhausting one wallet never go negative', async () => {
    const wallet = await import('./wallet.js');
    const ops = await Promise.all([mkop(), mkop(), mkop(), mkop()]);
    // $1.00 wallet, four concurrent $0.40 reservations: at most 2 succeed.
    const results = await Promise.allSettled(ops.map((op) => wallet.reserve(pool, op, 400_000)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBeLessThanOrEqual(2);
    expect(ok).toBeGreaterThanOrEqual(1);
    const bal = await pool.query(`SELECT balance_credits_micro FROM p3_wallet WHERE agency_id = 'ag-1'`);
    expect(Number(bal.rows[0].balance_credits_micro)).toBeGreaterThanOrEqual(0);
    expect(Number(bal.rows[0].balance_credits_micro)).toBe(1000000 - ok * 400000);
  });
});
