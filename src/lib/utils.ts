import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes, resolving conflicts (last wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Up-to-two-letter initials for avatar fallbacks. */
export function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const joined = parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  return joined || '?'
}

/** Compact relative time ("just now", "12m", "3h", "2d", or a date). */
export function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const min = Math.round((Date.now() - then) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString()
}

/** Local YYYY-MM-DD key for grouping appointments by calendar day. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Agenda day header: "Today" / "Tomorrow" / "Yesterday" / "Wed, Jun 4". */
export function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** A single clock time, e.g. "3:00 PM". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** A start–end clock range, e.g. "3:00 PM – 4:00 PM". */
export function formatTimeRange(startISO: string, endISO: string): string {
  return `${formatTime(startISO)} – ${formatTime(endISO)}`
}

/**
 * Render a CALENDAR DATE (a due / start / expiry the operator picked in a date
 * input) without dragging it into the viewer's timezone. These are stored in
 * timestamptz columns at UTC midnight, so a plain toLocaleDateString in Arizona
 * (UTC-7) would show "Jun 11" for a date set to "Jun 12". We read the date off
 * the leading YYYY-MM-DD and format it in UTC, so the day shown is the day set.
 * Use this for date-only fields ONLY — for real event instants (issued / paid /
 * created), keep the local-time formatters so the actual moment shows.
 */
export function formatDateOnly(
  value?: string | null,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  if (!value) return ''
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}

/**
 * The YYYY-MM-DD a date `<input type="date">` expects, read off a stored
 * timestamp WITHOUT a timezone shift — so opening an invoice to edit shows the
 * day that was set, and re-saving never walks the date backward one box at a
 * time. Empty string when unset or unparseable.
 */
export function dateInputValue(value?: string | null): string {
  if (!value) return ''
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}

/** Format integer cents as compact USD ("$185,000"). */
export function formatMoney(cents?: number | null): string {
  const dollars = (cents ?? 0) / 100
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

/** Format integer cents as exact USD with cents ("$1,265.00"). Used for
 *  invoices, where the figure must match the summed line items to the penny. */
export function formatMoneyExact(cents?: number | null): string {
  return ((cents ?? 0) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Format a phone number for display; falls back to the raw string. */
export function formatPhone(raw?: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/[^\d]/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return raw
}
