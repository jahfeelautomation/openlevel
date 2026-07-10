import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Affiliate {
  id: string
  location_id: string
  program_id: string
  contact_id: string | null
  name: string
  email: string | null
  code: string
  status: string
  created_at: string
  updated_at: string
}

/** An affiliate with stats DERIVED from its real click + referral rows (never stored). */
export interface AffiliateWithStats extends Affiliate {
  clicks: number
  referrals: number
  sales_volume_cents: number
  commission_cents: number
  /** Approved & unpaid commission — what a payout would settle right now. */
  commission_approved_cents: number
  commission_paid_cents: number
}

export interface AffiliateInput {
  programId: string
  name: string
  email?: string | null
  code: string
  contactId?: string | null
}

export interface AffiliatePatch {
  name?: string
  email?: string | null
  code?: string
  status?: string
  contactId?: string | null
}

/**
 * The people promoting a location's program. Each has a unique referral `code`
 * (the public route resolves /ref/:loc/:code), an optional linked contact, and a
 * status the operator controls.
 *
 * The numbers an affiliate reports — clicks, referrals, sales volume, commission
 * earned, commission paid — are NOT columns. `listWithStats` / `getWithStats`
 * DERIVE them so a figure can never drift from the rows that justify it and a
 * brand-new affiliate is an honest zero. The subtlety: an affiliate has TWO child
 * tables (clicks AND referrals). LEFT JOINing both with GROUP BY would multiply
 * rows — a cartesian fan-out that double-counts every figure. So each metric is a
 * CORRELATED SCALAR SUBQUERY over exactly one child table, filtered by
 * affiliate_id — no fan-out, each count honest. Those queries don't fit the
 * base-repo regex rewrite (they reference a.location_id), so they call db.query
 * directly while still passing this.locationId as $1 and filtering on it by hand.
 */
export class AffiliatesRepo extends LocationScopedRepo {
  /** Bare rows for one program (or all), newest first — no stats. */
  list(programId?: string): Promise<Affiliate[]> {
    if (programId) {
      return this.scopedSelect<Affiliate>(
        'SELECT * FROM affiliates WHERE program_id=$2 ORDER BY created_at DESC',
        [programId],
      )
    }
    return this.scopedSelect<Affiliate>('SELECT * FROM affiliates ORDER BY created_at DESC')
  }

  /**
   * Every affiliate (optionally one program's) with its derived stats, newest
   * first. Each stat is a correlated subquery over a single child table, so the
   * two child tables never fan out against each other.
   */
  listWithStats(programId?: string): Promise<AffiliateWithStats[]> {
    const params: unknown[] = [this.locationId]
    let programFilter = ''
    if (programId) {
      params.push(programId)
      programFilter = ` AND a.program_id = $${params.length}`
    }
    return this.db.query<AffiliateWithStats>(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM affiliate_clicks ac WHERE ac.affiliate_id = a.id) AS clicks,
              (SELECT COUNT(*)::int FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) AS referrals,
              (SELECT COALESCE(SUM(ar.amount_cents),0)::bigint FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) AS sales_volume_cents,
              (SELECT COALESCE(SUM(ar.commission_cents),0)::bigint FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) AS commission_cents,
              (SELECT COALESCE(SUM(ar.commission_cents),0)::bigint FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id AND ar.status = 'approved') AS commission_approved_cents,
              (SELECT COALESCE(SUM(ar.commission_cents),0)::bigint FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id AND ar.status = 'paid') AS commission_paid_cents
       FROM affiliates a
       WHERE a.location_id = $1${programFilter}
       ORDER BY a.created_at DESC`,
      params,
    )
  }

  async get(id: string): Promise<Affiliate | undefined> {
    const rows = await this.scopedSelect<Affiliate>('SELECT * FROM affiliates WHERE id=$2', [id])
    return rows[0]
  }

  async getWithStats(id: string): Promise<AffiliateWithStats | undefined> {
    const rows = await this.db.query<AffiliateWithStats>(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM affiliate_clicks ac WHERE ac.affiliate_id = a.id) AS clicks,
              (SELECT COUNT(*)::int FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) AS referrals,
              (SELECT COALESCE(SUM(ar.amount_cents),0)::bigint FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) AS sales_volume_cents,
              (SELECT COALESCE(SUM(ar.commission_cents),0)::bigint FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) AS commission_cents,
              (SELECT COALESCE(SUM(ar.commission_cents),0)::bigint FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id AND ar.status = 'approved') AS commission_approved_cents,
              (SELECT COALESCE(SUM(ar.commission_cents),0)::bigint FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id AND ar.status = 'paid') AS commission_paid_cents
       FROM affiliates a
       WHERE a.location_id = $1 AND a.id = $2`,
      [this.locationId, id],
    )
    return rows[0]
  }

  /** Resolve a public referral code to its affiliate (the redirect route's lookup). */
  async getByCode(code: string): Promise<Affiliate | undefined> {
    const rows = await this.scopedSelect<Affiliate>('SELECT * FROM affiliates WHERE code=$2', [code])
    return rows[0]
  }

  async create(input: AffiliateInput): Promise<Affiliate> {
    const id = nanoid()
    const rows = await this.scopedWrite<Affiliate>(
      `INSERT INTO affiliates (id, location_id, program_id, contact_id, name, email, code)
       VALUES ($2,$1,$3,$4,$5,$6,$7)
       RETURNING *`,
      [id, input.programId, input.contactId ?? null, input.name, input.email ?? null, input.code],
    )
    return rows[0]!
  }

  /** Patch the supplied fields only; always refresh updated_at. `scopedWrite`
   *  prepends locationId as $1, so the dynamic params number from $2. */
  async update(id: string, patch: AffiliatePatch): Promise<Affiliate | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.name !== undefined) bind('name', patch.name)
    if (patch.email !== undefined) bind('email', patch.email)
    if (patch.code !== undefined) bind('code', patch.code)
    if (patch.status !== undefined) bind('status', patch.status)
    if (patch.contactId !== undefined) bind('contact_id', patch.contactId)
    if (sets.length === 0) return this.get(id)
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<Affiliate>(
      `UPDATE affiliates SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM affiliates WHERE location_id=$1 AND id=$2', [id])
  }
}
