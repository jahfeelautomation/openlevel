import type { BadgeProps } from '../../components/ui/badge'

/**
 * Presentation helpers for Payments → Transactions, kept beside the page so the
 * ledger rows, the method filter, and the by-method breakdown all read a payment
 * method the same way. The server normalizes a method to a lowercase key
 * (transaction-math.ts: a blank one becomes "other"); these helpers only turn
 * that key into a human label + a badge color. An unrecognized free-text method
 * is shown verbatim rather than dropped, so the ledger never hides a payment.
 */

/** How each known method reads + colors. Kept deliberately small — these mirror
 *  the methods the record-payment dialog offers; anything else falls through to a
 *  neutral slate badge via {@link methodMeta}. */
const METHOD_META: Record<string, { label: string; badge: BadgeProps['variant'] }> = {
  card: { label: 'Card', badge: 'brand' },
  cash: { label: 'Cash', badge: 'green' },
  bank_transfer: { label: 'Bank transfer', badge: 'blue' },
  check: { label: 'Check', badge: 'amber' },
  manual: { label: 'Manual', badge: 'slate' },
  other: { label: 'Other', badge: 'slate' },
}

/** Title-case a free-text method key for display, e.g. "wire_transfer" →
 *  "Wire transfer", so an unmapped method still reads cleanly. */
function humanizeMethod(method: string): string {
  const spaced = method.replace(/_/g, ' ').trim()
  if (spaced === '') return 'Other'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** The label + badge for a normalized method key. Known methods get their curated
 *  label/color; an unknown one is humanized and shown on a neutral badge — never
 *  hidden. */
export function methodMeta(method: string): { label: string; badge: BadgeProps['variant'] } {
  return METHOD_META[method] ?? { label: humanizeMethod(method), badge: 'slate' }
}

/** Just the display label for a method key (the filter chips and any inline
 *  mention use this). */
export function methodLabel(method: string): string {
  return methodMeta(method).label
}
