import type { Review } from '../repos/reviews-repo'

/** The five star buckets, most-positive first — the order a UI lists them. */
export type StarBucket = 5 | 4 | 3 | 2 | 1

export interface ReviewStats {
  /** Number of (valid 1–5) reviews counted. */
  count: number
  /** Mean rating to one decimal; 0 when there are no reviews. */
  average: number
  /** How many reviews sit at each star value. */
  distribution: Record<StarBucket, number>
}

/**
 * Derive the honest reputation aggregates from the real review rows. The average
 * and the per-star distribution are COMPUTED here from `rating` alone — never
 * stored — so the headline figure can't drift from the reviews that justify it
 * (the same honesty-by-construction rule invoice totals follow). Ratings outside
 * 1–5 are ignored defensively; the DB already constrains them, so in practice
 * every row counts. No review is ever invented: an empty list is an honest 0.
 */
export function reviewStats(reviews: Pick<Review, 'rating'>[]): ReviewStats {
  const distribution: Record<StarBucket, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
  let sum = 0
  let count = 0
  for (const { rating } of reviews) {
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      distribution[rating as StarBucket] += 1
      sum += rating
      count += 1
    }
  }
  const average = count === 0 ? 0 : Math.round((sum / count) * 10) / 10
  return { count, average, distribution }
}
