import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface CommunityComment {
  id: string
  location_id: string
  post_id: string
  member_id: string | null
  body: string
  created_at: string
}

export interface CommunityCommentInput {
  postId: string
  body: string
  memberId?: string | null
}

/**
 * Comments on a community post, oldest-first so a thread reads top to bottom like
 * a conversation. A post's "5 comments" is a COUNT over these rows, never a stored
 * tally, so the number can only ever match the comments that actually exist.
 * `member_id` is nullable: deleting the author leaves the comment standing with no
 * name rather than rewriting the thread. Comments have no edit path in v1 (an
 * operator removes and re-adds), so there is no update() here.
 */
export class CommunityCommentsRepo extends LocationScopedRepo {
  listByPost(postId: string): Promise<CommunityComment[]> {
    return this.scopedSelect<CommunityComment>(
      'SELECT * FROM community_comments WHERE post_id=$2 ORDER BY created_at',
      [postId],
    )
  }

  /** Real comment count for the post — the only source of its "comments" figure. */
  async countByPost(postId: string): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM community_comments WHERE post_id=$2',
      [postId],
    )
    return Number(rows[0]?.n ?? 0)
  }

  async create(input: CommunityCommentInput): Promise<CommunityComment> {
    const id = nanoid()
    const rows = await this.scopedWrite<CommunityComment>(
      `INSERT INTO community_comments (id, location_id, post_id, member_id, body)
       VALUES ($2,$1,$3,$4,$5) RETURNING *`,
      [id, input.postId, input.memberId ?? null, input.body],
    )
    return rows[0]!
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM community_comments WHERE location_id=$1 AND id=$2', [id])
  }
}
