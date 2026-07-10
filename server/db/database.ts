import type { Pool } from 'pg'

/**
 * Thin query surface every repo depends on. Keeping repos behind this interface
 * (rather than a raw pg Pool) is what makes the tenancy invariant unit-testable
 * with FakeDatabase — no live Postgres required to prove location isolation.
 */
export interface Database {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
}

/** Production implementation backed by a pg connection pool. */
export class PgDatabase implements Database {
  constructor(private pool: Pool) {}
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params as unknown[])
    return result.rows as T[]
  }
}
