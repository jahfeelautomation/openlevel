import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface AffiliateReferral {
  id: string
  location_id: string
  affiliate_id: string
  contact_id: string | null
  description: string | null
  amount_cents: number | string
  commission_cents: number | string
  status: string
  occurred_at: string
  paid_at: string | null
  created_at: string
}

/** A referral joined to the referred contact's name (null = no linked contact). */
export interface AffiliateReferralWithContact extends AffiliateReferral {
  contact_name: string | null
}

export interface AffiliateReferralInput {
  affiliateId: string
  contactId?: string | null
  description?: string | null
  amountCents: number
  /** The commission LOCKED at record time (computed by affiliate-math.commissionCents). */
  commissionCents: number
  status?: string
  occurredAt?: string
}

/**
 * The recorded sales an affiliate drove — the rows every commission figure is
 * summed from. Two honesty rules live here:
 *
 *  1. `commission_cents` is LOCKED on the row at creation (the route computes it
 *     from the program rate via affiliate-math.commissionCents and passes it in),
 *     so editing the program rate later never rewrites what was already owed.
 *  2. `markApprovedPaid` is the payout operation, and it is BOOKKEEPING ONLY: it
 *     flips this location's APPROVED referrals for one affiliate to status='paid'
 *     and stamps paid_at. Pending referrals are untouched — they await the
 *     operator's review and only become payable once approved (the GHL
 *     pending → approved → paid lifecycle). It moves no money — it records that
 *     the operator paid out of band, exactly like an invoice's "record payment".
 */
export class AffiliateReferralsRepo extends LocationScopedRepo {
  listForAffiliate(affiliateId: string, limit = 100): Promise<AffiliateReferralWithContact[]> {
    return this.db.query<AffiliateReferralWithContact>(
      `SELECT r.*, ct.name AS contact_name
       FROM affiliate_referrals r
       LEFT JOIN contacts ct ON ct.id = r.contact_id
       WHERE r.location_id = $1 AND r.affiliate_id = $2
       ORDER BY r.occurred_at DESC
       LIMIT $3`,
      [this.locationId, affiliateId, limit],
    )
  }

  async get(id: string): Promise<AffiliateReferral | undefined> {
    const rows = await this.scopedSelect<AffiliateReferral>(
      'SELECT * FROM affiliate_referrals WHERE id=$2',
      [id],
    )
    return rows[0]
  }

  async create(input: AffiliateReferralInput): Promise<AffiliateReferral> {
    const id = nanoid()
    const rows = await this.scopedWrite<AffiliateReferral>(
      `INSERT INTO affiliate_referrals
         (id, location_id, affiliate_id, contact_id, description, amount_cents, commission_cents, status, occurred_at)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8, COALESCE($9, now()))
       RETURNING *`,
      [
        id,
        input.affiliateId,
        input.contactId ?? null,
        input.description ?? null,
        input.amountCents,
        input.commissionCents,
        input.status ?? 'pending',
        input.occurredAt ?? null,
      ],
    )
    return rows[0]!
  }

  /**
   * Set one referral's status. Moving to 'paid' stamps paid_at now; moving away
   * from 'paid' clears it — so paid_at and status never disagree.
   */
  async setStatus(id: string, status: string): Promise<AffiliateReferral | undefined> {
    const paidAtExpr = status === 'paid' ? 'now()' : 'NULL'
    const rows = await this.scopedWrite<AffiliateReferral>(
      `UPDATE affiliate_referrals
       SET status=$2, paid_at=${paidAtExpr}
       WHERE location_id=$1 AND id=$3
       RETURNING *`,
      [status, id],
    )
    return rows[0]
  }

  /**
   * Record a payout: mark every APPROVED referral for one affiliate as paid and
   * stamp paid_at. Pending rows stay pending — a payout never settles commission
   * the operator hasn't reviewed. BOOKKEEPING ONLY — moves no money. Returns the
   * rows it settled so the route can report how much was just marked paid.
   */
  markApprovedPaid(affiliateId: string): Promise<AffiliateReferral[]> {
    return this.scopedWrite<AffiliateReferral>(
      `UPDATE affiliate_referrals
       SET status='paid', paid_at=now()
       WHERE location_id=$1 AND affiliate_id=$2 AND status = 'approved'
       RETURNING *`,
      [affiliateId],
    )
  }
}
