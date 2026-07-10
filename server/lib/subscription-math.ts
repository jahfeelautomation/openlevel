// Pure helpers for the Subscriptions ledger: advancing a billing cadence,
// finding the next renewal, and normalising mixed cadences to a monthly figure
// for MRR. Kept separate from the repo so the route, the seed and the client all
// agree on the schedule and the money. Nothing here charges a card or moves
// money — a subscription is a recorded commitment, and these functions only read
// its schedule and value.

import type { RecurringInterval } from './product-math'

export type SubscriptionStatus = 'active' | 'paused' | 'canceled'

const MS_PER_DAY = 86_400_000

// Average length of each cadence in days, used only to make a first guess at how
// many periods have elapsed; the exact answer is then settled by calendar math
// in addInterval, so month/year length variation never causes an off-by-one.
const AVG_DAYS: Record<RecurringInterval, number> = {
  day: 1,
  week: 7,
  month: 30.4368,
  year: 365.2425,
}

/**
 * Advance a date by `k` whole billing periods. day and week are fixed lengths
 * (k days, k*7 days); month and year are CALENDAR steps via the UTC setters, so
 * a monthly cadence keeps its day-of-month and a yearly one its month-and-day
 * (with JS's natural end-of-month roll-over, e.g. Jan 31 + 1 month). All math is
 * in UTC so the result never shifts with the host timezone. `k` may be 0.
 */
export function addInterval(date: Date, interval: RecurringInterval, k: number): Date {
  const d = new Date(date.getTime())
  switch (interval) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + k)
      break
    case 'week':
      d.setUTCDate(d.getUTCDate() + k * 7)
      break
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + k)
      break
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() + k)
      break
  }
  return d
}

/**
 * The next billing date strictly after `now`: the smallest `started_at + k*interval`
 * (k >= 0) that is later than now. A subscription whose start is still in the
 * future renews first on its start date (k = 0). Returns an ISO string.
 *
 * The elapsed-periods guess gets us close in O(1); two short adjustment loops
 * then settle it exactly against the calendar, so the result is correct for any
 * cadence and any age of subscription without walking period-by-period.
 */
export function nextRenewal(
  startedAtISO: string,
  interval: RecurringInterval,
  nowISO: string,
): string {
  const start = new Date(startedAtISO)
  const now = new Date(nowISO)

  // Not started yet — the first renewal is the start date itself.
  if (start.getTime() > now.getTime()) return start.toISOString()

  const elapsedDays = (now.getTime() - start.getTime()) / MS_PER_DAY
  let k = Math.max(1, Math.floor(elapsedDays / AVG_DAYS[interval]))

  // Climb until strictly after now, then descend to the first such period, so we
  // land on the exact smallest k regardless of which way the guess erred.
  while (addInterval(start, interval, k).getTime() <= now.getTime()) k += 1
  while (k > 1 && addInterval(start, interval, k - 1).getTime() > now.getTime()) k -= 1

  return addInterval(start, interval, k).toISOString()
}

/**
 * Normalise a per-interval amount to a whole-cent monthly figure so MRR can sum
 * across mixed cadences: a month stays as-is, a year is divided by 12, a week is
 * scaled by 52/12 and a day by 365/12. Rounded to the nearest cent.
 */
export function monthlyAmountCents(amountCents: number, interval: RecurringInterval): number {
  switch (interval) {
    case 'month':
      return Math.round(amountCents)
    case 'year':
      return Math.round(amountCents / 12)
    case 'week':
      return Math.round((amountCents * 52) / 12)
    case 'day':
      return Math.round((amountCents * 365) / 12)
  }
}

export interface SubscriptionSummary {
  active: number
  paused: number
  canceled: number
  /** Monthly Recurring Revenue in cents, summed over ACTIVE subscriptions only. */
  mrr_cents: number
}

/**
 * Roll a set of subscriptions up into status counts and MRR. Only ACTIVE
 * subscriptions contribute to MRR — a paused or canceled one bills nothing — so
 * the headline figure reflects revenue actually committed right now. An empty
 * book is an honest zero across the board.
 */
export function summarize(
  subs: Array<{ status: string; amount_cents: number; billing_interval: RecurringInterval }>,
): SubscriptionSummary {
  const summary: SubscriptionSummary = { active: 0, paused: 0, canceled: 0, mrr_cents: 0 }
  for (const s of subs) {
    if (s.status === 'active') {
      summary.active += 1
      summary.mrr_cents += monthlyAmountCents(s.amount_cents, s.billing_interval)
    } else if (s.status === 'paused') {
      summary.paused += 1
    } else if (s.status === 'canceled') {
      summary.canceled += 1
    }
  }
  return summary
}
