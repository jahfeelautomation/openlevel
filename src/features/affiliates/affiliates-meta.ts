import type { AffiliateProgram } from '../../lib/api'
import { formatMoney } from '../../lib/utils'

/** A Badge variant, kept loose so the meta can map server tones to the app's pills. */
type BadgeVariant = 'slate' | 'brand' | 'green' | 'amber' | 'blue' | 'rose' | 'outline'

/**
 * The pill a referral's status shows. The server's affiliate-math returns its own
 * tone names (amber/sky/emerald/slate); here they're mapped to the app's Badge
 * variants. An unknown status renders plainly rather than disappearing.
 *   pending  — awaiting the operator's review
 *   approved — a valid commission, owed but not yet paid
 *   paid     — a payout the operator recorded (bookkeeping; no money moved)
 */
export function referralBadge(status: string): { variant: BadgeVariant; label: string } {
  if (status === 'pending') return { variant: 'amber', label: 'Pending' }
  if (status === 'approved') return { variant: 'blue', label: 'Approved' }
  if (status === 'paid') return { variant: 'green', label: 'Paid' }
  return { variant: 'slate', label: status || '—' }
}

/** The pill an affiliate's status shows. */
export function affiliateBadge(status: string): { variant: BadgeVariant; label: string } {
  if (status === 'active') return { variant: 'green', label: 'Active' }
  if (status === 'paused') return { variant: 'slate', label: 'Paused' }
  return { variant: 'slate', label: status || '—' }
}

/**
 * A human label for the program's commission rate. `commission_value` is a
 * percentage when the type is 'percent' ("10% per sale") and an amount in cents
 * when 'flat' ("$50 flat per sale"). pg hands the value back as a string, so it's
 * coerced through Number() first.
 */
export function programRateLabel(program: AffiliateProgram): string {
  const value = Number(program.commission_value)
  if (program.commission_type === 'flat') return `${formatMoney(value)} flat per sale`
  return `${value}% per sale`
}

/** Strip the scheme + trailing slash so a landing URL reads cleanly in a card,
 *  without misrepresenting the real destination. */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

/** A compact, honest relative time for a referral or click — "just now", "5m ago",
 *  "3h ago", "2d ago" — falling back to an absolute date past a week. An absent
 *  time renders "—": a row with no timestamp never gets a fabricated one. */
export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
