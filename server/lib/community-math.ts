/**
 * Honest rollups for the Communities module. A community's "128 members · 42
 * posts", and a post's "12 likes · 5 comments", are COMPUTED here from real rows
 * — members, posts, comments and likes are each their own table — and are never
 * stored on a community/post row. That keeps every figure from drifting from the
 * rows that justify it and makes it impossible to inflate: deleting a post can
 * only re-derive a smaller, truthful number. The same honesty-by-construction
 * rule the review average and the invoice total follow. Everything here is pure
 * (numbers in, numbers out), so it is trivially testable and side-effect free.
 */

/** Floor to a non-negative integer; non-finite inputs collapse to 0. The guard
 *  every count passes through so a community can never show a negative or
 *  fractional tally. */
function nonNeg(n: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0))
}

export interface CommunityRollup {
  /** People who have joined the community. */
  members: number
  /** Posts across all of the community's channels. */
  posts: number
}

/** The two figures a community card/header shows, each derived from a real COUNT
 *  over its members / posts. An empty community is an honest { members: 0,
 *  posts: 0 }. */
export function communityRollup(memberCount: number, postCount: number): CommunityRollup {
  return { members: nonNeg(memberCount), posts: nonNeg(postCount) }
}

export interface PostCounts {
  /** Distinct members who liked the post (unique per member at the DB). */
  likes: number
  /** Comments left on the post. */
  comments: number
}

/** The engagement figures a post shows, derived from real like/comment rows.
 *  Likes are unique per member in the schema, so this can't be padded by one
 *  member liking twice. */
export function postCounts(likeCount: number, commentCount: number): PostCounts {
  return { likes: nonNeg(likeCount), comments: nonNeg(commentCount) }
}

export interface ChannelActivity {
  name: string
  /** Real post count for the channel. */
  postCount: number
}

/**
 * The community's most active channel — the one with the most posts — for the
 * "Most active: General" line on the operator card. Honest by construction:
 * returns null when there are no channels or every channel is empty (we never
 * invent activity), and ties break toward the first channel given (stable), so
 * the answer is deterministic. Pure.
 */
export function topChannel(channels: ChannelActivity[]): string | null {
  let best: ChannelActivity | null = null
  for (const ch of channels) {
    const count = nonNeg(ch.postCount)
    if (count > 0 && (best === null || count > nonNeg(best.postCount))) best = ch
  }
  return best ? best.name : null
}
