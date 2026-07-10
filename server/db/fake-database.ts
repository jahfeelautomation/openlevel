import type { Database } from './database'

/**
 * Test double: records every query and returns queued rows FIFO.
 * Used to assert the tenancy invariant (location_id always scoped) and to
 * drive repo/route tests without a live Postgres.
 */
export class FakeDatabase implements Database {
  calls: { sql: string; params: unknown[] }[] = []
  private queued: ({ __error: unknown } | unknown[])[] = []

  /** Queue the rows the next query() call should return. */
  enqueue(rows: unknown[]): void {
    this.queued.push(rows)
  }

  /** Queue an error the next query() call should THROW instead of returning rows
   *  — lets a route test exercise its constraint/race path (e.g. a 23505 unique
   *  violation) without standing up a live Postgres. */
  enqueueError(error: unknown): void {
    this.queued.push({ __error: error })
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params })
    const next = this.queued.shift()
    if (next && !Array.isArray(next) && '__error' in next) throw next.__error
    return (next ?? []) as T[]
  }
}
