/**
 * Honest math for the Affiliate Manager. Every figure the manager shows — a
 * referral's commission, an affiliate's sales volume, the program's earned /
 * paid / owed totals, the conversion rate — is COMPUTED here from real click and
 * referral rows, never stored as a running counter, so no total can drift from
 * the rows that justify it and a brand-new affiliate is an honest zero.
 *
 * The one figure we DO persist is a referral's `commission_cents`, and it is
 * locked the moment the sale is recorded (commissionCents below): the program's
 * rate can change later without rewriting history, so what an affiliate is owed
 * can never silently move after the fact. Everything else is pure (rows in,
 * numbers out) and trivially testable.
 *
 * Money is integer cents throughout. Postgres hands `numeric`/`bigint` back as a
 * string, so every amount is coerced through Number() before it is summed.
 */

/** Floor to a non-negative integer; non-finite inputs collapse to 0. The guard
 *  every cent amount and count passes through so the manager can never show a
 *  negative or fractional figure. */
function nonNeg(n: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0))
}

export type CommissionType = 'percent' | 'flat'

/** The rate config that drives a commission. `commission_value` means a
 *  percentage when type is 'percent' (10 = 10%) and a flat amount in cents when
 *  type is 'flat' (5000 = $50.00). Accepts a string because pg returns numeric
 *  columns as text. */
export interface CommissionConfig {
  commission_type: string
  commission_value: number | string
}

/**
 * The commission earned on a sale of `amountCents`, in cents, under one program
 * rate. Percent rounds `amount × value / 100` to the nearest cent; flat is the
 * configured cents regardless of sale size. A non-positive or unparseable rate,
 * or an unknown type, earns an honest 0 — we never invent a commission the rate
 * doesn't justify. The route calls this once when recording a referral and stores
 * the result on the row, so the figure is locked against later rate changes.
 */
export function commissionCents(config: CommissionConfig, amountCents: number): number {
  const amount = nonNeg(amountCents)
  const value = Number(config.commission_value)
  if (!Number.isFinite(value) || value <= 0) return 0
  if (config.commission_type === 'percent') return nonNeg(Math.round((amount * value) / 100))
  if (config.commission_type === 'flat') return nonNeg(Math.round(value))
  return 0
}

/** A recorded sale an affiliate drove. Only the three fields the summaries read. */
export interface ReferralRow {
  amount_cents: number | string
  commission_cents: number | string
  status: string
}

export interface ReferralSummary {
  /** How many sales were recorded. */
  referrals: number
  /** Sum of the sale amounts (what the affiliate's referrals are worth). */
  salesVolumeCents: number
  /** Total commission across every referral (the locked per-row amounts summed). */
  commissionCents: number
  /** Commission still awaiting the operator's review — not owed until approved. */
  pendingCents: number
  /** Of the total, the commission on referrals marked paid. */
  paidCents: number
  /** What is payable now: APPROVED commission only — exactly what "Record payout"
   *  settles. Pending is not owed until it is reviewed (the GHL lifecycle). */
  owedCents: number
}

/**
 * Fold a set of referral rows into the totals an affiliate's detail shows. Each
 * amount is the real per-row figure, bucketed by lifecycle stage — pending
 * (awaiting review), owed (approved, payable now), paid — so the three buckets
 * always sum to the total commission and no cent can vanish or double-count.
 * A status we don't recognize lands in pending (awaiting review is the only
 * honest reading of a row we can't classify). An empty set is an honest all-zero.
 */
export function summarizeReferrals(rows: ReferralRow[]): ReferralSummary {
  let salesVolumeCents = 0
  let commissionCents = 0
  let pendingCents = 0
  let paidCents = 0
  let owedCents = 0
  for (const r of rows) {
    salesVolumeCents += nonNeg(Number(r.amount_cents))
    const comm = nonNeg(Number(r.commission_cents))
    commissionCents += comm
    if (r.status === 'paid') paidCents += comm
    else if (r.status === 'approved') owedCents += comm
    else pendingCents += comm
  }
  return {
    referrals: nonNeg(rows.length),
    salesVolumeCents: nonNeg(salesVolumeCents),
    commissionCents: nonNeg(commissionCents),
    pendingCents: nonNeg(pendingCents),
    paidCents: nonNeg(paidCents),
    owedCents: nonNeg(owedCents),
  }
}

/** One affiliate's already-aggregated stats (the repo's correlated-subquery row). */
export interface AffiliateStatRow {
  status: string
  clicks: number | string
  referrals: number | string
  sales_volume_cents: number | string
  commission_cents: number | string
  commission_approved_cents: number | string
  commission_paid_cents: number | string
}

export interface AffiliateRollup {
  /** Every affiliate in the program. */
  affiliates: number
  /** Of those, how many are active (not paused). */
  activeAffiliates: number
  clicks: number
  referrals: number
  salesVolumeCents: number
  commissionCents: number
  /** Commission awaiting review across the program — not owed until approved. */
  pendingCents: number
  paidCents: number
  /** Payable now: the APPROVED commission across the program (GHL lifecycle). */
  owedCents: number
}

/**
 * The program KPI band: sum the per-affiliate stat rows into one honest rollup.
 * Because each input row is itself derived from real clicks and referrals, the
 * rollup can only reflect what genuinely exists; an empty program is all-zero.
 * `owedCents` is the approved sum (what payouts would settle), and `pendingCents`
 * is the remainder — total − approved − paid — so anything not yet classified
 * reads as awaiting review and the three buckets account for every cent.
 */
export function rollupAffiliates(rows: AffiliateStatRow[]): AffiliateRollup {
  let activeAffiliates = 0
  let clicks = 0
  let referrals = 0
  let salesVolumeCents = 0
  let commissionCents = 0
  let approvedCents = 0
  let paidCents = 0
  for (const r of rows) {
    if (r.status === 'active') activeAffiliates += 1
    clicks += nonNeg(Number(r.clicks))
    referrals += nonNeg(Number(r.referrals))
    salesVolumeCents += nonNeg(Number(r.sales_volume_cents))
    commissionCents += nonNeg(Number(r.commission_cents))
    approvedCents += nonNeg(Number(r.commission_approved_cents))
    paidCents += nonNeg(Number(r.commission_paid_cents))
  }
  return {
    affiliates: nonNeg(rows.length),
    activeAffiliates: nonNeg(activeAffiliates),
    clicks: nonNeg(clicks),
    referrals: nonNeg(referrals),
    salesVolumeCents: nonNeg(salesVolumeCents),
    commissionCents: nonNeg(commissionCents),
    pendingCents: nonNeg(commissionCents - approvedCents - paidCents),
    paidCents: nonNeg(paidCents),
    owedCents: nonNeg(approvedCents),
  }
}

/**
 * Referrals per 100 clicks, to one decimal — the honest conversion rate. With no
 * clicks it is 0 (you can't convert traffic you never got), not a divide-by-zero.
 * It can read above 100% when sales were recorded without a tracked click (an
 * operator can attribute a sale by hand); we show that truthfully rather than
 * capping it, because the rows really do say more sales than clicks.
 */
export function conversionRate(clicks: number, referrals: number): number {
  const c = nonNeg(clicks)
  const r = nonNeg(referrals)
  if (c <= 0) return 0
  return Math.round((r / c) * 1000) / 10
}

export type BadgeTone = 'amber' | 'sky' | 'emerald' | 'slate'

/**
 * The pill a referral's status shows: pending (awaiting the operator's review),
 * approved (a valid commission, owed but not yet paid), paid (a payout the
 * operator recorded). An unknown status renders plainly rather than throwing, so
 * a row is never hidden.
 */
export function referralStatusBadge(status: string): { label: string; tone: BadgeTone } {
  if (status === 'pending') return { label: 'Pending', tone: 'amber' }
  if (status === 'approved') return { label: 'Approved', tone: 'sky' }
  if (status === 'paid') return { label: 'Paid', tone: 'emerald' }
  return { label: status || '—', tone: 'slate' }
}
