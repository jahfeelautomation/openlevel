import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface CommunityPost {
  id: string
  location_id: string
  community_id: string
  channel_id: string
  member_id: string | null
  title: string | null
  body: string
  pinned: boolean
  created_at: string
  updated_at: string
}

export interface CommunityPostInput {
  communityId: string
  channelId: string
  body: string
  memberId?: string | null
  title?: string | null
  pinned?: boolean
}

export interface CommunityPostPatch {
  title?: string | null
  body?: string
  pinned?: boolean
}

/**
 * Posts in a community, each filed under exactly one channel and (optionally)
 * authored by a member. Ordering is the single source of truth for "what shows
 * first": pinned posts lead, then newest — done in SQL (`ORDER BY pinned DESC,
 * created_at DESC`) so there is never a second, drifting sorter in app code. A
 * post's "12 likes · 5 comments" is derived from real like/comment rows, not kept
 * here. `member_id` is nullable so a deleted member's posts remain (with no
 * author) rather than disappearing — the activity was real, so we keep it.
 */
export class CommunityPostsRepo extends LocationScopedRepo {
  /** A channel's feed: pinned first, then newest. */
  listByChannel(channelId: string): Promise<CommunityPost[]> {
    return this.scopedSelect<CommunityPost>(
      'SELECT * FROM community_posts WHERE channel_id=$2 ORDER BY pinned DESC, created_at DESC',
      [channelId],
    )
  }

  /** Every post in the community across its channels: pinned first, then newest. */
  listByCommunity(communityId: string): Promise<CommunityPost[]> {
    return this.scopedSelect<CommunityPost>(
      'SELECT * FROM community_posts WHERE community_id=$2 ORDER BY pinned DESC, created_at DESC',
      [communityId],
    )
  }

  async get(id: string): Promise<CommunityPost | undefined> {
    const rows = await this.scopedSelect<CommunityPost>(
      'SELECT * FROM community_posts WHERE id=$2',
      [id],
    )
    return rows[0]
  }

  /** Real post count for the whole community — the "posts" figure on its card. */
  async countByCommunity(communityId: string): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM community_posts WHERE community_id=$2',
      [communityId],
    )
    return Number(rows[0]?.n ?? 0)
  }

  /** Real post count for one channel — feeds topChannel / per-channel badges. */
  async countByChannel(channelId: string): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM community_posts WHERE channel_id=$2',
      [channelId],
    )
    return Number(rows[0]?.n ?? 0)
  }

  async create(input: CommunityPostInput): Promise<CommunityPost> {
    const id = nanoid()
    const rows = await this.scopedWrite<CommunityPost>(
      `INSERT INTO community_posts (id, location_id, community_id, channel_id, member_id, title, body, pinned)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id,
        input.communityId,
        input.channelId,
        input.memberId ?? null,
        input.title ?? null,
        input.body,
        input.pinned ?? false,
      ],
    )
    return rows[0]!
  }

  /** Patch only the provided columns; always refresh updated_at. Dynamic SET from
   *  $2, id pinned last. Returns undefined when nothing was provided. */
  async update(id: string, patch: CommunityPostPatch): Promise<CommunityPost | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.title !== undefined) bind('title', patch.title)
    if (patch.body !== undefined) bind('body', patch.body)
    if (patch.pinned !== undefined) bind('pinned', patch.pinned)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<CommunityPost>(
      `UPDATE community_posts SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  /** Pin / unpin a post (its own sub-route on the operator API). */
  async setPinned(id: string, pinned: boolean): Promise<CommunityPost | undefined> {
    const rows = await this.scopedWrite<CommunityPost>(
      'UPDATE community_posts SET pinned=$2, updated_at=now() WHERE location_id=$1 AND id=$3 RETURNING *',
      [pinned, id],
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM community_posts WHERE location_id=$1 AND id=$2', [id])
  }
}
