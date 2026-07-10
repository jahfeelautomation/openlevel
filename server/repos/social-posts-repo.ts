import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type SocialPostStatus = 'draft' | 'scheduled' | 'published'

export interface SocialPost {
  id: string
  location_id: string
  body: string
  media_url: string | null
  status: string
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface SocialPostTarget {
  id: string
  location_id: string
  post_id: string
  account_id: string
  status: string | null
  detail: string | null
  external_id: string | null
  created_at: string
}

export interface SocialPostInput {
  body: string
  mediaUrl?: string | null
  status?: SocialPostStatus
  scheduledAt?: string | null
  accountIds?: string[]
}

export interface SocialPostPatch {
  body?: string
  mediaUrl?: string | null
  scheduledAt?: string | null
}

/** What really happened on one channel when the post went out. */
export interface TargetOutcomeRecord {
  accountId: string
  status: 'published' | 'failed'
  detail: string | null
  externalId: string | null
}

/**
 * Social posts for one location and the accounts each fans out to. A post is
 * composed once and targets many accounts (social_post_targets), so editing the
 * channel set is a wholesale replace. The lifecycle is honest: draft → scheduled
 * (a real future datetime) → published (a `published_at` recorded in OpenLevel's
 * own ledger). `publish` flips that status and stamps the time, but the actual
 * push to Facebook/Instagram is the pending platform adapter — this repo never
 * invents reach or engagement, it only records what truly happened on our side.
 */
export class SocialPostsRepo extends LocationScopedRepo {
  list(): Promise<SocialPost[]> {
    return this.scopedSelect<SocialPost>('SELECT * FROM social_posts ORDER BY created_at DESC')
  }

  async get(id: string): Promise<SocialPost | undefined> {
    const rows = await this.scopedSelect<SocialPost>('SELECT * FROM social_posts WHERE id=$2', [id])
    return rows[0]
  }

  /** The accounts a post fans out to (compose once, publish to many). */
  listTargets(postId: string): Promise<SocialPostTarget[]> {
    return this.scopedSelect<SocialPostTarget>(
      'SELECT * FROM social_post_targets WHERE post_id=$2 ORDER BY created_at',
      [postId],
    )
  }

  async create(input: SocialPostInput): Promise<SocialPost> {
    const id = nanoid()
    const rows = await this.scopedWrite<SocialPost>(
      `INSERT INTO social_posts (id, location_id, body, media_url, status, scheduled_at)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.body, input.mediaUrl ?? null, input.status ?? 'draft', input.scheduledAt ?? null],
    )
    const post = rows[0]!
    if (input.accountIds && input.accountIds.length > 0) {
      await this.replaceTargets(post.id, input.accountIds)
    }
    return post
  }

  /** Replace a post's target accounts wholesale (compose-once editing). Dedupes
   *  defensively so the unique (post, account) index can't be tripped, and keeps
   *  only account ids that actually belong to this location — a target must never
   *  fan a post out to another tenant's connected account. */
  async replaceTargets(postId: string, accountIds: string[]): Promise<void> {
    await this.scopedWrite('DELETE FROM social_post_targets WHERE location_id=$1 AND post_id=$2', [
      postId,
    ])
    const requested = [...new Set(accountIds)]
    if (requested.length === 0) return
    const owned = await this.scopedSelect<{ id: string }>('SELECT id FROM social_accounts')
    const ownedIds = new Set(owned.map((r) => r.id))
    for (const accountId of requested) {
      if (!ownedIds.has(accountId)) continue
      await this.scopedWrite(
        `INSERT INTO social_post_targets (id, location_id, post_id, account_id)
         VALUES ($2,$1,$3,$4)`,
        [nanoid(), postId, accountId],
      )
    }
  }

  /** Move a post into the scheduled queue at a real future datetime. */
  async schedule(id: string, scheduledAt: string): Promise<SocialPost | undefined> {
    const rows = await this.scopedWrite<SocialPost>(
      `UPDATE social_posts SET status='scheduled', scheduled_at=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [scheduledAt, id],
    )
    return rows[0]
  }

  /** Mark a post published in OpenLevel's ledger at publishedAt. The route only
   *  calls this after at least one channel REALLY accepted the post (see
   *  publishSocialPost); per-channel truth lives on the targets. */
  async publish(id: string, publishedAt: string): Promise<SocialPost | undefined> {
    const rows = await this.scopedWrite<SocialPost>(
      `UPDATE social_posts SET status='published', published_at=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [publishedAt, id],
    )
    return rows[0]
  }

  /** Patch only the provided columns; always refresh updated_at. Dynamic SET from
   *  $2, id pinned last. Returns undefined when nothing was provided. */
  async update(id: string, patch: SocialPostPatch): Promise<SocialPost | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.body !== undefined) bind('body', patch.body)
    if (patch.mediaUrl !== undefined) bind('media_url', patch.mediaUrl)
    if (patch.scheduledAt !== undefined) bind('scheduled_at', patch.scheduledAt)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<SocialPost>(
      `UPDATE social_posts SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  /** Record what REALLY happened on each channel after a publish — the
   *  provider's post id on success, the honest reason on failure. Scoped to
   *  location + post + account so a foreign outcome can never be written. */
  async recordTargetOutcomes(postId: string, outcomes: TargetOutcomeRecord[]): Promise<void> {
    for (const outcome of outcomes) {
      await this.scopedWrite(
        `UPDATE social_post_targets SET status=$2, detail=$3, external_id=$4
         WHERE location_id=$1 AND post_id=$5 AND account_id=$6`,
        [outcome.status, outcome.detail, outcome.externalId, postId, outcome.accountId],
      )
    }
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM social_posts WHERE location_id=$1 AND id=$2', [id])
  }
}
