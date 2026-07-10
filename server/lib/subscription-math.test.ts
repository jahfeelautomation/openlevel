import {
  addInterval,
  monthlyAmountCents,
  nextRenewal,
  summarize,
} from './subscription-math'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const iso = (y: number, m: number, d: number) => utc(y, m, d).toISOString()

test('addInterval advances days and weeks by fixed lengths', () => {
  expect(addInterval(utc(2026, 1, 1), 'day', 5).toISOString()).toBe(iso(2026, 1, 6))
  expect(addInterval(utc(2026, 1, 1), 'week', 2).toISOString()).toBe(iso(2026, 1, 15))
})

test('addInterval steps months and years by the calendar', () => {
  expect(addInterval(utc(2026, 1, 15), 'month', 1).toISOString()).toBe(iso(2026, 2, 15))
  expect(addInterval(utc(2026, 1, 15), 'month', 13).toISOString()).toBe(iso(2027, 2, 15))
  expect(addInterval(utc(2026, 2, 15), 'year', 1).toISOString()).toBe(iso(2027, 2, 15))
})

test('addInterval with k=0 returns the same instant', () => {
  expect(addInterval(utc(2026, 6, 4), 'month', 0).toISOString()).toBe(iso(2026, 6, 4))
})

test('nextRenewal finds the first monthly renewal strictly after now', () => {
  // started Jan 10, now Mar 20 -> Feb 10, Mar 10 are past, Apr 10 is next.
  expect(nextRenewal(iso(2026, 1, 10), 'month', iso(2026, 3, 20))).toBe(iso(2026, 4, 10))
})

test('nextRenewal returns the start date when the subscription has not started', () => {
  expect(nextRenewal(iso(2026, 7, 1), 'month', iso(2026, 6, 4))).toBe(iso(2026, 7, 1))
})

test('nextRenewal moves past a period boundary that lands exactly on now', () => {
  // 59 days after Jan 1 is Mar 1 (2026 is not a leap year) — equal to now, not
  // strictly after, so the next renewal is Mar 2.
  expect(nextRenewal(iso(2026, 1, 1), 'day', iso(2026, 3, 1))).toBe(iso(2026, 3, 2))
})

test('nextRenewal settles a multi-year-old yearly subscription correctly', () => {
  // 2020-05-01 + 6y = 2026-05-01 (past now), + 7y = 2027-05-01 (next).
  expect(nextRenewal(iso(2020, 5, 1), 'year', iso(2026, 6, 4))).toBe(iso(2027, 5, 1))
})

test('monthlyAmountCents normalises each cadence to whole cents', () => {
  expect(monthlyAmountCents(125_000, 'month')).toBe(125_000)
  expect(monthlyAmountCents(240_000, 'year')).toBe(20_000)
  expect(monthlyAmountCents(10_000, 'week')).toBe(43_333) // 10000*52/12 = 43333.33
  expect(monthlyAmountCents(1_000, 'day')).toBe(30_417) // 1000*365/12 = 30416.67
})

test('summarize counts by status and sums MRR over active only', () => {
  const out = summarize([
    { status: 'active', amount_cents: 125_000, billing_interval: 'month' },
    { status: 'active', amount_cents: 240_000, billing_interval: 'year' }, // 20000/mo
    { status: 'paused', amount_cents: 50_000, billing_interval: 'month' },
    { status: 'canceled', amount_cents: 9_900, billing_interval: 'month' },
  ])
  expect(out).toEqual({ active: 2, paused: 1, canceled: 1, mrr_cents: 145_000 })
})

test('summarize is an honest zero for an empty book', () => {
  expect(summarize([])).toEqual({ active: 0, paused: 0, canceled: 0, mrr_cents: 0 })
})
