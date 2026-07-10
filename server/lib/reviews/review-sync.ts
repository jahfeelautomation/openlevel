import type { Database } from '../../db/database'
import { ReviewsRepo } from '../../repos/reviews-repo'
import { REVIEW_SYNC_SOURCES, resolveReviewSource } from './resolve'

export interface ReviewSyncDeps {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolver. */
  resolveSource?: typeof resolveReviewSource
}

export type SourceSyncResult =
  | { source: string; ok: true; imported: number; updated: number }
  | { source: string; ok: false; reason: string }

/**
 * Pull the location's reviews in from every platform with an adapter (Google
 * Business Profile, the Facebook Page) and mirror them into the reviews table.
 * Per-source honesty: an unconnected or refusing platform reports its reason
 * and never sinks the others; counts are real inserts/updates from the upsert,
 * never an assumed total. Re-syncs are safe — the platform's own review id
 * dedups into an update, and an operator's moderation (hidden spam) survives.
 * This only mirrors what customers really wrote; nothing here writes a rating
 * a platform didn't report.
 */
export async function syncReviews(deps: ReviewSyncDeps, locationId: string): Promise<SourceSyncResult[]> {
  const resolveSource = deps.resolveSource ?? resolveReviewSource
  const repo = new ReviewsRepo(deps.db, locationId)
  const results: SourceSyncResult[] = []

  for (const source of REVIEW_SYNC_SOURCES) {
    const resolved = await resolveSource(deps.db, locationId, source)
    if (!resolved.ok) {
      results.push({ source, ok: false, reason: resolved.reason })
      continue
    }

    try {
      const reviews = await resolved.reviewSource.fetchReviews()
      let imported = 0
      let updated = 0
      for (const review of reviews) {
        const { inserted } = await repo.upsertExternal({
          source,
          externalId: review.externalId,
          rating: review.rating,
          body: review.body,
          reviewerName: review.reviewerName,
          createdAt: review.createdAt,
        })
        if (inserted) imported++
        else updated++
      }
      results.push({ source, ok: true, imported, updated })
    } catch (err) {
      // Adapter errors carry only the HTTP status (never a token), so the
      // message is safe to hand back as the per-source reason.
      results.push({ source, ok: false, reason: err instanceof Error ? err.message : 'sync failed' })
    }
  }

  return results
}
