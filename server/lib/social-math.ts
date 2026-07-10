/**
 * Honest rollups for the Social Planner. The KPI band's "12 posts · 4 scheduled ·
 * 6 published" and "2 accounts connected" are COMPUTED here from real post and
 * account rows — never stored on a summary row — so no figure can drift from the
 * rows that justify it. Crucially, there is NO reach/impressions/engagement
 * anywhere: OpenLevel is a content calendar and scheduler, not a fabricated
 * analytics surface, so we only ever count things that genuinely exist (a post
 * you wrote, an account you linked). Everything here is pure (rows in, numbers
 * out), so it is trivially testable and side-effect free.
 */

/** Floor to a non-negative integer; non-finite inputs collapse to 0. The guard
 *  every count passes through so the planner can never show a negative or
 *  fractional tally. */
function nonNeg(n: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0))
}

export interface SocialStatusCounts {
  /** Composed but not yet scheduled or published. */
  draft: number
  /** Queued for a future datetime. */
  scheduled: number
  /** Marked published in OpenLevel's ledger. */
  published: number
  /** Every post that exists, whatever its status. */
  total: number
}

export interface StatusRow {
  status: string
}

/**
 * The four figures the KPI band shows, each a real count over the post rows. An
 * empty planner is an honest all-zero. `total` is the true number of rows, so if
 * a row ever carries a status we don't recognise it still counts toward total
 * (we never hide a real post) while only the three known buckets are tallied.
 */
export function statusCounts(posts: StatusRow[]): SocialStatusCounts {
  let draft = 0
  let scheduled = 0
  let published = 0
  for (const p of posts) {
    if (p.status === 'draft') draft += 1
    else if (p.status === 'scheduled') scheduled += 1
    else if (p.status === 'published') published += 1
  }
  return {
    draft: nonNeg(draft),
    scheduled: nonNeg(scheduled),
    published: nonNeg(published),
    total: nonNeg(posts.length),
  }
}

export interface ConnectableAccount {
  connected: boolean
}

/** Real count of linked accounts — the honest "N connected" KPI. Defaults to an
 *  honest 0 because no account is connected until a real OAuth link exists. */
export function connectedCount(accounts: ConnectableAccount[]): number {
  return nonNeg(accounts.filter((a) => a.connected).length)
}

export interface PlatformAccount {
  platform: string
  connected: boolean
}

export interface PlatformSummary {
  platform: string
  /** Accounts on this platform. */
  total: number
  /** Of those, how many are genuinely connected. */
  connected: number
}

/**
 * Per-platform account tallies for the "channels" strip (Facebook, Instagram,
 * Google Business …), in stable first-seen order so the strip is deterministic.
 * Both numbers are derived from real account rows; `connected` can only ever be
 * ≤ `total`, and a brand-new planner with no accounts returns an empty list
 * rather than inventing platforms.
 */
export function accountsByPlatform(accounts: PlatformAccount[]): PlatformSummary[] {
  const summaries: PlatformSummary[] = []
  const index = new Map<string, PlatformSummary>()
  for (const a of accounts) {
    const existing = index.get(a.platform)
    if (existing) {
      existing.total += 1
      if (a.connected) existing.connected += 1
    } else {
      const fresh: PlatformSummary = {
        platform: a.platform,
        total: 1,
        connected: a.connected ? 1 : 0,
      }
      index.set(a.platform, fresh)
      summaries.push(fresh)
    }
  }
  return summaries
}

export interface QueuedPost {
  id: string
  status: string
  scheduled_at: string | null
}

/**
 * The upcoming queue: scheduled posts whose datetime is now or later, soonest
 * first. Honest by construction — only `status === 'scheduled'` rows with a
 * parseable future `scheduled_at` qualify (a draft, a past slot, or a missing
 * datetime never appears), and ties break by id so the order is deterministic.
 * Generic so the route can hand in full rows and get full rows back. Pure: `now`
 * is passed in rather than read from the clock, so tests are deterministic.
 */
export function upcomingQueue<T extends QueuedPost>(posts: T[], nowIso: string): T[] {
  const now = Date.parse(nowIso)
  const floor = Number.isFinite(now) ? now : 0
  return posts
    .filter((p) => {
      if (p.status !== 'scheduled' || p.scheduled_at === null) return false
      const at = Date.parse(p.scheduled_at)
      return Number.isFinite(at) && at >= floor
    })
    .sort((a, b) => {
      const da = Date.parse(a.scheduled_at as string)
      const db = Date.parse(b.scheduled_at as string)
      if (da !== db) return da - db
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}
