import type { BadgeProps } from '../../components/ui/badge'
import type { Product, ProductStatus, RecurringInterval } from '../../lib/api'
import { formatMoneyExact } from '../../lib/utils'

/**
 * Client mirror of the server's product-math helpers (server/lib/product-math.ts):
 * how a catalog price and cadence read, kept here so the list, the editor, and
 * the seed all agree. Money uses the same `formatMoneyExact` as the rest of the
 * Payments UI (2-decimal USD), so a product price reads exactly like an invoice
 * line.
 */

const SUFFIX: Record<RecurringInterval, string> = {
  day: '/day',
  week: '/wk',
  month: '/mo',
  year: '/yr',
}

/** Short price suffix for a billing interval ('/mo', '/yr', …); empty for a
 *  missing cadence so a one-time price stays bare. */
export function intervalSuffix(interval: RecurringInterval | null | undefined): string {
  return interval && interval in SUFFIX ? SUFFIX[interval] : ''
}

const INTERVAL_LABEL: Record<RecurringInterval, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  year: 'Yearly',
}

/** A human cadence label for a billing interval ('month' -> 'Monthly'). Empty
 *  string when there is no recognised interval. */
export function intervalLabel(interval: RecurringInterval | null | undefined): string {
  return interval && interval in INTERVAL_LABEL ? INTERVAL_LABEL[interval] : ''
}

/** The catalog price label: a one-time product reads as a bare "$199.00", a
 *  recurring one appends its cadence ("$2,500.00/mo"). The suffix is only ever
 *  added for a recurring product, so a stray interval on a one-time row never
 *  leaks into the label. */
export function priceLabel(
  product: Pick<Product, 'price_cents' | 'type' | 'recurring_interval'>,
): string {
  const money = formatMoneyExact(product.price_cents)
  if (product.type === 'recurring') return `${money}${intervalSuffix(product.recurring_interval)}`
  return money
}

/** How a product's type reads + colors. A recurring product shows its cadence
 *  ("Monthly") rather than the bare word, so the badge already tells the story. */
export function typeMeta(
  product: Pick<Product, 'type' | 'recurring_interval'>,
): { label: string; badge: BadgeProps['variant'] } {
  if (product.type === 'recurring') {
    return { label: intervalLabel(product.recurring_interval) || 'Recurring', badge: 'blue' }
  }
  return { label: 'One-time', badge: 'slate' }
}

/** How each catalog status reads + colors. Archived is muted on purpose — it is
 *  retired from the active picker but kept for history. */
export const STATUS_META: Record<ProductStatus, { label: string; badge: BadgeProps['variant'] }> = {
  active: { label: 'Active', badge: 'green' },
  archived: { label: 'Archived', badge: 'outline' },
}

export function statusMeta(status: string): { label: string; badge: BadgeProps['variant'] } {
  return STATUS_META[status as ProductStatus] ?? { label: status, badge: 'slate' }
}

/** Billing cadence options offered in the editor when a product is recurring. */
export const INTERVAL_OPTIONS: { value: RecurringInterval; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
]
