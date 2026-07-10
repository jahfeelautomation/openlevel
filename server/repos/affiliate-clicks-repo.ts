import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface AffiliateClick {
  id: string
  location_id: string
  affiliate_id: string
  contact_id: string | null
  clicked_at: string
}

/** A click joined to the visiting contact's name (null name = an anonymous visit). */
export interface AffiliateClickWithContact {
  id: string
  clicked_at: string
  contact_id: string | null
  contact_name: string | null
}

export interface AffiliateClickInput {
  affiliateId: string
  /** The contact the visit was attributed to (?c=), or null for an anonymous visit. */
  contactId: string | null
}

/**
 * The honest event log behind an affiliate's click stats: one row per referral
 * link visit. Clicks are never stored as a counter on the affiliate — they're
 * aggregated from these rows on read (see AffiliatesRepo.listWithStats), so a
 * click total is always exactly the number of real visits. `recentForAffiliate`
 * powers the affiliate's activity feed and joins the contact so a known visitor
 * shows by name; that join doesn't fit the base-repo rewrite, so it filters on
 * `cl.location_id = $1` explicitly while still passing the locationId first.
 */
export class AffiliateClicksRepo extends LocationScopedRepo {
  async record(input: AffiliateClickInput): Promise<AffiliateClick> {
    const id = nanoid()
    const rows = await this.scopedWrite<AffiliateClick>(
      `INSERT INTO affiliate_clicks (id, location_id, affiliate_id, contact_id)
       VALUES ($2,$1,$3,$4)
       RETURNING *`,
      [id, input.affiliateId, input.contactId],
    )
    return rows[0]!
  }

  recentForAffiliate(affiliateId: string, limit = 20): Promise<AffiliateClickWithContact[]> {
    return this.db.query<AffiliateClickWithContact>(
      `SELECT cl.id, cl.clicked_at, cl.contact_id, ct.name AS contact_name
       FROM affiliate_clicks cl
       LEFT JOIN contacts ct ON ct.id = cl.contact_id
       WHERE cl.location_id = $1 AND cl.affiliate_id = $2
       ORDER BY cl.clicked_at DESC
       LIMIT $3`,
      [this.locationId, affiliateId, limit],
    )
  }
}
