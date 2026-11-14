/**
 * P3 wallet + attempt logic (Phase 0, isolated). Implements V2.1 §§8/12:
 * operation/attempt hierarchy, USD-micro + token + attempt caps, short
 * row locks, quarantine for uncertain outcomes.
 *
 * All money movement runs inside caller-owned transactions on the scratch
 * database. No DBOS dependency here: the crash semantics under test are
 * the state machines themselves; DBOS replay integration is Phase 2 work
 * gated on these machines being correct.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { countCharges, fakeModelCall, ProviderTimeoutError, type FakeMode } from './fake-provider.js';

export interface SpendCaps {
  budgetUsdMicro: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxProviderAttempts: number;
  /** Micro-USD per input/output token from the versioned price table. */
  priceInMicroPerToken: number;
  priceOutMicroPerToken: number;
}

export interface AttemptOutcome {
  attemptId: string;
  state: 'succeeded' | 'failed' | 'uncertain';
  costUsdMicro: number;
}

export function estimateCostMicro(caps: SpendCaps, inTok: number, outTok: number): number {
  return Math.ceil(inTok * caps.priceInMicroPerToken + outTok * caps.priceOutMicroPerToken);
}

/** Domain conflict (concurrent reservation/dispatch race lost). Retries must re-read, never blind-repeat. */
export class ConflictError extends Error {
  readonly retryable = false;
  readonly code = 'P3_CONFLICT';
  constructor(message: string) {
    super(message);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export async function createOperation(
  pool: Pool,
  input: { agencyId: string; locationId: string; purpose: string; provider: string; caps: SpendCaps },
): Promise<string> {
  const operationId = randomUUID();
  await pool.query(
    `INSERT INTO p3_operation
       (operation_id, agency_id, location_id, purpose, provider, budget_usd_micro,
        max_input_tokens, max_output_tokens, max_provider_attempts, price_table_version, billing_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'p3-v1','unbilled')`,
    [
      operationId,
      input.agencyId,
      input.locationId,
      input.purpose,
      input.provider,
      input.caps.budgetUsdMicro,
      input.caps.maxInputTokens,
      input.caps.maxOutputTokens,
      input.caps.maxProviderAttempts,
    ],
  );
  return operationId;
}

/**
 * Reserve the run budget. Short transaction; row lock never held over I/O.
 * Lock order is always operation row first, then wallet (prevents ABBA
 * deadlocks with concurrent reserves on different operations).
 * Returns 'reserved' on success, 'already-reserved' idempotently when a
 * previous call won the race. Throws on unknown operation or insufficient
 * funds; maps unique violations to ConflictError (i-02), never raw SQL.
 */
export async function reserve(pool: Pool, operationId: string, amountMicro: number): Promise<'reserved' | 'already-reserved'> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const op = await tx.query(
      `SELECT agency_id, billing_state FROM p3_operation WHERE operation_id = $1 FOR UPDATE`,
      [operationId],
    );
    if (op.rows.length === 0) throw new Error('unknown operation');
    if (op.rows[0].billing_state !== 'unbilled') {
      await tx.query('ROLLBACK');
      return 'already-reserved';
    }
    const w = await tx.query(`SELECT balance_credits_micro FROM p3_wallet WHERE agency_id = $1 FOR UPDATE`, [
      op.rows[0].agency_id,
    ]);
    const balance = w.rows.length > 0 ? Number(w.rows[0].balance_credits_micro) : 0;
    if (balance < amountMicro) throw new Error('insufficient funds');
    await tx.query(`UPDATE p3_wallet SET balance_credits_micro = balance_credits_micro - $2 WHERE agency_id = $1`, [
      op.rows[0].agency_id,
      amountMicro,
    ]);
    const moved = await tx.query(
      `UPDATE p3_operation SET billing_state = 'reserved' WHERE operation_id = $1 AND billing_state = 'unbilled'`,
      [operationId],
    );
    if ((moved.rowCount ?? 0) !== 1) throw new ConflictError(`reservation race lost for ${operationId}`);
    await tx.query(`INSERT INTO p3_settlement (operation_id, attempt_id, kind, amount_micro) VALUES ($1, NULL, 'reserve', $2)`, [
      operationId,
      amountMicro,
    ]);
    await tx.query('COMMIT');
    return 'reserved';
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => undefined);
    if (isUniqueViolation(err)) throw new ConflictError(`concurrent reservation conflict on ${operationId}`);
    throw err;
  } finally {
    tx.release();
  }
}

/**
 * Execute one provider attempt: pre-write `dispatching`, call provider,
 * then transition. Crash between provider-accept and transition leaves a
 * `dispatching` row that recovery must treat as UNCERTAIN, never retry blindly.
 */
export async function dispatchAttempt(
  pool: Pool,
  input: {
    operationId: string;
    inputTokens: number;
    outputTokens: number;
    mode: FakeMode;
    caps: SpendCaps;
    /** Test-only fault injection (P3 crash tests). Never set in non-test paths. */
    hooks?: { afterDispatchingWrite?: () => Promise<void> };
  },
): Promise<AttemptOutcome> {
  // Pre-dispatch gate in ONE transaction: lock the operation, require
  // reserved state, enforce budgets, and durably record the dispatching
  // attempt — all before any provider contact. This closes the race where
  // a sweeper refunds between a state check and the attempt insert: either
  // side sees the other's committed row and stands down.
  const tx = await pool.connect();
  let attemptId: string;
  let cost: number;
  try {
    await tx.query('BEGIN');
    const op = await tx.query(`SELECT billing_state FROM p3_operation WHERE operation_id = $1 FOR UPDATE`, [
      input.operationId,
    ]);
    if (op.rows.length === 0) throw new Error('unknown operation');
    if (op.rows[0].billing_state !== 'reserved') {
      throw new ConflictError(`cannot dispatch: operation is ${op.rows[0].billing_state}`);
    }
    const prior = await tx.query(
      `SELECT count(*)::int AS n, coalesce(sum(cost_usd_micro),0)::bigint AS spent
       FROM p3_attempt WHERE operation_id = $1 AND state IN ('succeeded','dispatching','uncertain')`,
      [input.operationId],
    );
    if (prior.rows[0].n >= input.caps.maxProviderAttempts) throw new Error('provider-attempt budget exhausted');
    cost = estimateCostMicro(input.caps, input.inputTokens, input.outputTokens);
    if (Number(prior.rows[0].spent) + cost > input.caps.budgetUsdMicro) throw new Error('run USD budget exceeded');
    attemptId = randomUUID();
    try {
      await tx.query(
        `INSERT INTO p3_attempt (attempt_id, operation_id, sequence, request_fingerprint, state, started_at, cost_usd_micro)
         VALUES ($1, $2, $3, $4, 'dispatching', now(), $5)`,
        [attemptId, input.operationId, prior.rows[0].n + 1, `fp:${attemptId}`, cost],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError(`concurrent dispatch conflict on ${input.operationId}`);
      throw err;
    }
    await tx.query('COMMIT');
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => undefined);
    tx.release();
    throw err;
  }
  tx.release();
  await input.hooks?.afterDispatchingWrite?.();
  let result;
  try {
    result = await fakeModelCall({
      attemptId,
      operationId: input.operationId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      mode: input.mode,
    });
  } catch (err) {
    if (err instanceof ProviderTimeoutError) {
      // Provider contact is proven-or-possible: quarantine, never auto-retry.
      await pool.query(`UPDATE p3_attempt SET state = 'uncertain', finished_at = now() WHERE attempt_id = $1`, [
        attemptId,
      ]);
      return { attemptId, state: 'uncertain', costUsdMicro: cost };
    }
    await pool.query(`UPDATE p3_attempt SET state = 'failed', finished_at = now() WHERE attempt_id = $1`, [attemptId]);
    throw err;
  }
  await pool.query(
    `UPDATE p3_attempt SET state = 'succeeded', provider_request_id = $2,
       usage_input_tokens = $3, usage_output_tokens = $4, finished_at = now()
     WHERE attempt_id = $1`,
    [attemptId, result.requestId, result.inputTokens, result.outputTokens],
  );
  return { attemptId, state: 'succeeded', costUsdMicro: cost };
}

/**
 * Settle an operation: exactly once per operation (unique settlement key).
 * Refuses non-reserved/settled operations (first settle wins; replays with a
 * different amount are rejected, never silently averaged).
 */
export async function settle(pool: Pool, operationId: string, attemptId: string, actualMicro: number): Promise<void> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const op = await tx.query(`SELECT billing_state FROM p3_operation WHERE operation_id = $1 FOR UPDATE`, [
      operationId,
    ]);
    if (op.rows.length === 0) throw new Error('unknown operation');
    if (op.rows[0].billing_state !== 'reserved' && op.rows[0].billing_state !== 'settled') {
      throw new ConflictError(`cannot settle operation in state ${op.rows[0].billing_state}`);
    }
    // Serialize on the operation row (already locked above): at most one
    // settle insert wins; concurrent duplicates read back the winner.
    const inserted = await tx.query(
      `INSERT INTO p3_settlement (operation_id, attempt_id, kind, amount_micro)
       VALUES ($1, $2, 'settle', $3) ON CONFLICT DO NOTHING`,
      [operationId, attemptId, actualMicro],
    );
    if ((inserted.rowCount ?? 0) === 0) {
      const prior = await tx.query(
        `SELECT amount_micro FROM p3_settlement WHERE operation_id = $1 AND kind = 'settle'`,
        [operationId],
      );
      if (prior.rows.length === 0 || Number(prior.rows[0].amount_micro) !== actualMicro) {
        throw new ConflictError(
          `settle conflict on ${operationId}: recorded ${prior.rows[0]?.amount_micro ?? 'none'}, got ${actualMicro}`,
        );
      }
      await tx.query('COMMIT');
      return; // idempotent replay of the identical settlement
    }
    await tx.query(
      `UPDATE p3_operation SET billing_state = 'settled',
         terminal_result = jsonb_build_object('attempt_id', $2, 'actual_micro', $3)
       WHERE operation_id = $1 AND billing_state = 'reserved'`,
      [operationId, attemptId, actualMicro],
    );
    await tx.query('COMMIT');
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
}

export interface StaleAttempt {
  operation_id: string;
  attempt_id: string;
}

/**
 * Recovery inspection (M-08/M-09): transition `dispatching` attempts older
 * than the lease to `uncertain`. A dispatching row past its lease means the
 * owning process died without resolving the provider outcome — the only
 * safe reading is "contact possible, result unknown". Never auto-retries.
 * Returns the transitioned rows for the reconcile report.
 */
export async function recoverStaleAttempts(pool: Pool, leaseMs: number, operationId?: string): Promise<StaleAttempt[]> {
  const r = await pool.query(
    `UPDATE p3_attempt SET state = 'uncertain', finished_at = now()
     WHERE state = 'dispatching'
       AND started_at < now() - make_interval(secs => $1)
       AND ($2::text IS NULL OR operation_id = $2)
     RETURNING operation_id, attempt_id`,
    [leaseMs / 1000, operationId ?? null],
  );
  return r.rows as StaleAttempt[];
}

/** List unresolved (uncertain or live dispatching) attempts for an operation. */
export async function listUnresolvedAttempts(
  pool: Pool,
  operationId: string,
): Promise<{ attempt_id: string; state: string }[]> {
  const r = await pool.query(
    `SELECT attempt_id, state FROM p3_attempt WHERE operation_id = $1 AND state IN ('dispatching','uncertain') ORDER BY sequence`,
    [operationId],
  );
  return r.rows as { attempt_id: string; state: string }[];
}

/**
 * Expiry sweeper (idempotent, bounded, race-safe). Refunds ONLY reservations
 * whose attempts prove no dispatch occurred (no attempts, or failed-only).
 * Anything dispatching/uncertain/succeeded stays quarantined for operator
 * reconciliation — never auto-refunded. Each operation is processed in its
 * own transaction with the operation row locked, eligibility rechecked
 * inside the lock, and rowcount-verified transitions (M-11). Per-row
 * failures are logged with the operation ID and do not abort the sweep (m-10).
 */
export async function sweepExpired(
  pool: Pool,
  olderThanMs: number,
  onRowError?: (operationId: string, err: unknown) => void,
): Promise<{ refunded: number; left: number }> {
  const stale = await pool.query(
    `SELECT o.operation_id FROM p3_operation o
     WHERE o.billing_state = 'reserved'
       AND o.created_at < now() - make_interval(secs => $1)`,
    [olderThanMs / 1000],
  );
  let refunded = 0;
  for (const row of stale.rows as { operation_id: string }[]) {
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const locked = await tx.query(
        `SELECT agency_id, billing_state FROM p3_operation WHERE operation_id = $1 FOR UPDATE`,
        [row.operation_id],
      );
      if (locked.rows.length === 0 || locked.rows[0].billing_state !== 'reserved') {
        await tx.query('ROLLBACK');
        continue;
      }
      // Re-check eligibility INSIDE the lock: any non-failed attempt
      // disqualifies (dispatch may have landed after the outer scan).
      const active = await tx.query(
        `SELECT 1 FROM p3_attempt WHERE operation_id = $1 AND state <> 'failed' LIMIT 1`,
        [row.operation_id],
      );
      if (active.rows.length > 0) {
        await tx.query('ROLLBACK');
        continue;
      }
      const moved = await tx.query(
        `UPDATE p3_operation SET billing_state = 'refunded' WHERE operation_id = $1 AND billing_state = 'reserved'`,
        [row.operation_id],
      );
      if ((moved.rowCount ?? 0) !== 1) throw new ConflictError(`sweep race lost for ${row.operation_id}`);
      const r = await tx.query(
        `SELECT amount_micro FROM p3_settlement WHERE operation_id = $1 AND kind = 'reserve'`,
        [row.operation_id],
      );
      const amount = r.rows.length > 0 ? Number(r.rows[0].amount_micro) : 0;
      await tx.query(`UPDATE p3_wallet SET balance_credits_micro = balance_credits_micro + $2 WHERE agency_id = $1`, [
        locked.rows[0].agency_id,
        amount,
      ]);
      await tx.query(`INSERT INTO p3_settlement (operation_id, attempt_id, kind, amount_micro) VALUES ($1, NULL, 'refund', $2)`, [
        row.operation_id,
        amount,
      ]);
      await tx.query('COMMIT');
      refunded++;
    } catch (err) {
      await tx.query('ROLLBACK').catch(() => undefined);
      if (onRowError) onRowError(row.operation_id, err);
    } finally {
      tx.release();
    }
  }
  const left = await pool.query(`SELECT count(*)::int AS n FROM p3_operation WHERE billing_state = 'reserved'`);
  return { refunded, left: left.rows[0].n as number };
}

export { countCharges };
