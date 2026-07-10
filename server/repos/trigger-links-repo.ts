import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface TriggerLink {
  id: string
  location_id: string
  name: string
  slug: string
  destination_url: string
  created_at: string
  updated_at: string
}

/** A link decorated with stats DERIVED from its real click rows (never stored). */
export interface TriggerLinkWithStats extends TriggerLink {
  clicks: number
  contacts: number
  last_clicked_at: string | null
}

export interface TriggerLinkInput {
  name: string
  slug: string
  destinationUrl: string
}

export interface TriggerLinkPatch {
  name?: string
  slug?: string
  destinationUrl?: string
}

/**
 * Trackable short links for one location. The operator names a link to a
 * destination URL; the public route hosts a short link that redirects there and
 * records each open as a row in trigger_link_clicks.
 *
 * The figures a link reports — total clicks, how many DISTINCT contacts clicked,
 * and when it was last clicked — are not columns here. `listWithStats` /
 * `getWithStats` DERIVE them with a LEFT JOIN aggregate over the real click rows,
 * so a count can never drift from the clicks that justify it and can't be
 * inflated; an unclicked link aggregates to an honest zero. Those join queries
 * don't fit the base-repo regex rewrite (two tables both have `location_id`), so
 * they call `db.query` directly while still passing `this.locationId` as $1 and
 * filtering on `tl.location_id` — the tenancy invariant is preserved by hand.
 */
export class TriggerLinksRepo extends LocationScopedRepo {
  /** Operator/list read of the bare rows, newest first (no stats). */
  list(): Promise<TriggerLink[]> {
    return this.scopedSelect<TriggerLink>('SELECT * FROM trigger_links ORDER BY created_at DESC')
  }

  /** Every link with its derived click stats, newest first. */
  listWithStats(): Promise<TriggerLinkWithStats[]> {
    return this.db.query<TriggerLinkWithStats>(
      `SELECT tl.*,
              COUNT(c.id)::int AS clicks,
              COUNT(DISTINCT c.contact_id)::int AS contacts,
              MAX(c.clicked_at) AS last_clicked_at
       FROM trigger_links tl
       LEFT JOIN trigger_link_clicks c ON c.link_id = tl.id
       WHERE tl.location_id = $1
       GROUP BY tl.id
       ORDER BY tl.created_at DESC`,
      [this.locationId],
    )
  }

  async get(id: string): Promise<TriggerLink | undefined> {
    const rows = await this.scopedSelect<TriggerLink>('SELECT * FROM trigger_links WHERE id=$2', [
      id,
    ])
    return rows[0]
  }

  async getWithStats(id: string): Promise<TriggerLinkWithStats | undefined> {
    const rows = await this.db.query<TriggerLinkWithStats>(
      `SELECT tl.*,
              COUNT(c.id)::int AS clicks,
              COUNT(DISTINCT c.contact_id)::int AS contacts,
              MAX(c.clicked_at) AS last_clicked_at
       FROM trigger_links tl
       LEFT JOIN trigger_link_clicks c ON c.link_id = tl.id
       WHERE tl.location_id = $1 AND tl.id = $2
       GROUP BY tl.id`,
      [this.locationId, id],
    )
    return rows[0]
  }

  async getBySlug(slug: string): Promise<TriggerLink | undefined> {
    const rows = await this.scopedSelect<TriggerLink>('SELECT * FROM trigger_links WHERE slug=$2', [
      slug,
    ])
    return rows[0]
  }

  async create(input: TriggerLinkInput): Promise<TriggerLink> {
    const id = nanoid()
    const rows = await this.scopedWrite<TriggerLink>(
      `INSERT INTO trigger_links (id, location_id, name, slug, destination_url)
       VALUES ($2,$1,$3,$4,$5)
       RETURNING *`,
      [id, input.name, input.slug, input.destinationUrl],
    )
    return rows[0]!
  }

  /** Patch the supplied fields only; always refresh updated_at. `scopedWrite`
   *  prepends locationId as $1, so the dynamic params number from $2. */
  async update(id: string, patch: TriggerLinkPatch): Promise<TriggerLink | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.name !== undefined) bind('name', patch.name)
    if (patch.slug !== undefined) bind('slug', patch.slug)
    if (patch.destinationUrl !== undefined) bind('destination_url', patch.destinationUrl)
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<TriggerLink>(
      `UPDATE trigger_links SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM trigger_links WHERE location_id=$1 AND id=$2', [id])
  }
}
