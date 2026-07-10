import type { ExternalReview, ReviewSource } from './provider'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

/** The ratings fields we ask the Graph API for, pinned so the mapping below
 *  always sees the same shape. */
const RATING_FIELDS = 'review_text,rating,recommendation_type,created_time,reviewer,open_graph_story'

/** Hard stop for pagination — a stuck cursor must not spin forever. */
const MAX_PAGES = 10

export interface FacebookReviewsConfig {
  /** The Facebook Page id — the SAME one the location publishes as. */
  pageId: string
  /** The LOCATION's own Page access token — resolved by name, never stored here. */
  accessToken: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

interface FacebookRatingRow {
  review_text?: string
  rating?: number
  recommendation_type?: string
  created_time?: string
  reviewer?: { name?: string; id?: string }
  open_graph_story?: { id?: string }
}

/** Modern Facebook "reviews" are recommendations without stars; map them to the
 *  honest extremes (recommended = 5, not recommended = 1) and skip anything else. */
function ratingOf(row: FacebookRatingRow): number | undefined {
  if (typeof row.rating === 'number' && row.rating >= 1 && row.rating <= 5) return row.rating
  if (row.recommendation_type === 'positive') return 5
  if (row.recommendation_type === 'negative') return 1
  return undefined
}

/** The story id is the stable identity; reviewer id + timestamp is the fallback.
 *  A row with neither can't be deduped on a re-sync, so it is skipped. */
function identityOf(row: FacebookRatingRow): string | undefined {
  if (row.open_graph_story?.id) return row.open_graph_story.id
  if (row.reviewer?.id && row.created_time) return `${row.reviewer.id}:${row.created_time}`
  return undefined
}

/**
 * Facebook Page review source. Reads the page's ratings/recommendations through
 * the Graph API with the SAME page id + token the location already connected
 * for publishing — one connection, both directions. The token rides in the
 * Authorization header — never the URL, which lands in proxy logs.
 */
export function createFacebookReviewsSource(config: FacebookReviewsConfig): ReviewSource {
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    source: 'facebook',

    async fetchReviews(): Promise<ExternalReview[]> {
      const base = `${GRAPH_BASE}/${config.pageId}/ratings?fields=${RATING_FIELDS}&limit=100`
      const out: ExternalReview[] = []
      let after: string | undefined

      for (let page = 0; page < MAX_PAGES; page++) {
        const url = after ? `${base}&after=${encodeURIComponent(after)}` : base
        const res = await fetchImpl(url, {
          headers: { authorization: `Bearer ${config.accessToken}` },
        })
        // The token must never ride along on the error (it would land in logs).
        if (!res.ok) throw new Error(`facebook reviews fetch failed: ${res.status}`)
        const data = (await res.json()) as {
          data?: FacebookRatingRow[]
          paging?: { cursors?: { after?: string }; next?: string }
        }

        for (const row of data.data ?? []) {
          const rating = ratingOf(row)
          const externalId = identityOf(row)
          if (!rating || !externalId) continue
          out.push({
            externalId,
            rating,
            body: row.review_text ?? null,
            reviewerName: row.reviewer?.name ?? null,
            createdAt: row.created_time ?? null,
          })
        }

        // Facebook includes cursors even on the last page; `next` is the
        // honest "there is more" signal.
        after = data.paging?.next ? data.paging?.cursors?.after : undefined
        if (!after) break
      }

      return out
    },
  }
}
