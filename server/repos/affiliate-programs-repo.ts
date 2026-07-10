import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface AffiliateProgram {
  id: string
  location_id: string
  name: string
  status: string
  /** 'percent' (commission_value is a percentage) | 'flat' (cents). */
  commission_type: string
  commission_value: number | string
  landing_url: string
  created_at: string
  updated_at: string
}

export interface AffiliateProgramInput {
  name: string
  status?: string
  commissionType?: string
  commissionValue?: number
  landingUrl: string
}

export interface AffiliateProgramPatch {
  name?: string
  status?: string
  commissionType?: string
  commissionValue?: number
  landingUrl?: string
}

/**
 * The referral program for one location: its name, the commission rate every
 * referral is computed against, where a referral link sends a visitor
 * (landing_url), and whether it is active. A location has one program in
 * practice; `getPrimary` returns the newest so the manager opens onto it, and the
 * route shows a setup card when there is none rather than inventing a default.
 *
 * The rate stored here only DRIVES new commissions — each referral locks its own
 * commission_cents at record time (see affiliate-math.commissionCents), so
 * editing the rate here never rewrites what an affiliate was already owed.
 */
export class AffiliateProgramsRepo extends LocationScopedRepo {
  list(): Promise<AffiliateProgram[]> {
    return this.scopedSelect<AffiliateProgram>(
      'SELECT * FROM affiliate_programs ORDER BY created_at DESC',
    )
  }

  /** The location's program (newest if several ever exist), or undefined when the
   *  operator hasn't set one up yet. */
  async getPrimary(): Promise<AffiliateProgram | undefined> {
    const rows = await this.scopedSelect<AffiliateProgram>(
      'SELECT * FROM affiliate_programs ORDER BY created_at DESC LIMIT 1',
    )
    return rows[0]
  }

  async get(id: string): Promise<AffiliateProgram | undefined> {
    const rows = await this.scopedSelect<AffiliateProgram>(
      'SELECT * FROM affiliate_programs WHERE id=$2',
      [id],
    )
    return rows[0]
  }

  async create(input: AffiliateProgramInput): Promise<AffiliateProgram> {
    const id = nanoid()
    const rows = await this.scopedWrite<AffiliateProgram>(
      `INSERT INTO affiliate_programs
         (id, location_id, name, status, commission_type, commission_value, landing_url)
       VALUES ($2,$1,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        id,
        input.name,
        input.status ?? 'active',
        input.commissionType ?? 'percent',
        input.commissionValue ?? 0,
        input.landingUrl,
      ],
    )
    return rows[0]!
  }

  /** Patch the supplied fields only; always refresh updated_at. `scopedWrite`
   *  prepends locationId as $1, so the dynamic params number from $2. */
  async update(id: string, patch: AffiliateProgramPatch): Promise<AffiliateProgram | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.name !== undefined) bind('name', patch.name)
    if (patch.status !== undefined) bind('status', patch.status)
    if (patch.commissionType !== undefined) bind('commission_type', patch.commissionType)
    if (patch.commissionValue !== undefined) bind('commission_value', patch.commissionValue)
    if (patch.landingUrl !== undefined) bind('landing_url', patch.landingUrl)
    if (sets.length === 0) return this.get(id)
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<AffiliateProgram>(
      `UPDATE affiliate_programs SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM affiliate_programs WHERE location_id=$1 AND id=$2', [id])
  }
}
