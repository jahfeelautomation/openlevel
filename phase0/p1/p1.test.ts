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
import {
  formatActivitySnapshot,
  selectContendingBackends,
  type ActivityRow,
  type ContentionFilter,
} from './race-observer.js';

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

/**
 * Poll the independent observer pool until at least two distinct contender
 * backends are actually blocked on the P1 insert, or fail loudly with a
 * full activity snapshot at the deadline. Observer query errors propagate
 * — they are never swallowed into a zero count. The winner stays held for
 * the whole window, so polling only waits for loser arrival (guaranteed by
 * pool capacity), never for a lucky timing overlap.
 */
async function observeContenders(
  observerPool: Pool,
  winnerArrived: () => boolean,
  filter: ContentionFilter & { deadlineMs: number },
): Promise<number[]> {
  const selfPid = (await observerPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  const start = Date.now();
  let lastSnapshot = '(no observation yet)';
  for (;;) {
    const r = await observerPool.query(
      `SELECT pid, datname, application_name, state, wait_event_type, wait_event,
              left(query, 300) AS query, xact_start::text AS xact_start,
              pg_blocking_pids(pid) AS blockers
       FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()`,
    );
    const rows = (r.rows as Array<Record<string, unknown>>).map(
      (row): ActivityRow => ({
        pid: row.pid as number,
        datname: row.datname as string | null,
        application_name: row.application_name as string | null,
        state: row.state as string | null,
        wait_event_type: row.wait_event_type as string | null,
        wait_event: row.wait_event as string | null,
        query: row.query as string | null,
        xact_start: row.xact_start as string | null,
        blockers: (row.blockers as number[] | null) ?? [],
      }),
    );
    lastSnapshot = formatActivitySnapshot(rows);
    if (winnerArrived()) {
      const contenders = selectContendingBackends(rows, selfPid, filter);
      if (contenders.length >= 2) return contenders;
    }
    if (Date.now() - start > filter.deadlineMs) {
      throw new Error(
        `timed out waiting for contending P1 backends (winner arrived: ${winnerArrived()}). Snapshot:\n${lastSnapshot}`,
      );
    }
    await new Promise((res) => setTimeout(res, 100));
  }
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
    // Deterministic contention proof (prompt16): the unique constraint
    // decides the winner; the winner holds its uncommitted transaction at
    // the afterInsert hook while losers block on the unique insert; an
    // INDEPENDENT observer pool records backends actually blocked on the
    // P1 insert (pg_blocking_pids), never the contenders' own pool. The
    // old same-pool 25ms sampler missed short windows and swallowed its
    // own errors (CI run 43688018842: maxActive 0) — it is gone.
    const contenderPool = new Pool({ connectionString: DATABASE_URL, max: 5, application_name: 'p1-race-contender' });
    const observerPool = new Pool({ connectionString: DATABASE_URL, max: 1, application_name: 'p1-race-observer' });
    try {
      const deps = makeDeps(contenderPool);
      const e = makeEvent();
      const N = 8;
      let releaseWinner!: () => void;
      const winnerGate = new Promise<void>((r) => (releaseWinner = r));
      let winnerArrived = false;
      const holdDeps: P1Deps = {
        ...deps,
        hooks: {
          afterInsert: async () => {
            winnerArrived = true;
            await winnerGate;
          },
        },
      };
      const racers = Array.from({ length: N }, () => handleEvent(holdDeps, e));
      let observed: number[];
      try {
        observed = await observeContenders(observerPool, () => winnerArrived, {
          database: new URL(DATABASE_URL).pathname.replace(/^\//, ''),
          contenderApp: 'p1-race-contender',
          queryFragment: 'INSERT INTO p1_business_event',
          deadlineMs: 15000,
        });
      } catch (err) {
        releaseWinner();
        const settled = await Promise.allSettled(racers);
        if (!winnerArrived) {
          const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
          if (rejected) {
            throw new Error(
              `${(err as Error).message} | winner never arrived; racer rejection: ${String(rejected.reason).slice(0, 300)}`,
            );
          }
        }
        throw err;
      }
      releaseWinner();
      const results = await Promise.all(racers);
      expect(observed.length).toBeGreaterThanOrEqual(2);
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
    } finally {
      await contenderPool.end().catch(() => undefined);
      await observerPool.end().catch(() => undefined);
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
