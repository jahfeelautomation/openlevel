import { formatPriceCents, intervalLabel, intervalSuffix, priceLabel } from './product-math'

test('formatPriceCents renders USD cents as grouped dollars', () => {
  expect(formatPriceCents(125000)).toBe('$1,250.00')
  expect(formatPriceCents(0)).toBe('$0.00')
  expect(formatPriceCents(99999)).toBe('$999.99')
})

test('formatPriceCents falls back to a plain grouped number for a malformed code', () => {
  // A non-3-letter code makes Intl throw; the fallback keeps the page rendering.
  expect(formatPriceCents(125000, 'usdd')).toBe('1,250.00 USDD')
})

test('intervalSuffix maps each interval to its short price suffix', () => {
  expect(intervalSuffix('day')).toBe('/day')
  expect(intervalSuffix('week')).toBe('/wk')
  expect(intervalSuffix('month')).toBe('/mo')
  expect(intervalSuffix('year')).toBe('/yr')
})

test('intervalSuffix is empty for a missing or unknown interval', () => {
  expect(intervalSuffix(null)).toBe('')
  expect(intervalSuffix(undefined)).toBe('')
  expect(intervalSuffix('fortnight')).toBe('')
})

test('intervalLabel humanises each interval', () => {
  expect(intervalLabel('day')).toBe('Daily')
  expect(intervalLabel('week')).toBe('Weekly')
  expect(intervalLabel('month')).toBe('Monthly')
  expect(intervalLabel('year')).toBe('Yearly')
  expect(intervalLabel(null)).toBe('')
})

test('priceLabel shows a bare amount for a one-time product', () => {
  expect(priceLabel({ price_cents: 19900, type: 'one_time' })).toBe('$199.00')
})

test('priceLabel appends the cadence suffix for a recurring product', () => {
  expect(priceLabel({ price_cents: 250000, type: 'recurring', recurring_interval: 'month' })).toBe(
    '$2,500.00/mo',
  )
  expect(priceLabel({ price_cents: 120000, type: 'recurring', recurring_interval: 'year' })).toBe(
    '$1,200.00/yr',
  )
})

test('priceLabel never adds a suffix to a one-time product even if an interval lingers', () => {
  expect(
    priceLabel({ price_cents: 5000, type: 'one_time', recurring_interval: 'month' }),
  ).toBe('$50.00')
})

test('priceLabel defaults the currency to USD', () => {
  expect(priceLabel({ price_cents: 1000 })).toBe('$10.00')
})
