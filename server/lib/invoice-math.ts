import type { InvoiceItem } from '../repos/invoices-repo'

/**
 * Sum of every line (quantity × unit_amount), in cents. An invoice's total is
 * ALWAYS derived from its items here — never stored on the row — so the figure
 * shown can never drift from the lines that justify it.
 */
export function invoiceTotalCents(items: InvoiceItem[]): number {
  return items.reduce((sum, it) => sum + it.quantity * it.unit_amount, 0)
}
