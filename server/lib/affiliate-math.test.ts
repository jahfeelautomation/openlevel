import {
  commissionCents,
  conversionRate,
  referralStatusBadge,
  rollupAffiliates,
  summarizeReferrals,
} from './affiliate-math'

test('commissionCents takes a percent of the sale, rounded to the nearest cent', () => {
  // 10% of $250.00 = $25.00
  expect(commissionCents({ commission_type: 'percent', commission_value: 10 }, 25_000)).toBe(2_500)
  // 12.5% of $99.99 = 1249.875c → 1250c
  expect(commissionCents({ commission_type: 'percent', commission_value: 12.5 }, 9_999)).toBe(1_250)
})

test('commissionCents pays a flat cents amount regardless of sale size', () => {
  expect(commissionCents({ commission_type: 'flat', commission_value: 5_000 }, 25_000)).toBe(5_000)
  expect(commissionCents({ commission_type: 'flat', commission_value: 5_000 }, 1_000_000)).toBe(5_000)
})

test('commissionCents coerces a string rate (pg returns numeric as text)', () => {
  expect(commissionCents({ commission_type: 'percent', commission_value: '10' }, 25_000)).toBe(2_500)
})

test('commissionCents is an honest 0 for a non-positive rate, unknown type, or junk amount', () => {
  expect(commissionCents({ commission_type: 'percent', commission_value: 0 }, 25_000)).toBe(0)
  expect(commissionCents({ commission_type: 'percent', commission_value: -5 }, 25_000)).toBe(0)
  expect(commissionCents({ commission_type: 'mystery', commission_value: 10 }, 25_000)).toBe(0)
  expect(commissionCents({ commission_type: 'percent', commission_value: 10 }, Number.NaN)).toBe(0)
})

test('summarizeReferrals splits commission into pending / owed (approved) / paid — GHL lifecycle', () => {
  const out = summarizeReferrals([
    { amount_cents: 25_000, commission_cents: 2_500, status: 'paid' },
    { amount_cents: 40_000, commission_cents: 4_000, status: 'approved' },
    { amount_cents: 10_000, commission_cents: 1_000, status: 'pending' },
  ])
  expect(out).toEqual({
    referrals: 3,
    salesVolumeCents: 75_000,
    commissionCents: 7_500,
    pendingCents: 1_000, // awaiting review — NOT owed yet
    paidCents: 2_500, // only the 'paid' row counts as paid
    owedCents: 4_000, // approved only — what a payout would settle
  })
  // The three buckets always account for every cent of commission.
  expect(out.pendingCents + out.owedCents + out.paidCents).toBe(out.commissionCents)
})

test('summarizeReferrals folds an unknown status into pending so no commission vanishes', () => {
  const out = summarizeReferrals([
    { amount_cents: 10_000, commission_cents: 1_000, status: 'weird' },
  ])
  expect(out.pendingCents).toBe(1_000)
  expect(out.owedCents).toBe(0)
  expect(out.paidCents).toBe(0)
})

test('summarizeReferrals is an honest all-zero for an affiliate with no referrals', () => {
  expect(summarizeReferrals([])).toEqual({
    referrals: 0,
    salesVolumeCents: 0,
    commissionCents: 0,
    pendingCents: 0,
    paidCents: 0,
    owedCents: 0,
  })
})

test('summarizeReferrals coerces string cents from pg', () => {
  const out = summarizeReferrals([
    { amount_cents: '25000', commission_cents: '2500', status: 'paid' },
  ])
  expect(out.salesVolumeCents).toBe(25_000)
  expect(out.commissionCents).toBe(2_500)
  expect(out.paidCents).toBe(2_500)
  expect(out.pendingCents).toBe(0)
  expect(out.owedCents).toBe(0)
})

test('rollupAffiliates sums the program KPIs; owed is the approved sum, pending is the remainder', () => {
  const out = rollupAffiliates([
    {
      status: 'active',
      clicks: 12,
      referrals: 3,
      sales_volume_cents: 75_000,
      commission_cents: 7_500,
      commission_approved_cents: 4_000,
      commission_paid_cents: 2_500,
    },
    {
      status: 'paused',
      clicks: 4,
      referrals: 1,
      sales_volume_cents: 20_000,
      commission_cents: 2_000,
      commission_approved_cents: 0,
      commission_paid_cents: 0,
    },
  ])
  expect(out).toEqual({
    affiliates: 2,
    activeAffiliates: 1,
    clicks: 16,
    referrals: 4,
    salesVolumeCents: 95_000,
    commissionCents: 9_500,
    pendingCents: 3_000, // 9500 − 4000 approved − 2500 paid: still awaiting review
    paidCents: 2_500,
    owedCents: 4_000, // approved only — what payouts would settle
  })
})

test('rollupAffiliates is an honest all-zero for a program with no affiliates', () => {
  expect(rollupAffiliates([])).toEqual({
    affiliates: 0,
    activeAffiliates: 0,
    clicks: 0,
    referrals: 0,
    salesVolumeCents: 0,
    commissionCents: 0,
    pendingCents: 0,
    paidCents: 0,
    owedCents: 0,
  })
})

test('conversionRate is referrals per 100 clicks to one decimal', () => {
  expect(conversionRate(12, 3)).toBe(25) // 3/12 = 25%
  expect(conversionRate(8, 1)).toBe(12.5)
})

test('conversionRate is an honest 0 when there are no clicks (never divides by zero)', () => {
  expect(conversionRate(0, 0)).toBe(0)
  expect(conversionRate(0, 5)).toBe(0)
})

test('referralStatusBadge maps each status to a label + tone, unknowns render plainly', () => {
  expect(referralStatusBadge('pending')).toEqual({ label: 'Pending', tone: 'amber' })
  expect(referralStatusBadge('approved')).toEqual({ label: 'Approved', tone: 'sky' })
  expect(referralStatusBadge('paid')).toEqual({ label: 'Paid', tone: 'emerald' })
  expect(referralStatusBadge('weird')).toEqual({ label: 'weird', tone: 'slate' })
})
