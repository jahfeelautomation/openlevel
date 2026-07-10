import type { BadgeProps } from '../../components/ui/badge'
import type { SocialPlatform, SocialPost, SocialPostStatus } from '../../lib/api'
import { dayKey, formatDayLabel } from '../../lib/utils'

/**
 * Presentation helpers for the Social Planner — all pure, all honest. Platform
 * metadata is a small lookup with a safe fallback (so an unknown platform can
 * never crash the grid), status badges map to the shared Badge tints, and the
 * calendar grouping derives day buckets from real post datetimes. No figure here
 * is invented; counts come from the server's derived rollup and the post rows.
 */

export interface PlatformMeta {
  label: string
  /** A two-glyph monogram for the channel chip — we deliberately avoid brand
   *  logos (licensing + lucide deprecations) and keep a clean, consistent chip. */
  short: string
  tile: string
}

const PLATFORM_META: Record<SocialPlatform, PlatformMeta> = {
  facebook: { label: 'Facebook', short: 'Fb', tile: 'bg-blue-50 text-blue-600' },
  instagram: { label: 'Instagram', short: 'Ig', tile: 'bg-fuchsia-50 text-fuchsia-600' },
  google_business: { label: 'Google Business', short: 'GB', tile: 'bg-amber-50 text-amber-600' },
  linkedin: { label: 'LinkedIn', short: 'In', tile: 'bg-sky-50 text-sky-700' },
  tiktok: { label: 'TikTok', short: 'Tk', tile: 'bg-slate-200 text-slate-700' },
  x: { label: 'X', short: 'X', tile: 'bg-slate-900 text-white' },
  youtube: { label: 'YouTube', short: 'Yt', tile: 'bg-red-50 text-red-600' },
}

const FALLBACK_META: PlatformMeta = { label: 'Channel', short: '•', tile: 'bg-slate-100 text-slate-600' }

/** Every platform OpenLevel can target, in the order they show in the composer. */
export const ALL_PLATFORMS: SocialPlatform[] = [
  'facebook',
  'instagram',
  'google_business',
  'linkedin',
  'tiktok',
  'x',
  'youtube',
]

/** Safe platform lookup — null/unknown falls back to a neutral chip. */
export function platformMeta(platform: SocialPlatform | string | null): PlatformMeta {
  if (!platform) return FALLBACK_META
  return PLATFORM_META[platform as SocialPlatform] ?? FALLBACK_META
}

export interface StatusBadge {
  label: string
  variant: NonNullable<BadgeProps['variant']>
}

export function statusBadge(status: SocialPostStatus): StatusBadge {
  if (status === 'published') return { label: 'Published', variant: 'green' }
  if (status === 'scheduled') return { label: 'Scheduled', variant: 'blue' }
  return { label: 'Draft', variant: 'slate' }
}

/** All scheduled posts (past-due included, so nothing is silently hidden), soonest
 *  first — what the content calendar groups by day. */
export function scheduledByDate(posts: SocialPost[]): SocialPost[] {
  return posts
    .filter((p) => p.status === 'scheduled' && p.scheduled_at)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
}

/** Published posts, newest first — the honest ledger of what's gone out. */
export function publishedFirst(posts: SocialPost[]): SocialPost[] {
  return posts
    .filter((p) => p.status === 'published')
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
}

/** Drafts not yet scheduled, newest first (posts already arrive newest-first). */
export function draftPosts(posts: SocialPost[]): SocialPost[] {
  return posts.filter((p) => p.status === 'draft')
}

export interface DayGroup {
  key: string
  label: string
  posts: SocialPost[]
}

/**
 * Bucket posts into calendar days by a datetime field, preserving the input order
 * within each day and the first-seen order of days. Posts without the field are
 * skipped. Builds the groups array and an index over the SAME objects, so there is
 * no non-null assertion and no possibility of a phantom day.
 */
export function groupPostsByDay(
  posts: SocialPost[],
  field: 'scheduled_at' | 'published_at',
): DayGroup[] {
  const groups: DayGroup[] = []
  const index = new Map<string, DayGroup>()
  for (const post of posts) {
    const iso = post[field]
    if (!iso) continue
    const key = dayKey(iso)
    let group = index.get(key)
    if (!group) {
      group = { key, label: formatDayLabel(iso), posts: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.posts.push(post)
  }
  return groups
}
