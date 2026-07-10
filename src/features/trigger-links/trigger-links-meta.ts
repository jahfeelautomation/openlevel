import type { TriggerLinkListItem } from '../../lib/api'

/**
 * Trigger-link totals for the KPI band. Every figure is an EXACT aggregate over
 * the real link + click rows — never an average or an invented vanity number:
 *   - links:        how many links exist
 *   - clicks:       summed click rows (a click belongs to exactly one link, so
 *                   summing across links never double-counts a single open)
 *   - clickedLinks: how many links have been opened at least once
 *   - lastClickedAt: the single most-recent open across every link (null = none)
 *
 * We deliberately DON'T sum each link's distinct-contact count into a global
 * "people reached" — a contact who clicks two different links would be counted
 * twice, which would inflate the figure. Honest distinct-contact counts stay
 * per-link, where the aggregate is exact. An unopened set of links reads as
 * honest zeros / "—".
 */
export interface TriggerLinkTotals {
  links: number
  clicks: number
  clickedLinks: number
  lastClickedAt: string | null
}

export function triggerLinkTotals(links: TriggerLinkListItem[]): TriggerLinkTotals {
  return links.reduce<TriggerLinkTotals>(
    (acc, l) => ({
      links: acc.links + 1,
      clicks: acc.clicks + l.clicks,
      clickedLinks: acc.clickedLinks + (l.clicks > 0 ? 1 : 0),
      lastClickedAt: laterIso(acc.lastClickedAt, l.last_clicked_at),
    }),
    { links: 0, clicks: 0, clickedLinks: 0, lastClickedAt: null },
  )
}

/** The later of two ISO timestamps, tolerating nulls (an unopened link has none). */
function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

/**
 * A compact, honest relative time for a click — "just now", "5m ago", "3h ago",
 * "2d ago" — falling back to an absolute date once it's over a week old. An
 * absent time renders as "—": a link nobody has opened never gets a fabricated
 * timestamp.
 */
export function formatClickTime(iso: string | null, now: Date = new Date()): string {
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

/** Strip the scheme + any trailing slash so a destination reads cleanly in a card
 *  ("jamalbuyshouses.example/cash-offer"), without misrepresenting the real URL. */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}
