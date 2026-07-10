import type { BadgeProps } from '../../components/ui/badge'
import type { CommunityListItem, CommunityRole, CommunityStatus } from '../../lib/api'

/**
 * Honest catalog totals for the Communities list KPI band. Every figure is summed
 * from the server-derived per-community rollups (themselves real COUNTs over rows),
 * so the band can never show more members or posts than actually exist. Pure —
 * numbers in, numbers out.
 */
export interface CommunityTotals {
  communities: number
  published: number
  drafts: number
  members: number
  posts: number
}

export function catalogTotals(communities: CommunityListItem[]): CommunityTotals {
  let published = 0
  let members = 0
  let posts = 0
  for (const community of communities) {
    if (community.status === 'published') published += 1
    members += community.rollup.members
    posts += community.rollup.posts
  }
  return {
    communities: communities.length,
    published,
    drafts: communities.length - published,
    members,
    posts,
  }
}

export function statusLabel(status: CommunityStatus): string {
  return status === 'published' ? 'Published' : 'Draft'
}

const ROLE_LABEL: Record<CommunityRole, string> = {
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member',
}

export function roleLabel(role: CommunityRole): string {
  return ROLE_LABEL[role] ?? 'Member'
}

/** Badge tint per role — admin reads as the brand accent, moderators sky-blue,
 *  plain members a quiet slate. Keeps the roster scannable at a glance. */
export function roleBadgeVariant(role: CommunityRole): NonNullable<BadgeProps['variant']> {
  if (role === 'admin') return 'brand'
  if (role === 'moderator') return 'blue'
  return 'slate'
}
