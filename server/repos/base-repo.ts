import type { Database } from '../db/database'

/**
 * Base class for every per-location data repository.
 *
 * The multi-tenancy invariant lives here: a repo is bound to exactly one
 * locationId at construction, and `scopedSelect` rewrites every read query to
 * filter on `location_id = $1`, injecting the locationId as the first param.
 * Callers number their own params from $2 up. Writes use `scopedWrite`, which
 * passes locationId as $1 but expects the caller's SQL to set location_id
 * explicitly (INSERT column / UPDATE WHERE).
 *
 * The regex rewrite is deliberately conservative; a repo whose query shape does
 * not fit can call `db.query` directly, but MUST still pass `this.locationId`
 * as the first param and filter on it.
 */
export abstract class LocationScopedRepo {
  constructor(
    protected db: Database,
    protected locationId: string,
  ) {
    if (!locationId) throw new Error('locationId is required (tenancy guard)')
  }

  protected scopedSelect<T = unknown>(sql: string, extra: unknown[] = []): Promise<T[]> {
    return this.db.query<T>(this.injectLocationFilter(sql), [this.locationId, ...extra])
  }

  protected scopedWrite<T = unknown>(sql: string, extra: unknown[] = []): Promise<T[]> {
    return this.db.query<T>(sql, [this.locationId, ...extra])
  }

  private injectLocationFilter(sql: string): string {
    if (/\bwhere\b/i.test(sql)) {
      return sql.replace(/\bwhere\b/i, 'WHERE location_id = $1 AND')
    }
    const tail = sql.match(/\b(order by|group by|limit|returning)\b/i)
    if (tail) {
      const at = sql.toLowerCase().indexOf(tail[0].toLowerCase())
      return sql.slice(0, at) + 'WHERE location_id = $1 ' + sql.slice(at)
    }
    return sql + ' WHERE location_id = $1'
  }
}
