import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type ReviewStatus = 'published' | 'hidden'

export interface Review {
  id: string
  location_id: string
  contact_id: string | null
  request_id: string | null
  rating: number
  body: string | null
  reviewer_name: string | null
  source: string
  status: string
  /** The platform's own review id for imports ('google'/'facebook'); NULL for
   *  direct reviews. What lets a re-sync update instead of duplicate. */
  external_id: string | null
  created_at: string
}

export interface ReviewInput {
  contactId?: string | null
  requestId?: string | null
  rating: number
  body?: string | null
  reviewerName?: string | null
  /** Where the review came from. 'direct' (our public page) by default; the
   *  column also supports 'google'/'facebook' for a future honest import path. */
  source?: string
  status?: ReviewStatus
}

/** One review as review sync hands it over (Module 51) — already normalized
 *  by the platform adapter. */
export interface ExternalReviewInput {
  source: string
  externalId: string
  rating: number
  body?: string | null
  reviewerName?: string | null
  /** The platform's own timestamp; falls back to now() at first insert. */
  createdAt?: string | null
}

/**
 * Star reviews for one location. A review is immutable feedback — only its
 * `status` changes (published ↔ hidden) for moderation. The headline average is
 * never stored on a row; it is derived from `rating` across rows in
 * review-math.ts, so the figure can't drift and can't be quietly inflated.
 * Hiding a review removes it from a future public widget but does not change the
 * true average the operator sees. No method writes a fabricated review.
 */
export class ReviewsRepo extends LocationScopedRepo {
  list(): Promise<Review[]> {
    return this.scopedSelect<Review>('SELECT * FROM reviews ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Review | undefined> {
    const rows = await this.scopedSelect<Review>('SELECT * FROM reviews WHERE id=$2', [id])
    return rows[0]
  }

  async create(input: ReviewInput): Promise<Review> {
    const id = nanoid()
    const rows = await this.scopedWrite<Review>(
      `INSERT INTO reviews
         (id, location_id, contact_id, request_id, rating, body, reviewer_name, source, status)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id,
        input.contactId ?? null,
        input.requestId ?? null,
        input.rating,
        input.body ?? null,
        input.reviewerName ?? null,
        input.source ?? 'direct',
        input.status ?? 'published',
      ],
    )
    return rows[0]!
  }

  /** One imported review on its way in from review sync (Module 51): insert it,
   *  or — when the same (source, external_id) already landed in this location —
   *  refresh what the platform reported. Deliberately NOT refreshed: `status`,
   *  so an operator's moderation (hide spam) survives every re-sync, and
   *  `created_at`, which keeps the platform's own timestamp from the first
   *  import so the list sorts honestly. Single statement — no TOCTOU window. */
  async upsertExternal(input: ExternalReviewInput): Promise<{ review: Review; inserted: boolean }> {
    const id = nanoid()
    const rows = await this.scopedWrite<Review & { inserted: boolean }>(
      `INSERT INTO reviews
         (id, location_id, contact_id, request_id, rating, body, reviewer_name, source, status, external_id, created_at)
       VALUES ($2,$1,NULL,NULL,$3,$4,$5,$6,'published',$7,COALESCE($8::timestamptz, now()))
       ON CONFLICT (location_id, source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET rating=EXCLUDED.rating, body=EXCLUDED.body, reviewer_name=EXCLUDED.reviewer_name
       RETURNING *, (xmax = 0) AS inserted`,
      [
        id,
        input.rating,
        input.body ?? null,
        input.reviewerName ?? null,
        input.source,
        input.externalId,
        input.createdAt ?? null,
      ],
    )
    const { inserted, ...review } = rows[0]!
    return { review: review as Review, inserted }
  }

  /** Moderation toggle: hide spam/abuse from a future public widget, or restore
   *  it. Never alters `rating`, so the derived average reflects what was felt. */
  async setStatus(id: string, status: ReviewStatus): Promise<Review | undefined> {
    const rows = await this.scopedWrite<Review>(
      `UPDATE reviews SET status=$2 WHERE location_id=$1 AND id=$3 RETURNING *`,
      [status, id],
    )
    return rows[0]
  }
}
