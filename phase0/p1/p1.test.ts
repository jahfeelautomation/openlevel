/**
 * P1 acceptance tests (Phase 0). Run ONLY against a scratch real-PostgreSQL
 * database with the pinned DBOS SDK installed (Gates A+B+C).
 *
 * Env: P1_DATABASE_URL (direct, sysdb-capable) — never production.
 * Setup: `psql $P1_DATABASE_URL -f schema.sql` + DBOS worker running the
 * `p1-echo` workflow (see README). Each test truncates p1 tables first.
 *
 * Pass criteria are the plan6.2 §2 + addendum §1 acceptance paragraphs.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { Pool } from 'pg';
import { deleteWorkflowById, getWorkflowStatus, createClient, resetSharedClients } from './dbos-adapter.js';
import { handleEvent, testIds, workflowIdForGen, type AuthenticatedEvent, type P1Deps } from './handler.js';
import { assertDisposableUrl } from '../db-guard.js';

const DATABASE_URL = process.env.P1_DATABASE_URL ?? process.env.PHASE0_DATABASE_URL ?? '';
// Run identity (M-05): business keys are namespaced per run so the suite is
// re-runnable against one retained database with independent results.
const RUN_ID = process.env.PHASE0_RUN_ID ?? 'manual';

function makeEvent(overrides: Partial<AuthenticatedEvent> = {}): AuthenticatedEvent {
  const { providerEventId, ...rest } = overrides;
  return {
    provider: 'p1test',
    accountBinding: 'acct-1',
    agencyId: 'ag-1',
    locationId: 'loc-1',
    providerEventId: `${RUN_ID}:${providerEventId ?? 'evt-1'}`,
    payloadCanonical: '{"text":"hello"}',
    idempotencyTtlMs: 24 * 3600 * 1000,
    ...rest,
  };
}

function makeDeps(pool: Pool): P1Deps {
  return {
    pool,
    systemDatabaseUrl: DATABASE_URL,
    workflowName: 'p1-echo',
    queueName: 'p1',
    workflowArgsFor: (e) => [{ locationId: e.locationId, providerEventId: e.providerEventId }],
  };
}

describe('P1 atomic enqueue (requires P1_DATABASE_URL + pinned SDK)', () => {
  // Skip-with-reason when the gate preconditions are absent: an unexecuted
  // test must never read as passed.
  const gated = DATABASE_URL === '' ? test.skip : test;

  let pool: Pool;
  beforeEach(async () => {
    // Preflight: refuse production/unrecognized targets before any TRUNCATE.
    assertDisposableUrl(DATABASE_URL, 'P1_DATABASE_URL|PHASE0_DATABASE_URL');
    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    await pool.query(
      'TRUNCATE p1_business_event_discrepancy, p1_business_event_generation, p1_business_event, p1_domain_action, p1_execution_log',
    );
  });
  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await resetSharedClients();
  });

  async function executionCount(workflowId: string): Promise<number> {
    const r = await pool.query(`SELECT count(*)::int AS n FROM p1_execution_log WHERE workflow_id = $1`, [workflowId]);
    return r.rows[0].n as number;
  }

  async function waitForExecution(workflowId: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    for (;;) {
      if ((await executionCount(workflowId)) >= 1) return;
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for execution of ${workflowId}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  gated('concurrent identical requests create one business event and one workflow', async () => {
    const deps = makeDeps(pool);
    const e = makeEvent();
    // Barrier + overlap evidence (i-01): contenders wait for a shared release
    // while a sampler records peak concurrent active backends. The unique
    // constraint decides the winner deterministically; the sampler proves the
    // transactions genuinely overlapped (maxActive >= 2) rather than running
    // back-to-back.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const N = 8;
    let stopSampling = false;
    let maxActive = 0;
    const sampler = (async () => {
      while (!stopSampling) {
        try {
          const r = await pool.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()`,
          );
          maxActive = Math.max(maxActive, r.rows[0].n as number);
        } catch {
          break;
        }
        await new Promise((res) => setTimeout(res, 25));
      }
    })();
    const racers = Array.from({ length: N }, () => gate.then(() => handleEvent(deps, e)));
    await new Promise((r) => setTimeout(r, 100));
    release();
    const results = await Promise.all(racers);
    stopSampling = true;
    await sampler;
    expect(maxActive).toBeGreaterThanOrEqual(2);
    const accepted = results.filter((r) => r.outcome === 'accepted');
    const dups = results.filter((r) => r.outcome === 'duplicate');
    expect(accepted.length).toBe(1);
    expect(dups.length).toBe(N - 1);
    for (const d of dups) {
      if (d.outcome !== 'duplicate') throw new Error('unreachable');
      expect(d.workflowId).toBe(testIds(e).workflowId);
      // m-01: every loser reports a live DBOS status (not a bare UUID).
      // Equality across losers is NOT asserted: early losers may observe
      // ENQUEUED/PENDING while later ones observe SUCCESS — all legitimate.
      expect(['PENDING', 'SUCCESS', 'ERROR', 'ENQUEUED']).toContain(d.status);
    }
    const count = await pool.query('SELECT count(*)::int AS n FROM p1_business_event');
    expect(count.rows[0].n).toBe(1);
    // Reuse-behavior proof: exactly one execution for the shared UUID, and
    // the duplicate path observed the live workflow (no second enqueue).
    await waitForExecution(testIds(e).workflowId);
    expect(await executionCount(testIds(e).workflowId)).toBe(1);
    const client = await createClient(DATABASE_URL);
    try {
      const st = await getWorkflowStatus(client, testIds(e).workflowId);
      expect(st?.status).toBe('SUCCESS');
    } finally {
      await client.destroy();
    }
  });

  gated('rollback leaves neither business event nor workflow', async () => {
    const deps = makeDeps(pool);
    const crashing: P1Deps = {
      ...deps,
      hooks: {
        beforeCommit: async () => {
          throw new Error('injected pre-commit failure');
        },
      },
    };
    const e = makeEvent({ providerEventId: 'evt-rollback' });
    await expect(handleEvent(crashing, e)).rejects.toThrow('injected pre-commit failure');
    const uuid = testIds(e).workflowId;
    // M-07: assert absence across event row, synthetic domain mutation, and
    // every DBOS durable artifact (table names verified in SDK 5.5.0).
    for (const [label, sql] of [
      ['event', `SELECT count(*)::int AS n FROM p1_business_event WHERE business_key = $1`],
      ['domain', `SELECT count(*)::int AS n FROM p1_domain_action WHERE business_key = $1`],
      ['status', `SELECT count(*)::int AS n FROM dbos.workflow_status WHERE workflow_uuid = $1`],
      ['outputs', `SELECT count(*)::int AS n FROM dbos.operation_outputs WHERE workflow_uuid = $1`],
    ] as const) {
      const arg = label === 'event' || label === 'domain' ? testIds(e).key : uuid;
      const r = await pool.query(sql, [arg]);
      expect(r.rows[0].n, `${label} must be absent after rollback`).toBe(0);
    }
    const client = await createClient(DATABASE_URL);
    try {
      expect(await getWorkflowStatus(client, uuid)).toBeNull();
    } finally {
      await client.destroy();
    }
  });

  gated('delete-then-resubmit reuses the live workflow without new execution (M-06)', async () => {
    const deps = makeDeps(pool);
    const e = makeEvent({ providerEventId: 'evt-reuse' });
    const first = await handleEvent(deps, e);
    expect(first.outcome).toBe('accepted');
    await waitForExecution(testIds(e).workflowId);
    // Simulate a lost idempotency row with live DBOS history: delete ONLY
    // the business row. Resubmission must take the winner path with the same
    // fixed UUID, and the reuse policy must return the existing workflow.
    await pool.query(`DELETE FROM p1_business_event WHERE business_key = $1`, [testIds(e).key]);
    const second = await handleEvent(deps, e);
    expect(second.outcome).toBe('accepted');
    if (second.outcome !== 'accepted') throw new Error('expected accepted');
    expect(second.workflowId).toBe(testIds(e).workflowId);
    await new Promise((r) => setTimeout(r, 2000));
    expect(await executionCount(testIds(e).workflowId)).toBe(1);
    const client = await createClient(DATABASE_URL);
    try {
      expect((await getWorkflowStatus(client, testIds(e).workflowId))?.status).toBe('SUCCESS');
    } finally {
      await client.destroy();
    }
  });

  gated('mid-flight row deletion fails closed without assisted recovery (m-03)', async () => {
    const deps = makeDeps(pool);
    const e = makeEvent({ providerEventId: 'evt-vanish' });
    const first = await handleEvent(deps, e);
    expect(first.outcome).toBe('accepted');
    // Deterministic invariant-violation trigger with two connections:
    // session B locks the row; the handler blocks on FOR UPDATE; B deletes
    // and commits; the handler then finds conflict-without-row and throws.
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT 1 FROM p1_business_event WHERE business_key = $1 FOR UPDATE`, [testIds(e).key]);
      const pending = handleEvent(deps, e);
      await new Promise((r) => setTimeout(r, 500)); // let the handler block on the lock
      await blocker.query(`DELETE FROM p1_business_event WHERE business_key = $1`, [testIds(e).key]);
      await blocker.query('COMMIT');
      await expect(pending).rejects.toThrow('P1 invariant violated');
    } finally {
      blocker.release();
    }
    // No silent recovery, no partial state: exactly one execution ever ran.
    expect(await executionCount(testIds(e).workflowId)).toBeLessThanOrEqual(1);
  });

  gated('duplicate after completion returns existing result without re-enqueue', async () => {
    const deps = makeDeps(pool);
    const e = makeEvent({ providerEventId: 'evt-done' });
    const first = await handleEvent(deps, e);
    expect(first.outcome).toBe('accepted');
    await waitForExecution(testIds(e).workflowId);
    const second = await handleEvent(deps, e);
    expect(second.outcome).toBe('duplicate');
    if (second.outcome !== 'duplicate') throw new Error('expected duplicate');
    expect(second.workflowId).toBe(testIds(e).workflowId);
    expect(await executionCount(testIds(e).workflowId)).toBe(1);
  });

  gated('same key with different payload hash returns 409 conflict', async () => {
    const deps = makeDeps(pool);
    const first = await handleEvent(deps, makeEvent({ providerEventId: 'evt-conflict' }));
    expect(first.outcome).toBe('accepted');
    const second = await handleEvent(
      deps,
      makeEvent({ providerEventId: 'evt-conflict', payloadCanonical: '{"text":"tampered"}' }),
    );
    expect(second.outcome).toBe('conflict');
    const disc = await pool.query('SELECT count(*)::int AS n FROM p1_business_event_discrepancy');
    expect(disc.rows[0].n).toBe(1);
    const events = await pool.query('SELECT count(*)::int AS n FROM p1_business_event');
    expect(events.rows[0].n).toBe(1);
  });

  gated('duplicate after workflow-history deletion converges via retained projection', async () => {
    const deps = makeDeps(pool);
    const e = makeEvent({ providerEventId: 'evt-retained' });
    await handleEvent(deps, e);
    await waitForExecution(testIds(e).workflowId);
    // Simulate 30d retention expiry: delete DBOS history, keep the event row.
    await deleteWorkflowById(DATABASE_URL, testIds(e).workflowId);
    const second = await handleEvent(deps, e);
    expect(second.outcome).toBe('duplicate');
    if (second.outcome !== 'duplicate') throw new Error('expected duplicate');
    // Returned the retained local projection (no live status available).
    expect(second.workflowId).toBe(testIds(e).workflowId);
    // Must NOT enqueue: execution log still shows exactly one run.
    expect(await executionCount(testIds(e).workflowId)).toBe(1);
  });

  gated('duplicate after tombstone expiry renews exactly one generation', async () => {
    const deps = makeDeps(pool);
    const e = makeEvent({ providerEventId: 'evt-expired' });
    const first = await handleEvent(deps, e);
    expect(first.outcome).toBe('accepted');
    // Force tombstone expiry (simulates retention-window passage).
    await pool.query(`UPDATE p1_business_event SET expires_at = now() - interval '1 second' WHERE business_key = $1`, [
      testIds(e).key,
    ]);
    const second = await handleEvent(deps, e);
    expect(second.outcome).toBe('accepted');
    if (second.outcome !== 'accepted') throw new Error('expected accepted renewal');
    expect(second.workflowId).toBe(workflowIdForGen(testIds(e).key, 2));
    expect(second.workflowId).not.toBe(testIds(e).workflowId);
    // Old generation archived exactly once; live row is generation 2.
    const arch = await pool.query(`SELECT count(*)::int AS n FROM p1_business_event_generation WHERE business_key = $1`, [
      testIds(e).key,
    ]);
    expect(arch.rows[0].n).toBe(1);
    const live = await pool.query(`SELECT generation FROM p1_business_event WHERE business_key = $1`, [testIds(e).key]);
    expect(live.rows[0].generation).toBe(2);
    await waitForExecution(second.workflowId);
    expect(await executionCount(second.workflowId)).toBe(1);
  });

  gated('concurrent post-expiry resubmits converge on one new generation', async () => {
    const deps = makeDeps(pool);
    const e = makeEvent({ providerEventId: 'evt-expiry-race' });
    await handleEvent(deps, e);
    await pool.query(`UPDATE p1_business_event SET expires_at = now() - interval '1 second' WHERE business_key = $1`, [
      testIds(e).key,
    ]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const N = 8;
    const racers = Array.from({ length: N }, () => gate.then(() => handleEvent(deps, e)));
    await new Promise((r) => setTimeout(r, 100));
    release();
    const results = await Promise.all(racers);
    const accepted = results.filter((r) => r.outcome === 'accepted');
    const dups = results.filter((r) => r.outcome === 'duplicate');
    // Exactly one renewal winner; every loser sees the winner's generation.
    expect(accepted.length).toBe(1);
    expect(dups.length).toBe(N - 1);
    const winnerId = (accepted[0] as { workflowId: string }).workflowId;
    expect(winnerId).toBe(workflowIdForGen(testIds(e).key, 2));
    for (const d of dups) {
      if (d.outcome !== 'duplicate') throw new Error('unreachable');
      expect(d.workflowId).toBe(winnerId);
    }
    const live = await pool.query(`SELECT generation FROM p1_business_event WHERE business_key = $1`, [testIds(e).key]);
    expect(live.rows[0].generation).toBe(2);
    await waitForExecution(winnerId);
    expect(await executionCount(winnerId)).toBe(1);
  });
});
