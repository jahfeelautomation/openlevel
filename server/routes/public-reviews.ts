import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { renderReviewDone, renderReviewNotFound, renderReviewPage } from '../lib/review-page'
import { ContactsRepo } from '../repos/contacts-repo'
import { LocationsRepo } from '../repos/locations-repo'
import { ReviewRequestsRepo } from '../repos/review-requests-repo'
import { ReviewsRepo } from '../repos/reviews-repo'
import { TimelineRepo } from '../repos/timeline-repo'

const submitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().max(4000).optional().default(''),
  name: z.string().max(200).optional().default(''),
})

/**
 * Public, UNAUTHENTICATED review capture — mounted at `/api/public/reviews`
 * BEFORE the operatorAuth boundary, reading the location from the URL (`:loc`)
 * and the request from its unguessable `:token`:
 *
 *   GET  /:loc/:token         → the star-rating page (or a styled 404 / "already done")
 *   POST /:loc/:token/submit  → capture the review, mark the request completed
 *
 * The submit stores exactly what the customer entered (rating 1–5, optional
 * comment, name), links it to the contact we asked, and logs a timeline event.
 * It never invents a review and never gates by rating — every rating is captured
 * the same way, which is both honest and what Google's policies require.
 */
export function publicReviewsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** Display name + branding color for the location, for the rendered pages. */
  async function locationMeta(loc: string): Promise<{ name: string; brandColor?: string }> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return {
      name: location?.name ?? 'us',
      brandColor: typeof color === 'string' ? color : undefined,
    }
  }

  app.get('/:loc/:token', async (c) => {
    const loc = c.req.param('loc')
    const token = c.req.param('token')
    const request = await new ReviewRequestsRepo(deps.db, loc).getByToken(token)
    if (!request) return c.html(renderReviewNotFound(), 404)

    const meta = await locationMeta(loc)
    if (request.status === 'completed') {
      return c.html(
        renderReviewDone({
          businessName: meta.name,
          brandColor: meta.brandColor,
          message: "You've already shared your feedback — thank you!",
        }),
      )
    }

    // Prefill the name from the contact we asked, if we know them.
    let reviewerName: string | null = null
    if (request.contact_id) {
      const contact = await new ContactsRepo(deps.db, loc).get(request.contact_id)
      reviewerName = contact?.name ?? null
    }
    return c.html(
      renderReviewPage(request, {
        businessName: meta.name,
        brandColor: meta.brandColor,
        reviewerName,
      }),
    )
  })

  app.post('/:loc/:token/submit', zValidator('json', submitSchema), async (c) => {
    const loc = c.req.param('loc')
    const token = c.req.param('token')
    const { rating, body, name } = c.req.valid('json')

    const requestsRepo = new ReviewRequestsRepo(deps.db, loc)
    const request = await requestsRepo.getByToken(token)
    // A missing or already-completed link can't be submitted (no double reviews).
    if (!request || request.status === 'completed') return c.json({ error: 'not found' }, 404)

    const review = await new ReviewsRepo(deps.db, loc).create({
      contactId: request.contact_id,
      requestId: request.id,
      rating,
      body: body.trim() || null,
      reviewerName: name.trim() || null,
      source: 'direct',
    })
    await requestsRepo.markCompleted(request.id)

    if (request.contact_id) {
      await new TimelineRepo(deps.db, loc).add({
        contactId: request.contact_id,
        type: 'review_received',
        refTable: 'reviews',
        refId: review.id,
        payload: { rating },
      })
    }

    return c.json({ ok: true })
  })

  return app
}
