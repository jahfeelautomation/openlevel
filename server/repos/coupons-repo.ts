import { nanoid } from 'nanoid'
import { type DiscountType, normalizeCode } from '../lib/coupon-math'
import { LocationScopedRepo } from './base-repo'

export interface Coupon {
  id: string
  location_id: string
  code: string
  description: string | null
  discount_type: DiscountType
  /** Whole percent (1..100) for a percent coupon, or integer cents for a fixed one. */
  discount_value: number
  status: 'active' | 'archived'
  /** Max times the coupon may be applied; null is unlimited. */
  max_redemptions: number | null
  /** Honest running counter, only ever moved by incrementRedeemed. */
  times_redeemed: number
  /** Optional cutoff ISO; null never expires. */
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface CouponInput {
  code: string
  description?: string | null
  discountType?: DiscountType
  discountValue: number
  maxRedemptions?: number | null
  expiresAt?: string | null
}

export interface CouponPatch {
  code?: string
  description?: string | null
  discountType?: DiscountType
  discountValue?: number
  status?: 'active' | 'archived'
  maxRedemptions?: number | null
  expiresAt?: string | null
}

/**
 * Coupons for one location — the reusable discount codes a later module applies
 * to an invoice total. The tenancy invariant comes from LocationScopedRepo: every
 * read is scoped to `location_id = $1` and every write sets it explicitly. A
 * coupon always begins `active` with `times_redeemed = 0` (DB defaults); the
 * `code` is normalised on the way in (and on every lookup) so per-location
 * uniqueness is case-insensitive. Nothing here charges a card — a coupon is a
 * definition, and `incrementRedeemed` only advances the honest usage counter when
 * the code is actually applied.
 */
export class CouponsRepo extends LocationScopedRepo {
  /** Every coupon for the location, newest first. */
  list(): Promise<Coupon[]> {
    return this.scopedSelect<Coupon>('SELECT * FROM coupons ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Coupon | undefined> {
    const rows = await this.scopedSelect<Coupon>('SELECT * FROM coupons WHERE id=$2', [id])
    return rows[0]
  }

  /** Resolve a redemption code (case-insensitive) to its coupon within the location. */
  async getByCode(code: string): Promise<Coupon | undefined> {
    const rows = await this.scopedSelect<Coupon>('SELECT * FROM coupons WHERE code=$2', [
      normalizeCode(code),
    ])
    return rows[0]
  }

  async create(input: CouponInput): Promise<Coupon> {
    const id = nanoid()
    const rows = await this.scopedWrite<Coupon>(
      `INSERT INTO coupons
         (id, location_id, code, description, discount_type, discount_value, max_redemptions, expires_at)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        id,
        normalizeCode(input.code),
        input.description ?? null,
        input.discountType ?? 'percent',
        input.discountValue,
        input.maxRedemptions ?? null,
        input.expiresAt ?? null,
      ],
    )
    return rows[0]!
  }

  /** Patch the supplied fields only; always refresh updated_at. `scopedWrite`
   *  prepends locationId as $1, so the dynamic params number from $2. A patched
   *  code is normalised so uniqueness stays case-insensitive. */
  async update(id: string, patch: CouponPatch): Promise<Coupon | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.code !== undefined) bind('code', normalizeCode(patch.code))
    if (patch.description !== undefined) bind('description', patch.description)
    if (patch.discountType !== undefined) bind('discount_type', patch.discountType)
    if (patch.discountValue !== undefined) bind('discount_value', patch.discountValue)
    if (patch.status !== undefined) bind('status', patch.status)
    if (patch.maxRedemptions !== undefined) bind('max_redemptions', patch.maxRedemptions)
    if (patch.expiresAt !== undefined) bind('expires_at', patch.expiresAt)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<Coupon>(
      `UPDATE coupons SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  /** Advance the honest redemption counter by one (when the code is applied). */
  async incrementRedeemed(id: string): Promise<Coupon | undefined> {
    const rows = await this.scopedWrite<Coupon>(
      `UPDATE coupons SET times_redeemed = times_redeemed + 1, updated_at=now()
       WHERE location_id=$1 AND id=$2 RETURNING *`,
      [id],
    )
    return rows[0]
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.scopedWrite<{ id: string }>(
      'DELETE FROM coupons WHERE location_id=$1 AND id=$2 RETURNING id',
      [id],
    )
    return rows.length > 0
  }
}
