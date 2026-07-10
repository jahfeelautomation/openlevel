import { nanoid } from 'nanoid'
import type { FunnelStatus } from '../lib/funnel-vocab'
import { LocationScopedRepo } from './base-repo'

export interface Funnel {
  id: string
  location_id: string
  name: string
  slug: string
  status: string
  created_at: string
  updated_at: string
}

export interface FunnelInput {
  name: string
  slug: string
  status?: FunnelStatus
}

export interface FunnelPatch {
  name?: string
  slug?: string
}

export class FunnelsRepo extends LocationScopedRepo {
  list(): Promise<Funnel[]> {
    return this.scopedSelect<Funnel>('SELECT * FROM funnels ORDER BY created_at DESC')
  }

  /** Funnel list with a real step count per funnel. Uses a GROUP BY, so it goes
   *  through db.query directly (the scopedSelect filter-injection can't rewrite an
   *  aggregate query) — still location-bound via $1. count(...)::int comes back a
   *  JS number. */
  listWithStepCounts(): Promise<(Funnel & { step_count: number })[]> {
    return this.db.query<Funnel & { step_count: number }>(
      `SELECT f.*, count(s.id)::int AS step_count
         FROM funnels f
         LEFT JOIN funnel_steps s ON s.funnel_id = f.id AND s.location_id = f.location_id
        WHERE f.location_id = $1
        GROUP BY f.id
        ORDER BY f.created_at DESC`,
      [this.locationId],
    )
  }

  async get(id: string): Promise<Funnel | undefined> {
    const rows = await this.scopedSelect<Funnel>('SELECT * FROM funnels WHERE id=$2', [id])
    return rows[0]
  }

  /** Find a funnel by its location-scoped slug — the public capture path looks a
   *  page up by /:loc/:slug, so this stays tenancy-bound even when unauthed. */
  async getBySlug(slug: string): Promise<Funnel | undefined> {
    const rows = await this.scopedSelect<Funnel>('SELECT * FROM funnels WHERE slug=$2', [slug])
    return rows[0]
  }

  async create(input: FunnelInput): Promise<Funnel> {
    const id = nanoid()
    const rows = await this.scopedWrite<Funnel>(
      `INSERT INTO funnels (id, location_id, name, slug, status)
       VALUES ($2,$1,$3,$4,$5) RETURNING *`,
      [id, input.name, input.slug, input.status ?? 'draft'],
    )
    return rows[0]!
  }

  async setStatus(id: string, status: FunnelStatus): Promise<Funnel | undefined> {
    const rows = await this.scopedWrite<Funnel>(
      `UPDATE funnels SET status=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [status, id],
    )
    return rows[0]
  }

  /**
   * Patch only the provided columns. Builds a dynamic SET starting at $2 (since
   * $1 is the location), always bumps updated_at, and pins id as the last param.
   * Returns undefined when nothing was provided (no query issued).
   */
  async update(id: string, patch: FunnelPatch): Promise<Funnel | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.slug !== undefined) push('slug', patch.slug)
    if (sets.length === 0) return undefined

    sets.push('updated_at=now()')
    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Funnel>(
      `UPDATE funnels SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }
}
