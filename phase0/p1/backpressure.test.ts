/**
 * Pool backpressure acceptance test (Phase 0, prompt6 §5). Real PostgreSQL only.
 *
 * Proves bounded acquisition: with pool max 2 and a 2s acquire timeout, a
 * 10-way concurrent flood must fail fast with retryable errors (never hang,
 * never silently drop, never acknowledge uncommitted work), and retries of
 * the failed keys must converge through the P1 idempotency contract.
 *
 * Env: P1_DATABASE_URL (same scratch DB as p1.test.ts).
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { AcquireTimeoutError, handleEvent, type AuthenticatedEvent } from './handler.js';
import { resetSharedClients, sharedClientCreationCount } from './dbos-adapter.js';
import { assertDisposableUrl } from '../db-guard.js';

const DATABASE_URL = process.env.P1_DATABASE_URL ?? process.env.PHASE0_DATABASE_URL ?? '';
const gated = DATABASE_URL === '' ? test.skip : test;
const RUN_ID = process.env.PHASE0_RUN_ID ?? 'manual';

function makeEvent(i: number): AuthenticatedEvent {
  return {
    provider: 'p1test',
    accountBinding: 'acct-1',
    agencyId: 'ag-1',
    locationId: 'loc-1',
    providerEventId: `${RUN_ID}:evt-pressure-${i}`,
    payloadCanonical: `{"i":${i}}`,
    idempotencyTtlMs: 24 * 3600 * 1000,
  };
}

describe('enqueue-pool backpressure (requires P1_DATABASE_URL)', () => {
  let pool: Pool;
  beforeEach(async () => {
    assertDisposableUrl(DATABASE_URL, 'P1_DATABASE_URL|PHASE0_DATABASE_URL');
    // application_name tags OUR backends so the census below ignores the
    // concurrently running p1 worker and any other session (M-13).
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, application_name: 'p1-flood-test' });
    await pool.query(
      'TRUNCATE p1_business_event_discrepancy, p1_business_event_generation, p1_business_event, p1_domain_action, p1_execution_log',
    );
    await resetSharedClients();
  });
  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await resetSharedClients();
  });

  gated('saturated pool fails fast, retryable, with zero silent loss', async () => {
    // Hold every pool slot with slow queries so handler acquisitions queue.
    // Hold (4s) comfortably exceeds the acquire timeout (2s); holds are
    // awaited to completion before release so the retry phase gets a clean pool.
    const holders: PoolClient[] = [await pool.connect(), await pool.connect()];
    const holds = holders.map((h) => h.query('SELECT pg_sleep(4)'));
    try {
      const N = 10;
      const deps = {
        pool,
        systemDatabaseUrl: DATABASE_URL,
        workflowName: 'p1-echo',
        queueName: 'p1',
        workflowArgsFor: (e: AuthenticatedEvent) => [{ locationId: e.locationId }],
        acquireTimeoutMs: 2000,
        dbosPoolSize: 2,
      };
      // Backend census during the flood (M-13): OUR tagged backends must
      // never exceed the configured pool max (2), proving bounded acquisition
      // regardless of what the concurrently running worker holds. DBOS-client
      // sharing is proven separately by the creation counter below (a global
      // backend bound would conflate worker, sampler, and test pools).
      const census = new Pool({ connectionString: DATABASE_URL, max: 1, application_name: 'p1-flood-census' });
      let stopSampling = false;
      let maxOurs = 0;
      const sampler = (async () => {
        while (!stopSampling) {
          try {
            const r = await census.query(
              `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'p1-flood-test'`,
            );
            maxOurs = Math.max(maxOurs, r.rows[0].n as number);
          } catch {
            break;
          }
          await new Promise((res) => setTimeout(res, 50));
        }
      })();
      const started = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: N }, (_, i) => handleEvent(deps, makeEvent(i))),
      );
      const elapsed = Date.now() - started;
      stopSampling = true;
      await sampler;
      await census.end();
      expect(maxOurs).toBeLessThanOrEqual(2);
      // Exactly one shared DBOSClient served all 10 handler calls (M-13:
      // bounded system-pool connections, no per-request pool creation).
      expect(sharedClientCreationCount()).toBe(1);
      const timedOut = results.filter(
        (r) => r.status === 'rejected' && r.reason instanceof AcquireTimeoutError,
      );
      // All 10 must time out: both slots are held for 4s > 2s timeout.
      expect(timedOut.length).toBe(N);
      for (const r of timedOut) {
        expect((r as PromiseRejectedResult).reason.retryable).toBe(true);
      }
      // Bounded: the whole flood resolves in ~timeout, not ~hold duration.
      expect(elapsed).toBeLessThan(6000);
      // Nothing committed, nothing acknowledged: zero business rows.
      // (Saturation itself is proven by all 10 timing out; the count query
      // uses a separate admin connection since both pool slots are held.)
      const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
      try {
        const committed = await admin.query('SELECT count(*)::int AS n FROM p1_business_event');
        expect(committed.rows[0].n).toBe(0);
      } finally {
        await admin.end();
      }
    } finally {
      await Promise.all(holds);
      for (const h of holders) h.release();
    }

    // Retry after relief: every key converges exactly once (accepted).
    const deps = {
      pool,
      systemDatabaseUrl: DATABASE_URL,
      workflowName: 'p1-echo',
      queueName: 'p1',
      workflowArgsFor: (e: AuthenticatedEvent) => [{ locationId: e.locationId }],
      acquireTimeoutMs: 10000,
      dbosPoolSize: 2,
    };
    const retries = await Promise.all(Array.from({ length: 10 }, (_, i) => handleEvent(deps, makeEvent(i))));
    expect(retries.filter((r) => r.outcome === 'accepted').length).toBe(10);
    const committed = await pool.query('SELECT count(*)::int AS n FROM p1_business_event');
    expect(committed.rows[0].n).toBe(10);
  });
});
