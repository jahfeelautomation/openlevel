import { LocationScopedRepo } from './base-repo'

export interface TagSummary {
  tag: string
  count: number
}

/**
 * Tags aren't a table of their own — they live inside contacts.tags (a text[]).
 * This repo gives the operator a first-class view over that store: the distinct
 * tags in a location with how many contacts carry each, plus location-wide
 * rename and delete. Every query is scoped to one location (the tenancy
 * invariant), and none of it sends a message or moves money.
 */
export class TagsRepo extends LocationScopedRepo {
  /**
   * Distinct tags in this location, each with its contact count, busiest first.
   * The unnest-subquery shape doesn't fit base-repo's conservative filter
   * rewriter, so this calls db.query directly — still scoping on location_id as
   * $1, per the base-repo contract. count is cast to int so it returns a number
   * rather than pg's bigint-as-string.
   */
  list(): Promise<TagSummary[]> {
    return this.db.query<TagSummary>(
      `SELECT tag, count(*)::int AS count
         FROM (SELECT unnest(tags) AS tag FROM contacts WHERE location_id = $1) t
        GROUP BY tag
        ORDER BY count DESC, tag ASC`,
      [this.locationId],
    )
  }

  /**
   * Rename a tag everywhere it appears in this location. array_replace swaps the
   * value in place; the DISTINCT-unnest wrapper collapses the duplicate that
   * renaming into an already-present tag would create (renaming `lead`->`vip` on
   * a contact already tagged `vip` yields a single `vip`, not two). Returns the
   * number of contacts touched.
   */
  async rename(from: string, to: string): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE contacts
          SET tags = ARRAY(SELECT DISTINCT unnest(array_replace(tags, $2, $3))),
              updated_at = now()
        WHERE location_id = $1 AND $2 = ANY(tags) RETURNING id`,
      [this.locationId, from, to],
    )
    return rows.length
  }

  /**
   * Remove a tag from every contact in this location. Returns the number of
   * contacts touched.
   */
  async remove(tag: string): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE contacts
          SET tags = array_remove(tags, $2),
              updated_at = now()
        WHERE location_id = $1 AND $2 = ANY(tags) RETURNING id`,
      [this.locationId, tag],
    )
    return rows.length
  }
}
