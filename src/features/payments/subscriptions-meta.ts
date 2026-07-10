import type { BadgeProps } from '../../components/ui/badge'
import type { RecurringInterval, SubscriptionStatus } from '../../lib/api'
import { formatMoneyExact } from '../../lib/utils'
import { intervalSuffix } from './products-meta'

/**
 * Presentation helpers for Payments → Subscriptions, kept beside the page so the
 * list and the KPI band agree. A subscription is always recurring, so its amount
 * reads with the same cadence suffix as a recurring catalog product and uses the
 * same `formatMoneyExact` (2-decimal USD) the rest of Payments uses.
 */

/** The amount label for a subscription: its snapshotted amount plus the billing
 *  cadence suffix, e.g. "$1,250.00/mo". Mirrors the catalog priceLabel, but reads
 *  off a subscription's own amount_cents + billing_interval. */
export function subscriptionAmountLabel(sub: {
  amount_cents: number
  billing_interval: RecurringInterval
}): string {
  return `${formatMoneyExact(sub.amount_cents)}${intervalSuffix(sub.billing_interval)}`
}

/** How each subscription status reads + colors. Active is the live green, paused
 *  an amber "on hold", canceled a muted, retired slate. */
export const SUBSCRIPTION_STATUS_META: Record<
  SubscriptionStatus,
  { label: string; badge: BadgeProps['variant'] }
> = {
  active: { label: 'Active', badge: 'green' },
  paused: { label: 'Paused', badge: 'amber' },
  canceled: { label: 'Canceled', badge: 'outline' },
}

export function subscriptionStatusMeta(status: string): {
  label: string
  badge: BadgeProps['variant']
} {
  return SUBSCRIPTION_STATUS_META[status as SubscriptionStatus] ?? { label: status, badge: 'slate' }
}
