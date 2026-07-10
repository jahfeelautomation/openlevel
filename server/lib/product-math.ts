// Pure helpers for the Products catalog: money formatting and the recurring
// cadence labels. Kept separate from the repo so the route, the seed, and the
// client meta mirror all agree on how a product price reads.

export type ProductType = 'one_time' | 'recurring'
export type RecurringInterval = 'day' | 'week' | 'month' | 'year'

/**
 * Format an integer cent amount as human money, e.g. 125000 -> "$1,250.00". Pure
 * and locale-stable (en-US). Falls back to a plain grouped number with the
 * upper-cased code if the currency isn't a valid ISO code, so a malformed code
 * never breaks rendering.
 */
export function formatPriceCents(cents: number, currency = 'usd'): string {
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

const SUFFIX: Record<RecurringInterval, string> = {
  day: '/day',
  week: '/wk',
  month: '/mo',
  year: '/yr',
}

const ADVERB: Record<RecurringInterval, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  year: 'Yearly',
}

/** The short price suffix for a billing interval ('/mo', '/yr', …). Empty string
 *  for a missing or unrecognised interval, so a one-time price stays bare. */
export function intervalSuffix(interval?: string | null): string {
  return interval && interval in SUFFIX ? SUFFIX[interval as RecurringInterval] : ''
}

/** A human cadence label for a billing interval ('month' -> 'Monthly'). Empty
 *  string when there is no recognised interval. */
export function intervalLabel(interval?: string | null): string {
  return interval && interval in ADVERB ? ADVERB[interval as RecurringInterval] : ''
}

/**
 * The catalog price label combining amount and cadence: a one-time product reads
 * as a bare "$199.00", a recurring one appends its interval ("$2,500.00/mo"). The
 * suffix is only ever added for a recurring product, so a stray interval left on
 * a one-time row never leaks into the label.
 */
export function priceLabel(input: {
  price_cents: number
  currency?: string
  type?: string
  recurring_interval?: string | null
}): string {
  const money = formatPriceCents(input.price_cents, input.currency ?? 'usd')
  if (input.type === 'recurring') return `${money}${intervalSuffix(input.recurring_interval)}`
  return money
}
