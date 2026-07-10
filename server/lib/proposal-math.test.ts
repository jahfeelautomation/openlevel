import { formatMoneyCents, proposalTotalCents, readLineItems } from './proposal-math'

test('sums quantity × unit_amount across all lines (cents)', () => {
  expect(
    proposalTotalCents([
      { description: 'Strategy retainer', quantity: 1, unit_amount: 250000 },
      { description: 'Ad spend management', quantity: 2, unit_amount: 75000 },
    ]),
  ).toBe(400000)
})

test('an empty proposal totals zero', () => {
  expect(proposalTotalCents([])).toBe(0)
})

test('respects quantity on a single line', () => {
  expect(proposalTotalCents([{ description: 'Seat', quantity: 5, unit_amount: 4900 }])).toBe(24500)
})

test('readLineItems pulls clean items out of the content jsonb', () => {
  expect(
    readLineItems({
      intro: 'Hello',
      line_items: [{ description: 'Setup', quantity: 1, unit_amount: 150000 }],
      terms: 'Net 30',
    }),
  ).toEqual([{ description: 'Setup', quantity: 1, unit_amount: 150000 }])
})

test('readLineItems returns [] when line_items is missing or not an array', () => {
  expect(readLineItems({})).toEqual([])
  expect(readLineItems({ line_items: 'nope' })).toEqual([])
})

test('readLineItems coerces malformed entries to a safe zero line', () => {
  expect(readLineItems({ line_items: [{ description: 'Half' }, null, { quantity: 'x' }] })).toEqual([
    { description: 'Half', quantity: 0, unit_amount: 0 },
    { description: '', quantity: 0, unit_amount: 0 },
    { description: '', quantity: 0, unit_amount: 0 },
  ])
})

test('readLineItems total agrees with proposalTotalCents end to end', () => {
  const content = {
    line_items: [
      { description: 'A', quantity: 2, unit_amount: 1000 },
      { description: 'B', quantity: 1, unit_amount: 500 },
    ],
  }
  expect(proposalTotalCents(readLineItems(content))).toBe(2500)
})

test('formatMoneyCents renders USD cents as grouped dollars', () => {
  expect(formatMoneyCents(125000)).toBe('$1,250.00')
  expect(formatMoneyCents(0)).toBe('$0.00')
  expect(formatMoneyCents(99999)).toBe('$999.99')
})

test('formatMoneyCents falls back to a plain grouped number for a malformed code', () => {
  // A non-3-letter code makes Intl throw; the fallback keeps the page rendering.
  expect(formatMoneyCents(125000, 'usdd')).toBe('1,250.00 USDD')
})
