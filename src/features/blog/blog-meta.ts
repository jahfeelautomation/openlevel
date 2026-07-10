import type { BlogPostListItem } from '../../lib/api'

/** Blog-wide totals for the KPI band. Every figure is a real count off the post
 *  list — how many posts exist, how many are live, how many are still drafts, and
 *  the total derived read time of everything that's PUBLISHED. Nothing is invented
 *  or averaged into a vanity number; an empty blog reads as honest zeros. */
export interface BlogTotals {
  posts: number
  published: number
  drafts: number
  /** Summed read time across published posts only — each minute is derived from a
   *  post's real word count (blog-math.ts), never stored, so it can't be inflated. */
  readMinutes: number
}

export function blogTotals(posts: BlogPostListItem[]): BlogTotals {
  return posts.reduce<BlogTotals>(
    (acc, p) => {
      const live = p.status === 'published'
      return {
        posts: acc.posts + 1,
        published: acc.published + (live ? 1 : 0),
        drafts: acc.drafts + (live ? 0 : 1),
        readMinutes: acc.readMinutes + (live ? p.readingMinutes : 0),
      }
    },
    { posts: 0, published: 0, drafts: 0, readMinutes: 0 },
  )
}

export function statusLabel(status: string): string {
  return status === 'published' ? 'Published' : 'Draft'
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Format an ISO timestamp the same way the public blog renderer does (UTC, e.g.
 *  "January 5, 2026"), so the operator sees exactly the date a visitor would. An
 *  absent date — a draft has none — renders as an empty string, never a guess. */
export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
