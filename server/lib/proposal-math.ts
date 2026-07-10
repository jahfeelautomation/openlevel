import type { ProposalItem } from '../repos/proposals-repo'

/**
 * Sum of every line (quantity × unit_amount), in cents. A proposal's total is
 * ALWAYS derived here from its line items — never stored on the row — so the
 * amount the client signs for can never drift from the lines that justify it.
 */
export function proposalTotalCents(items: ProposalItem[]): number {
  return items.reduce((sum, it) => sum + it.quantity * it.unit_amount, 0)
}

/**
 * Normalise the loosely-typed `content.line_items` jsonb into clean
 * ProposalItem[]. The operator UI, the public SSR page, and the server-side
 * validator all read line items through this one function, so they always agree
 * on what the lines are. Anything malformed collapses to a safe zero line rather
 * than throwing — a half-built draft must still render.
 */
export function readLineItems(content: Record<string, unknown>): ProposalItem[] {
  const raw = (content as { line_items?: unknown }).line_items
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const it = (entry ?? {}) as Partial<ProposalItem>
    return {
      description: typeof it.description === 'string' ? it.description : '',
      quantity: Number.isFinite(it.quantity) ? Number(it.quantity) : 0,
      unit_amount: Number.isFinite(it.unit_amount) ? Number(it.unit_amount) : 0,
    }
  })
}

/**
 * Format an integer cent amount as human money, e.g. 125000 -> "$1,250.00". Pure
 * and locale-stable (en-US) so the server-rendered public proposal and the
 * operator UI show the exact same string. Falls back to a plain grouped number
 * with the upper-cased code if the currency isn't a valid ISO code.
 */
export function formatMoneyCents(cents: number, currency = 'usd'): string {
  const dollars = cents / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(dollars)
  } catch {
    const body = dollars.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return `${body} ${currency.toUpperCase()}`
  }
}
