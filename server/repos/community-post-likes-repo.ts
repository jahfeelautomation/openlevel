import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface CommunityPostLike {
  id: string
  location_id: string
  post_id: string
  member_id: string
  created_at: string
}

/**
 * The single honest fact behind every "likes" figure: "this member liked this
 * post." A unique index on (post_id, member_id) makes `add` idempotent — one
 * member liking twice can never inflate the count — and the post_id foreign key
 * cascades, so deleting a post takes its likes with it and the derived number
 * stays truthful. Nothing here computes a tally; community-math.ts turns these
 * rows into the "12 likes" the feed shows.
 */
export class CommunityPostLikesRepo extends LocationScopedRepo {
  listByPost(postId: string): Promise<CommunityPostLike[]> {
    return this.scopedSelect<CommunityPostLike>(
      'SELECT * FROM community_post_likes WHERE post_id=$2',
      [postId],
    )
  }

  /** Real like count for the post — the only source of its "likes" figure.
   *  Unique-per-member at the DB, so it can't be padded by repeat likes. */
  async countByPost(postId: string): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM community_post_likes WHERE post_id=$2',
      [postId],
    )
    return Number(rows[0]?.n ?? 0)
  }

  /** Record a like. Idempotent: a second like by the same member hits the unique
   *  index and is silently ignored, so a post's like count can't be double-counted. */
  async add(postId: string, memberId: string): Promise<void> {
    const id = nanoid()
    await this.scopedWrite(
      `INSERT INTO community_post_likes (id, location_id, post_id, member_id)
       VALUES ($2,$1,$3,$4)
       ON CONFLICT (post_id, member_id) DO NOTHING`,
      [id, postId, memberId],
    )
  }

  /** Undo a like (the member un-likes). Scoped to the location. */
  async remove(postId: string, memberId: string): Promise<void> {
    await this.scopedWrite(
      `DELETE FROM community_post_likes
       WHERE location_id=$1 AND post_id=$2 AND member_id=$3`,
      [postId, memberId],
    )
  }
}
