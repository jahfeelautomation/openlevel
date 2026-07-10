import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface TriggerLinkClick {
  id: string
  location_id: string
  link_id: string
  contact_id: string | null
  clicked_at: string
}

/** A click joined to the clicking contact's name (null name = an anonymous open). */
export interface TriggerLinkClickWithContact {
  id: string
  clicked_at: string
  contact_id: string | null
  contact_name: string | null
}

export interface TriggerLinkClickInput {
  linkId: string
  /** The contact the link was attributed to (?c=), or null for an anonymous open. */
  contactId: string | null
}

/**
 * The honest event log behind a trigger link's stats: one row per open. Counts
 * are never stored on the link — they're aggregated from these rows on read (see
 * TriggerLinksRepo.listWithStats), so a click total is always exactly the number
 * of real opens. `recentForLink` powers the operator's activity feed and joins
 * the contact so a known opener shows by name; that join doesn't fit the
 * base-repo rewrite, so it filters on `cl.location_id = $1` explicitly while
 * still passing the locationId first.
 */
export class TriggerLinkClicksRepo extends LocationScopedRepo {
  async record(input: TriggerLinkClickInput): Promise<TriggerLinkClick> {
    const id = nanoid()
    const rows = await this.scopedWrite<TriggerLinkClick>(
      `INSERT INTO trigger_link_clicks (id, location_id, link_id, contact_id)
       VALUES ($2,$1,$3,$4)
       RETURNING *`,
      [id, input.linkId, input.contactId],
    )
    return rows[0]!
  }

  recentForLink(linkId: string, limit = 20): Promise<TriggerLinkClickWithContact[]> {
    return this.db.query<TriggerLinkClickWithContact>(
      `SELECT cl.id, cl.clicked_at, cl.contact_id, ct.name AS contact_name
       FROM trigger_link_clicks cl
       LEFT JOIN contacts ct ON ct.id = cl.contact_id
       WHERE cl.location_id = $1 AND cl.link_id = $2
       ORDER BY cl.clicked_at DESC
       LIMIT $3`,
      [this.locationId, linkId, limit],
    )
  }
}
