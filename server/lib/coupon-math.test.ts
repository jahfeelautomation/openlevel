import {
  computeDiscount,
  discountLabel,
  isRedeemable,
  normalizeCode,
  summarize,
} from './coupon-math'

test('normalizeCode strips whitespace and uppercases', () => {
  expect(normalizeCode('summer25')).toBe('SUMMER25')
  expect(normalizeCode('  spring sale  ')).toBe('SPRINGSALE')
  expect(normalizeCode('Save10')).toBe('SAVE10')
})

test('computeDiscount takes a rounded percent of the total', () => {
  expect(computeDiscount(125_000, 'percent', 20)).toBe(25_000)
  expect(computeDiscount(9_999, 'percent', 10)).toBe(1_000) // 999.9 -> 1000
})

test('computeDiscount takes a fixed cent amount outright', () => {
  expect(computeDiscount(125_000, 'fixed', 5_000)).toBe(5_000)
})

test('computeDiscount clamps a discount larger than the total down to the total', () => {
  expect(computeDiscount(4_000, 'fixed', 5_000)).toBe(4_000) // never below zero total
  expect(computeDiscount(4_000, 'percent', 150)).toBe(4_000) // a 150%-off bug zeroes, not inverts
})

test('computeDiscount is zero on a zero or negative total', () => {
  expect(computeDiscount(0, 'percent', 20)).toBe(0)
  expect(computeDiscount(-100, 'fixed', 50)).toBe(0)
})

test('computeDiscount never returns a negative discount', () => {
  expect(computeDiscount(10_000, 'fixed', -500)).toBe(0)
  expect(computeDiscount(10_000, 'percent', -10)).toBe(0)
})

const base = {
  status: 'active',
  expires_at: null as string | null,
  max_redemptions: null as number | null,
  times_redeemed: 0,
}
const NOW = '2026-06-04T00:00:00.000Z'

test('isRedeemable is true for an active coupon with no limits', () => {
  expect(isRedeemable(base, NOW)).toBe(true)
})

test('isRedeemable is false for an archived coupon', () => {
  expect(isRedeemable({ ...base, status: 'archived' }, NOW)).toBe(false)
})

test('isRedeemable is false once past the expiry', () => {
  expect(isRedeemable({ ...base, expires_at: '2026-06-03T00:00:00.000Z' }, NOW)).toBe(false)
  // exactly at expiry counts as expired (not strictly before now)
  expect(isRedeemable({ ...base, expires_at: NOW }, NOW)).toBe(false)
})

test('isRedeemable is true before the expiry', () => {
  expect(isRedeemable({ ...base, expires_at: '2026-12-31T00:00:00.000Z' }, NOW)).toBe(true)
})

test('isRedeemable is false at or over the redemption cap', () => {
  expect(isRedeemable({ ...base, max_redemptions: 100, times_redeemed: 100 }, NOW)).toBe(false)
  expect(isRedeemable({ ...base, max_redemptions: 100, times_redeemed: 101 }, NOW)).toBe(false)
})

test('isRedeemable is true under the redemption cap', () => {
  expect(isRedeemable({ ...base, max_redemptions: 100, times_redeemed: 99 }, NOW)).toBe(true)
})

test('discountLabel reads percent and fixed', () => {
  expect(discountLabel('percent', 20)).toBe('20% off')
  expect(discountLabel('fixed', 5_000)).toBe('$50.00 off')
})

test('summarize counts active, redeemable, redemptions and archived', () => {
  const out = summarize(
    [
      { ...base, status: 'active', times_redeemed: 3 }, // redeemable
      { ...base, status: 'active', expires_at: '2026-06-01T00:00:00.000Z', times_redeemed: 5 }, // active but expired
      { ...base, status: 'active', max_redemptions: 2, times_redeemed: 2 }, // active but maxed
      { ...base, status: 'archived', times_redeemed: 10 }, // archived
    ],
    NOW,
  )
  expect(out).toEqual({ active: 3, redeemable: 1, redemptions: 20, archived: 1 })
})

test('summarize is an honest zero for an empty book', () => {
  expect(summarize([], NOW)).toEqual({ active: 0, redeemable: 0, redemptions: 0, archived: 0 })
})
