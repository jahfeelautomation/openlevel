import type { BadgeProps } from '../../components/ui/badge'
import type { Coupon, CouponStatus, DiscountType } from '../../lib/api'
import { formatMoneyExact } from '../../lib/utils'

/**
 * Presentation helpers for Payments → Coupons, kept beside the page so the list
 * and the KPI band agree. A coupon's discount reads the same way everywhere: a
 * percent as "25% off", a fixed amount as "$50.00 off" using the same
 * `formatMoneyExact` (2-decimal USD) the rest of Payments uses.
 */

/** The discount label for a coupon: "25% off" for a percent, "$50.00 off" for a
 *  fixed cent amount. Reads off the row's own discount_type + discount_value. */
export function couponDiscountLabel(coupon: {
  discount_type: DiscountType
  discount_value: number
}): string {
  return coupon.discount_type === 'percent'
    ? `${coupon.discount_value}% off`
    : `${formatMoneyExact(coupon.discount_value)} off`
}

/** How each coupon status reads + colors. Active is the live green; archived a
 *  muted outline — kept on the books for the record, just not offered any more. */
export const COUPON_STATUS_META: Record<
  CouponStatus,
  { label: string; badge: BadgeProps['variant'] }
> = {
  active: { label: 'Active', badge: 'green' },
  archived: { label: 'Archived', badge: 'outline' },
}

export function couponStatusMeta(status: string): {
  label: string
  badge: BadgeProps['variant']
} {
  return COUPON_STATUS_META[status as CouponStatus] ?? { label: status, badge: 'slate' }
}

/**
 * The honest reason an ACTIVE coupon still cannot be redeemed right now, or null
 * when nothing is blocking it. The server owns the `redeemable` boolean; this only
 * phrases the WHY so a row can read "Active" yet show "Expired" / "Limit reached"
 * beside it — the green badge never silently contradicts the derived flag. Mirrors
 * the server's isRedeemable check (coupon-math.ts) for presentation only.
 */
export function couponBlockReason(coupon: Coupon, nowISO: string): string | null {
  if (coupon.status !== 'active') return null
  const now = new Date(nowISO).getTime()
  if (coupon.expires_at !== null && new Date(coupon.expires_at).getTime() <= now) {
    return 'Expired'
  }
  if (coupon.max_redemptions !== null && coupon.times_redeemed >= coupon.max_redemptions) {
    return 'Limit reached'
  }
  return null
}

/** The redemption-count label: "14 redeemed" when unlimited, "9 / 100 used" when a
 *  cap is set, so the row shows usage against its ceiling honestly. */
export function couponUsageLabel(coupon: { times_redeemed: number; max_redemptions: number | null }): string {
  return coupon.max_redemptions === null
    ? `${coupon.times_redeemed} redeemed`
    : `${coupon.times_redeemed} / ${coupon.max_redemptions} used`
}
