import type { BadgeProps } from '../../components/ui/badge'
import type { InvoiceItem, InvoiceStatus } from '../../lib/api'

/**
 * Sum of every line (quantity × unit_amount), in cents. This deliberately
 * mirrors the server's `invoiceTotalCents` (server/lib/invoice-math.ts): an
 * invoice's total is ALWAYS derived from its items, never stored, so the figure
 * shown on screen is computed the same way the server computes it and can never
 * drift from the lines that justify it.
 */
export function invoiceTotalCents(items: InvoiceItem[]): number {
  return items.reduce((sum, it) => sum + it.quantity * it.unit_amount, 0)
}

/** How each status reads + colors in the UI. */
export const STATUS_META: Record<InvoiceStatus, { label: string; badge: BadgeProps['variant'] }> = {
  draft: { label: 'Draft', badge: 'slate' },
  sent: { label: 'Sent', badge: 'amber' },
  paid: { label: 'Paid', badge: 'green' },
  void: { label: 'Void', badge: 'outline' },
}

export function statusMeta(status: string): { label: string; badge: BadgeProps['variant'] } {
  return STATUS_META[status as InvoiceStatus] ?? { label: status, badge: 'slate' }
}

/** Payment methods offered when recording a payment (bookkeeping only — none of
 *  these move money; they record how the customer already paid). */
export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'manual', label: 'Other' },
]

/** A due date's human urgency, computed from real dates only. The due date is a
 *  calendar day stored at UTC midnight (operator-picked in a date input), so we
 *  compare its UTC calendar day against the operator's LOCAL today and render it
 *  in UTC — otherwise an Arizona viewer sees "Jun 12" as "Jun 11" and a same-day
 *  invoice mislabels as due tomorrow. */
export function dueLabel(dueAt: string | null): { text: string; overdue: boolean } | null {
  if (!dueAt) return null
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null
  const now = new Date()
  const dueCal = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  const todayCal = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((dueCal - todayCal) / 86_400_000)
  const date = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (days < 0) return { text: `Due ${date}`, overdue: true }
  if (days === 0) return { text: 'Due today', overdue: false }
  if (days === 1) return { text: 'Due tomorrow', overdue: false }
  return { text: `Due ${date}`, overdue: false }
}
