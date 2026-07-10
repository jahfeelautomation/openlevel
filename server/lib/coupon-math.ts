// Pure helpers for Coupons (GHL Payments -> Coupons): normalising a code,
// computing the discount a coupon takes off a total, deciding whether a coupon
// can still be redeemed, and rolling a set of coupons up for the KPI band. Kept
// separate from the repo so the route, the seed and the client all agree on the
// money and the rules. Nothing here charges a card or moves money — a coupon is a
// reusable discount DEFINITION, and applying one only lowers a recorded total.

import { formatPriceCents } from './product-math'

export type DiscountType = 'percent' | 'fixed'
export type CouponStatus = 'active' | 'archived'

/**
 * Canonical form of a redemption code: trimmed, all whitespace removed, upper
 * cased. A code is something a customer types at checkout, so "summer 25" and
 * "SUMMER25" must resolve to the same coupon; normalising on the way in and on
 * every lookup keeps the per-location uniqueness honest and case-insensitive.
 */
export function normalizeCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase()
}

/**
 * The discount a coupon takes off a given total, in whole cents. A percent
 * coupon takes value% of the amount (rounded to the nearest cent); a fixed
 * coupon takes its cent value outright. The result is always clamped to
 * [0, amountCents] so a discount can never exceed the total (no negative total)
 * nor go below zero — a 200%-off bug or a fixed amount larger than the invoice
 * simply zeroes the total, never inverts it.
 */
export function computeDiscount(amountCents: number, type: DiscountType, value: number): number {
  if (amountCents <= 0) return 0
  const raw = type === 'percent' ? Math.round((amountCents * value) / 100) : value
  return Math.max(0, Math.min(raw, amountCents))
}

/** A coupon's redeemability inputs — the fields the rule reads, nothing more. */
export interface RedeemableInput {
  status: string
  expires_at: string | null
  max_redemptions: number | null
  times_redeemed: number
}

/**
 * Whether a coupon can be redeemed at `nowISO`: it must be active, not past its
 * expiry (a null expiry never expires), and not at its redemption cap (a null cap
 * is unlimited). An archived, expired or maxed-out coupon is not redeemable even
 * though it still exists in the list — the manager shows it, it just can't apply.
 */
export function isRedeemable(coupon: RedeemableInput, nowISO: string): boolean {
  if (coupon.status !== 'active') return false
  if (coupon.expires_at !== null && new Date(coupon.expires_at).getTime() <= new Date(nowISO).getTime())
    return false
  if (coupon.max_redemptions !== null && coupon.times_redeemed >= coupon.max_redemptions) return false
  return true
}

/** How a discount reads: "20% off" for percent, "$50.00 off" for a fixed cent
 *  amount. Used by the seed, the route preview and the list row. */
export function discountLabel(type: DiscountType, value: number): string {
  return type === 'percent' ? `${value}% off` : `${formatPriceCents(value)} off`
}

export interface CouponSummary {
  /** Coupons toggled on (status === 'active'), redeemable or not. */
  active: number
  /** Active AND currently usable — not expired, not at its cap. The money-ready headline. */
  redeemable: number
  /** Total times every coupon has been applied (sum of times_redeemed). */
  redemptions: number
  /** Retired coupons (status === 'archived'). */
  archived: number
}

/**
 * Roll a set of coupons up into the KPI band: how many are active, how many of
 * those are actually redeemable right now, the total redemptions across all of
 * them, and how many are archived. An empty book is an honest zero across the
 * board.
 */
export function summarize(
  coupons: Array<RedeemableInput & { times_redeemed: number }>,
  nowISO: string,
): CouponSummary {
  const summary: CouponSummary = { active: 0, redeemable: 0, redemptions: 0, archived: 0 }
  for (const c of coupons) {
    if (c.status === 'active') summary.active += 1
    if (c.status === 'archived') summary.archived += 1
    if (isRedeemable(c, nowISO)) summary.redeemable += 1
    summary.redemptions += c.times_redeemed
  }
  return summary
}
