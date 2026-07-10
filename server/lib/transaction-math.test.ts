import {
  type Transaction,
  normalizeMethod,
  summarizeTransactions,
  toTransaction,
} from './transaction-math'

// A small factory so the summarize tests read clearly: only the fields a summary
// looks at (amount, method, paid_at) need to vary per case.
function txn(over: Partial<Transaction>): Transaction {
  return {
    invoice_id: 'inv1',
    invoice_number: 'INV-1001',
    contact_id: 'c1',
    amount_cents: 10_000,
    currency: 'usd',
    method: 'card',
    paid_at: '2026-06-10T00:00:00Z',
    ...over,
  }
}

describe('normalizeMethod', () => {
  test('coalesces null / empty / whitespace to "other"', () => {
    expect(normalizeMethod(null)).toBe('other')
    expect(normalizeMethod(undefined)).toBe('other')
    expect(normalizeMethod('')).toBe('other')
    expect(normalizeMethod('   ')).toBe('other')
  })

  test('trims and lowercases a real method', () => {
    expect(normalizeMethod('  Card ')).toBe('card')
    expect(normalizeMethod('bank_transfer')).toBe('bank_transfer')
    expect(normalizeMethod('CHECK')).toBe('check')
  })
})

describe('toTransaction', () => {
  test('derives the amount from the invoice line items (never a stored figure)', () => {
    const t = toTransaction({
      id: 'inv9',
      number: 'INV-1009',
      contact_id: 'c7',
      items: [
        { description: 'Inspection', quantity: 2, unit_amount: 25_000 },
        { description: 'Travel', quantity: 1, unit_amount: 1_500 },
      ],
      currency: 'usd',
      payment_method: 'card',
      paid_at: '2026-06-02T00:00:00Z',
    })
    expect(t.amount_cents).toBe(51_500) // 2*25000 + 1500, derived
    expect(t.invoice_id).toBe('inv9')
    expect(t.invoice_number).toBe('INV-1009')
    expect(t.contact_id).toBe('c7')
    expect(t.currency).toBe('usd')
    expect(t.method).toBe('card')
    expect(t.paid_at).toBe('2026-06-02T00:00:00Z')
  })

  test('normalizes a missing payment method to "other" and keeps a null contact', () => {
    const t = toTransaction({
      id: 'inv10',
      number: 'INV-1010',
      contact_id: null,
      items: [{ description: 'Deposit', quantity: 1, unit_amount: 5_000 }],
      currency: 'usd',
      payment_method: null,
      paid_at: '2026-06-03T00:00:00Z',
    })
    expect(t.method).toBe('other')
    expect(t.contact_id).toBeNull()
    expect(t.amount_cents).toBe(5_000)
  })
})

describe('summarizeTransactions', () => {
  const now = '2026-06-15T12:00:00Z'

  test('an empty ledger is an honest all-zero', () => {
    expect(summarizeTransactions([], now)).toEqual({
      count: 0,
      grossCents: 0,
      thisMonthCents: 0,
      byMethod: [],
    })
  })

  test('counts rows and sums the gross collected across every transaction', () => {
    const s = summarizeTransactions(
      [txn({ amount_cents: 10_000 }), txn({ amount_cents: 15_000 }), txn({ amount_cents: 500 })],
      now,
    )
    expect(s.count).toBe(3)
    expect(s.grossCents).toBe(25_500)
  })

  test('thisMonthCents includes only payments recorded in the current month', () => {
    const s = summarizeTransactions(
      [
        txn({ amount_cents: 10_000, paid_at: '2026-06-01T00:00:00Z' }), // this month
        txn({ amount_cents: 7_000, paid_at: '2026-06-15T09:00:00Z' }), // this month
        txn({ amount_cents: 9_999, paid_at: '2026-05-31T23:59:00Z' }), // last month - excluded
        txn({ amount_cents: 4_000, paid_at: '2026-07-01T00:00:00Z' }), // next month - excluded
      ],
      now,
    )
    expect(s.grossCents).toBe(30_999) // all four count toward all-time gross
    expect(s.thisMonthCents).toBe(17_000) // only the two June rows
  })

  test('byMethod groups by method with a count and cent total', () => {
    const s = summarizeTransactions(
      [
        txn({ method: 'card', amount_cents: 10_000 }),
        txn({ method: 'card', amount_cents: 5_000 }),
        txn({ method: 'cash', amount_cents: 2_000 }),
      ],
      now,
    )
    expect(s.byMethod).toEqual([
      { method: 'card', count: 2, cents: 15_000 },
      { method: 'cash', count: 1, cents: 2_000 },
    ])
  })

  test('byMethod sorts by cents desc, then method name asc on a tie', () => {
    const s = summarizeTransactions(
      [
        txn({ method: 'cash', amount_cents: 5_000 }),
        txn({ method: 'card', amount_cents: 5_000 }),
        txn({ method: 'check', amount_cents: 9_000 }),
      ],
      now,
    )
    expect(s.byMethod.map((m) => m.method)).toEqual(['check', 'card', 'cash'])
  })
})
