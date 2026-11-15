/**
 * Race-observer unit tests (no database). Cover the contention predicate
 * over pg_stat_activity rows, plus a deterministic reproduction of the old
 * same-pool sampler's failure mechanism (CI run 43688018842: maxActive 0).
 *
 * Discipline note (prompt16 refinement 2): these tests prove the old
 * observer COULD fail this way (queued behind racers; errors swallowed
 * into a silent zero). They do not prove which mechanism fired on that
 * particular CI run — maxActive=0 alone cannot distinguish starvation
 * from a missed window from a swallowed error. The new design eliminates
 * all three weaknesses.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  formatActivitySnapshot,
  selectContendingBackends,
  type ActivityRow,
  type ContentionFilter,
} from './race-observer.js';

const FILTER: ContentionFilter = {
  database: 'phase0_proofs',
  contenderApp: 'p1-race-contender',
  queryFragment: 'INSERT INTO p1_business_event',
};
const SELF_PID = 99999;

function row(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    pid: 100,
    datname: 'phase0_proofs',
    application_name: 'p1-race-contender',
    state: 'active',
    wait_event_type: 'Lock',
    wait_event: 'transactionid',
    query: 'INSERT INTO p1_business_event (business_key, ...) VALUES (...) ON CONFLICT DO NOTHING',
    xact_start: '2026-11-15T07:01:30Z',
    blockers: [42],
    ...overrides,
  };
}

describe('selectContendingBackends', () => {
  test('two blocked contenders are selected', () => {
    const pids = selectContendingBackends([row({ pid: 101 }), row({ pid: 102 }), row({ pid: 103, blockers: [] })], SELF_PID, FILTER);
    expect(pids).toEqual([101, 102]);
  });

  test('observer session itself never counts', () => {
    const pids = selectContendingBackends(
      [row({ pid: SELF_PID }), row({ pid: SELF_PID, application_name: 'p1-race-observer' })],
      SELF_PID,
      FILTER,
    );
    expect(pids).toEqual([]);
  });

  test('other databases never count', () => {
    expect(selectContendingBackends([row({ datname: 'postgres' })], SELF_PID, FILTER)).toEqual([]);
  });

  test('non-contender application names never count (worker, shared clients)', () => {
    const rows = [
      row({ application_name: 'p1-race-observer' }),
      row({ application_name: '' }),
      row({ application_name: null }),
    ];
    expect(selectContendingBackends(rows, SELF_PID, FILTER)).toEqual([]);
  });

  test('idle backends never count', () => {
    expect(selectContendingBackends([row({ state: 'idle in transaction' })], SELF_PID, FILTER)).toEqual([]);
  });

  test('unrelated queries never count (duplicate-path SELECTs, census)', () => {
    const rows = [
      row({ query: 'SELECT business_key FROM p1_business_event WHERE business_key = $1 FOR UPDATE' }),
      row({ query: 'SELECT count(*) FROM pg_stat_activity' }),
      row({ query: null }),
    ];
    expect(selectContendingBackends(rows, SELF_PID, FILTER)).toEqual([]);
  });

  test('active insert backends with no blockers never count (broken-constraint detector)', () => {
    // If the unique constraint vanished, losers would sail through their
    // INSERTs unblocked: activity without blocking must not read as proof.
    const rows = [row({ pid: 101, blockers: [] }), row({ pid: 102, blockers: [] })];
    expect(selectContendingBackends(rows, SELF_PID, FILTER)).toEqual([]);
  });

  test('duplicate rows for one pid count once', () => {
    expect(selectContendingBackends([row({ pid: 101 }), row({ pid: 101 })], SELF_PID, FILTER)).toEqual([101]);
  });

  test('snapshot formats every diagnostic column', () => {
    const snap = formatActivitySnapshot([row({ pid: 101 })]);
    for (const part of ['pid=101', 'app=p1-race-contender', 'state=active', 'Lock/transactionid', 'blockers=[42]', 'INSERT INTO p1_business_event']) {
      expect(snap).toContain(part);
    }
    expect(formatActivitySnapshot([])).toBe('(no backends observed)');
  });
});

describe('old sampler failure mechanism (repro)', () => {
  /** Minimal FIFO pool honoring max concurrency, like pg.Pool for acquires. */
  class FakePool {
    private held = 0;
    private waiters: Array<() => void> = [];
    constructor(readonly max: number) {}
    acquire(): Promise<() => void> {
      return new Promise((resolve) => {
        const tryGrant = () => {
          if (this.held < this.max) {
            this.held += 1;
            resolve(() => {
              this.held -= 1;
              const next = this.waiters.shift();
              if (next) next();
            });
          } else {
            this.waiters.push(tryGrant);
          }
        };
        tryGrant();
      });
    }
  }

  test('a same-pool sampler queues behind racers and can observe zero during genuine overlap', async () => {
    const pool = new FakePool(5);
    // Five racers hold every slot for the whole overlap window.
    const releases = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()]);
    let samplerSaw: number | null = null;
    const sampleAttempt = pool.acquire().then((release) => {
      samplerSaw = 5; // would-be observation, if it ever acquired
      release();
    });
    // The overlap window ends while the sampler is still queued.
    const first = await Promise.race([sampleAttempt.then(() => 'sampled'), Promise.resolve('window-over')]);
    expect(first).toBe('window-over');
    expect(samplerSaw).toBeNull(); // genuine 8-way overlap, observed as nothing
    releases.forEach((release) => release());
    await sampleAttempt; // drains cleanly after the window
    expect(samplerSaw).toBe(5); // post-window observation proves nothing about the race
  });

  test('a swallowing sampler loop exits silently with zero on query error', async () => {
    // Mirrors the removed `try { query } catch { break; }` shape: an
    // instrumentation failure is indistinguishable from observed-zero.
    let maxActive = 0;
    let stop = false;
    let polls = 0;
    while (!stop) {
      try {
        polls += 1;
        throw new Error('simulated observer query failure');
      } catch {
        break;
      }
    }
    expect(polls).toBe(1);
    expect(maxActive).toBe(0); // silent zero — the CI symptom, with no diagnostic
  });

  test('the rewritten race test contains neither the sampler nor swallowed errors', () => {
    const src = readFileSync('phase0/p1/p1.test.ts', 'utf8');
    expect(src).not.toMatch(/maxActive\s*=\s*Math\.max/);
    expect(src).not.toContain('setTimeout(res, 25)');
    expect(src).not.toMatch(/catch\s*\{\s*break/);
    expect(src).toContain('pg_blocking_pids');
    expect(src).toContain('Promise.allSettled(racers)');
    expect(src).toContain('releaseWinner()');
  });
});
