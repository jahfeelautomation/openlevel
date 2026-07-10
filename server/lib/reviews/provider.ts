/**
 * Review sync provider contracts (Module 51). Same shape discipline as
 * lib/social: tiny interfaces, adapters own the HTTP, the resolver owns
 * settings + secret names. Reviews come IN from the platforms the location
 * already earned them on (Google Business Profile, the Facebook Page) — the
 * sync only mirrors what customers really wrote, it never fabricates feedback.
 */

/** One review as the platform reported it, normalized for the reviews table. */
export interface ExternalReview {
  /** The platform's own stable id — what dedups a re-sync into an update. */
  externalId: string
  /** Stars 1–5, already mapped from the platform's vocabulary. */
  rating: number
  body: string | null
  reviewerName: string | null
  /** The platform's own timestamp (ISO-ish), kept so imports sort honestly. */
  createdAt: string | null
}

export interface ReviewSource {
  /** The reviews.source value rows from this adapter carry ('google'/'facebook'). */
  source: string
  /** Fetch every review the platform will hand us, mapped + paginated. */
  fetchReviews(): Promise<ExternalReview[]>
}
