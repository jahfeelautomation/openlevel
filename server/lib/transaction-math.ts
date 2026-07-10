import type { InvoiceItem } from '../repos/invoices-repo'
import { invoiceTotalCents } from './invoice-math'

/**
 * The Transactions ledger is a DERIVED read model, not a second store of money.
 * A paid invoice IS a recorded transaction: OpenLevel never charges a card, so
 * the only payments that exist are the ones an operator wrote down on an invoice
 * via record-payment. This module maps those paid invoices to ledger rows and
 * rolls them up — every figure traces straight back to an invoice's line items,
 * so the ledger can never show a dollar the invoices don't justify.
 */

/** One recorded payment, projected from the invoice it settled. `amount_cents`
 *  is always derived from the invoice line items, never a stored total. */
export interface Transaction {
  invoice_id: string
  invoice_number: string
  contact_id: string | null
  amount_cents: number
  currency: string
  method: string
  paid_at: string
}

/** The shape the projection needs off a paid invoice row. */
export interface PaidInvoice {
  id: string
  number: string
  contact_id: string | null
  items: InvoiceItem[]
  currency: string
  payment_method: string | null
  paid_at: string
}

export interface MethodTotal {
  method: string
  count: number
  cents: number
}

export interface TransactionSummary {
  count: number
  grossCents: number
  thisMonthCents: number
  byMethod: MethodTotal[]
}

/** Fold a free-text payment method into a stable grouping key: a real method is
 *  trimmed + lowercased, anything blank becomes "other" so an unlabeled payment
 *  is grouped honestly rather than dropped. */
export function normalizeMethod(method: string | null | undefined): string {
  const m = (method ?? '').trim()
  return m === '' ? 'other' : m.toLowerCase()
}

/** Project a paid invoice into a ledger transaction. The amount is derived from
 *  the invoice items here, the same way the invoice total is computed everywhere. */
export function toTransaction(inv: PaidInvoice): Transaction {
  return {
    invoice_id: inv.id,
    invoice_number: inv.number,
    contact_id: inv.contact_id,
    amount_cents: invoiceTotalCents(inv.items),
    currency: inv.currency,
    method: normalizeMethod(inv.payment_method),
    paid_at: inv.paid_at,
  }
}

/** Roll up a ledger: row count, all-time gross collected, the slice recorded in
 *  the current (UTC) month, and a per-method breakdown sorted biggest-first. */
export function summarizeTransactions(
  txns: Transaction[],
  nowISO: string,
): TransactionSummary {
  const now = new Date(nowISO)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  let grossCents = 0
  let thisMonthCents = 0
  const byMethodMap = new Map<string, MethodTotal>()

  for (const t of txns) {
    grossCents += t.amount_cents
    const paid = new Date(t.paid_at)
    if (paid.getUTCFullYear() === year && paid.getUTCMonth() === month) {
      thisMonthCents += t.amount_cents
    }
    const existing = byMethodMap.get(t.method) ?? { method: t.method, count: 0, cents: 0 }
    existing.count += 1
    existing.cents += t.amount_cents
    byMethodMap.set(t.method, existing)
  }

  const byMethod = [...byMethodMap.values()].sort(
    (a, b) => b.cents - a.cents || a.method.localeCompare(b.method),
  )

  return { count: txns.length, grossCents, thisMonthCents, byMethod }
}
