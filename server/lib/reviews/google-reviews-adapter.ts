import type { ExternalReview, ReviewSource } from './provider'

const GBP_BASE = 'https://mybusiness.googleapis.com/v4'

/** Google's review payload spells stars as words; anything else is unmappable. */
const STAR_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

/** Hard stop for pagination — a stuck nextPageToken must not spin forever. */
const MAX_PAGES = 10

export interface GoogleReviewsConfig {
  /** The Business Profile account id (non-secret, lives in settings.social). */
  accountId: string
  /** Google's OWN location id for the listing (their concept, not ours). */
  locationId: string
  /** The LOCATION's own OAuth token — resolved by name, never stored here. */
  accessToken: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

interface GoogleReviewRow {
  reviewId?: string
  starRating?: string
  comment?: string
  reviewer?: { displayName?: string }
  createTime?: string
}

/**
 * Google Business Profile review source. Reads the listing's reviews through
 * the Business Profile API as the location's own connected account. The token
 * rides in the Authorization header — never the URL, which lands in proxy
 * logs. Rows the API can't vouch for (no stable id, no mappable star word)
 * are skipped rather than guessed at.
 */
export function createGoogleReviewsSource(config: GoogleReviewsConfig): ReviewSource {
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    source: 'google',

    async fetchReviews(): Promise<ExternalReview[]> {
      const base = `${GBP_BASE}/accounts/${config.accountId}/locations/${config.locationId}/reviews`
      const out: ExternalReview[] = []
      let pageToken: string | undefined

      for (let page = 0; page < MAX_PAGES; page++) {
        const url = pageToken ? `${base}?pageToken=${encodeURIComponent(pageToken)}` : base
        const res = await fetchImpl(url, {
          headers: { authorization: `Bearer ${config.accessToken}` },
        })
        // The token must never ride along on the error (it would land in logs).
        if (!res.ok) throw new Error(`google reviews fetch failed: ${res.status}`)
        const data = (await res.json()) as { reviews?: GoogleReviewRow[]; nextPageToken?: string }

        for (const row of data.reviews ?? []) {
          const rating = STAR_WORDS[row.starRating ?? '']
          if (!row.reviewId || !rating) continue
          out.push({
            externalId: row.reviewId,
            rating,
            body: row.comment ?? null,
            reviewerName: row.reviewer?.displayName ?? null,
            createdAt: row.createTime ?? null,
          })
        }

        pageToken = data.nextPageToken
        if (!pageToken) break
      }

      return out
    },
  }
}
