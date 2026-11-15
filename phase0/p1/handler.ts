/**
 * P1 prototype — V2.1 §7.1 atomic enqueue handler (Phase 0, isolated).
 *
 * Normative contract (see V2.1 §7.1 + plan6.2 addendum §1):
 *  1. Stable business key K from the AUTHENTICATED event (never tenant
 *     identity from untrusted payload fields).
 *  2. BEGIN on a DBOS-system-database connection.
 *  3. INSERT business_event ON CONFLICT DO NOTHING RETURNING — the
 *     primary duplicate gate (unique business key).
 *  4. Row inserted → business mutation + enqueueInTransaction with the
 *     stored workflow UUID. Duplicate row → NO enqueue; return existing
 *     status. Same key + different payload hash → HTTP 409 + discrepancy
 *     record (never silent acceptance).
 *  5. COMMIT atomically; on any failure ROLLBACK both. Never acknowledge
 *     before commit.
 * Retention: idempotency rows outlive DBOS workflow history; after
 * tombstone expiry a repeated event is defined as NEW per trigger policy.
 */
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { enqueueInCallerTransaction, getWorkflowStatus, sharedClient } from './dbos-adapter.js';

export interface AuthenticatedEvent {
  /** Provider name, e.g. 'chatwoot'. From server-side routing, not payload. */
  provider: string;
  /** Provider account/inbox binding resolved server-side. */
  accountBinding: string;
  agencyId: string;
  locationId: string;
  /** Provider's event/message identifier. */
  providerEventId: string;
  /** Canonical payload bytes for hashing. */
  payloadCanonical: string;
  /** Tombstone TTL per trigger policy (e.g. payments 30d+). */
  idempotencyTtlMs: number;
}

export type HandleResult =
  | { outcome: 'accepted'; workflowId: string; status: string }
  | { outcome: 'duplicate'; workflowId: string; status: string; result: unknown }
  | { outcome: 'conflict'; reason: string };

export function businessKeyOf(e: AuthenticatedEvent): string {
  return [e.provider, e.accountBinding, e.agencyId, e.locationId, e.providerEventId].join('|');
}

export function payloadHashOf(e: AuthenticatedEvent): string {
  return createHash('sha256').update(e.payloadCanonical, 'utf8').digest('hex');
}

/** Deterministic workflow UUID (v5-style sha256 truncation is enough here). */
export function workflowIdFor(businessKey: string): string {
  return workflowIdForGen(businessKey, 1);
}

export function workflowIdForGen(businessKey: string, generation: number): string {
  const h = createHash('sha256').update(`p1-workflow:${businessKey}#g${generation}`, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

interface BusinessEventRow {
  business_key: string;
  workflow_id: string;
  payload_hash: string;
  last_status: string;
  last_result: unknown;
  generation: number;
  accepted_at: Date; // pg returns timestamptz as Date; passed back as a bound param unchanged
  is_expired: boolean;
}

export class AcquireTimeoutError extends Error {
  readonly retryable = true;
  constructor(poolMax: number, timeoutMs: number) {
    super(`pool acquire timed out after ${timeoutMs}ms (max ${poolMax}): retryable`);
  }
}

async function connectBounded(pool: Pool, timeoutMs: number | undefined): Promise<PoolClient> {
  if (timeoutMs === undefined) return await pool.connect();
  const pending = pool.connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const winner = await Promise.race([
      pending.then((c): { client: PoolClient } => ({ client: c })),
      new Promise<{ timeout: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
      }),
    ]);
    if ('timeout' in winner) {
      // A late-arriving client must still be released or the pool leaks.
      pending.then((c) => c.release()).catch(() => undefined);
      const max = (pool as unknown as { options?: { max?: number } }).options?.max ?? -1;
      throw new AcquireTimeoutError(max, timeoutMs);
    }
    return winner.client;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface P1Deps {
  /** Pool connected to the DBOS system database (same DB as app schema). */
  pool: Pool;
  systemDatabaseUrl: string;
  workflowName: string;
  queueName: string;
  workflowArgsFor: (e: AuthenticatedEvent) => unknown[];
  /** Bound pool acquisition; timeout rejects with retryable AcquireTimeoutError. */
  acquireTimeoutMs?: number;
  /** Explicit DBOS system-pool size for the shared client (default: SDK default 10). */
  dbosPoolSize?: number;
  /** Optional hook so tests can observe/crash between steps (fault injection). */
  hooks?: { afterInsert?: () => Promise<void>; beforeCommit?: () => Promise<void> };
}

/**
 * Handle one authenticated event exactly per the §7.1 contract.
 * Throws on transaction failure (caller maps to 500/retryable; nothing persisted).
 */
export async function handleEvent(deps: P1Deps, event: AuthenticatedEvent): Promise<HandleResult> {
  const key = businessKeyOf(event);
  const hash = payloadHashOf(event);
  // Shared process-level client (M-13): bounded, measurable system connections.
  // Tests isolate via resetSharedClients(); nothing here owns the lifecycle.
  const client = await sharedClient(deps.systemDatabaseUrl, deps.dbosPoolSize);
  let tx: PoolClient | undefined;
  try {
    tx = await connectBounded(deps.pool, deps.acquireTimeoutMs);
    await tx.query('BEGIN');
    const inserted = await tx.query(
      `INSERT INTO p1_business_event
         (business_key, agency_id, location_id, payload_hash, workflow_id, last_status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'accepted', now() + make_interval(secs => $6))
       ON CONFLICT (business_key) DO NOTHING
       RETURNING business_key, workflow_id, payload_hash, last_status, last_result, generation, accepted_at, false AS is_expired`,
      [key, event.agencyId, event.locationId, hash, workflowIdFor(key), event.idempotencyTtlMs / 1000],
    );
    const row = inserted.rows[0] as BusinessEventRow | undefined;

    if (!row) {
      // Duplicate path: lock the row so concurrent renewals serialize.
      const existing = await tx.query(
        `SELECT business_key, workflow_id, payload_hash, last_status, last_result,
                generation, accepted_at, (expires_at <= now()) AS is_expired
         FROM p1_business_event WHERE business_key = $1 FOR UPDATE`,
        [key],
      );
      const prev = existing.rows[0] as BusinessEventRow | undefined;
      if (!prev) throw new Error('P1 invariant violated: conflict without existing row');
      if (prev.payload_hash !== hash) {
        await tx.query(
          `INSERT INTO p1_business_event_discrepancy (business_key, expected_hash, observed_hash, observed_at)
           VALUES ($1, $2, $3, now())`,
          [key, prev.payload_hash, hash],
        );
        await tx.query('COMMIT');
        return { outcome: 'conflict', reason: 'payload hash mismatch for existing business key' };
      }
      if (prev.is_expired) {
        // Expired tombstone → defined-as-new generation, atomically. Archive
        // the old generation, then guarded-renew; a lost race re-reads and
        // returns the winner's generation as a duplicate (never a 2nd gen).
        const newGen = prev.generation + 1;
        const newWfId = workflowIdForGen(key, newGen);
        await tx.query(
          `INSERT INTO p1_business_event_generation
             (business_key, generation, workflow_id, payload_hash, last_status, last_result, accepted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [key, prev.generation, prev.workflow_id, prev.payload_hash, prev.last_status, prev.last_result, prev.accepted_at],
        );
        const renewed = await tx.query(
          `UPDATE p1_business_event
           SET generation = $2, workflow_id = $3, last_status = 'accepted', last_result = NULL,
               accepted_at = now(), expires_at = now() + make_interval(secs => $4)
           WHERE business_key = $1 AND generation = $5`,
          [key, newGen, newWfId, event.idempotencyTtlMs / 1000, prev.generation],
        );
        if ((renewed.rowCount ?? 0) === 0) {
          // Lost the renewal race: return the winner's generation as duplicate.
          const fresh = await tx.query(
            `SELECT business_key, workflow_id, payload_hash, last_status, last_result,
                    generation, accepted_at, (expires_at <= now()) AS is_expired
             FROM p1_business_event WHERE business_key = $1`,
            [key],
          );
          const cur = fresh.rows[0] as BusinessEventRow;
          await tx.query('COMMIT');
          return { outcome: 'duplicate', workflowId: cur.workflow_id, status: cur.last_status, result: cur.last_result };
        }
        await tx.query(`INSERT INTO p1_domain_action (business_key, generation, workflow_id) VALUES ($1, $2, $3)`, [
          key,
          newGen,
          newWfId,
        ]);
        await enqueueInCallerTransaction(client, tx, {
          workflowId: newWfId,
          workflowName: deps.workflowName,
          queueName: deps.queueName,
          args: deps.workflowArgsFor(event),
        });
        await tx.query('COMMIT');
        return { outcome: 'accepted', workflowId: newWfId, status: 'accepted' };
      }
      // Same key + same hash, unexpired: refresh projection from DBOS if history exists.
      const live = await getWorkflowStatus(client, prev.workflow_id).catch(() => null);
      const status = live?.status ?? prev.last_status;
      const result = live?.result ?? prev.last_result;
      if (live) {
        await tx.query(`UPDATE p1_business_event SET last_status = $2, last_result = $3 WHERE business_key = $1`, [
          key,
          live.status,
          JSON.stringify(live.result ?? null),
        ]);
      }
      await tx.query('COMMIT');
      return { outcome: 'duplicate', workflowId: prev.workflow_id, status, result };
    }

    // Winner path: domain mutation + event + enqueue, all in this transaction.
    // The domain write is idempotent per (key, generation): a resubmission
    // after idempotency-row loss reuses the live workflow and must not fail
    // on an already-applied domain effect (M-06). Rollback still removes all
    // three writes atomically (M-07).
    await tx.query(
      `INSERT INTO p1_domain_action (business_key, generation, workflow_id) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING`,
      [key, row.workflow_id],
    );
    await deps.hooks?.afterInsert?.();
    await enqueueInCallerTransaction(client, tx, {
      workflowId: row.workflow_id,
      workflowName: deps.workflowName,
      queueName: deps.queueName,
      args: deps.workflowArgsFor(event),
    });
    await deps.hooks?.beforeCommit?.();
    await tx.query('COMMIT');
    return { outcome: 'accepted', workflowId: row.workflow_id, status: 'accepted' };
  } catch (err) {
    await tx?.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    tx?.release();
  }
}

/** Test-only helper: stable UUID for assertions without re-deriving. */
export function testIds(e: AuthenticatedEvent): { key: string; workflowId: string } {
  const key = businessKeyOf(e);
  return { key, workflowId: workflowIdFor(key) };
}

/**
 * HTTP mapping for handler outcomes (m-02). The prototype has no HTTP layer;
 * this pure function pins the contract a future route adapter must honor:
 * duplicates and renewals are successes (the request was absorbed exactly
 * once), conflicts are 409. Unit-tested without a database.
 */
export function httpStatusForOutcome(outcome: HandleResult['outcome']): 200 | 409 {
  return outcome === 'conflict' ? 409 : 200;
}
