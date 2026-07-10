import { invoiceTotalCents } from './invoice-math'

test('sums quantity × unit_amount across all lines (cents)', () => {
  expect(
    invoiceTotalCents([
      { description: 'Inspection', quantity: 1, unit_amount: 25000 },
      { description: 'Travel', quantity: 2, unit_amount: 1500 },
    ]),
  ).toBe(28000)
})

test('an empty invoice totals zero', () => {
  expect(invoiceTotalCents([])).toBe(0)
})

test('respects quantity on a single line', () => {
  expect(invoiceTotalCents([{ description: 'Hour', quantity: 3, unit_amount: 12000 }])).toBe(36000)
})
