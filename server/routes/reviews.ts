import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { reviewStats } from '../lib/review-math'
import { REVIEW_SYNC_SOURCES, resolveReviewSource } from '../lib/reviews/resolve'
import { syncReviews } from '../lib/reviews/review-sync'
import { ReviewRequestsRepo } from '../repos/review-requests-repo'
import { ReviewsRepo } from '../repos/reviews-repo'
import { TimelineRepo } from '../repos/timeline-repo'

// Where the public review page is served (see index.ts: app.route('/api/public/reviews', ...)).
// The operator UI shows this as the shareable link to send a customer.
const PUBLIC_REVIEW_BASE = '/api/public/reviews'

const requestSchema = z.object({
  contactId: z.string().min(1).nullish(),
  /** Outreach channel label for the operator's own record — sms by default. */
  channel: z.string().min(1).optional(),
})

const patchSchema = z.object({
  status: z.enum(['published', 'hidden']),
})

/**
 * Reputation for the current location. Mounted behind operatorAuth + locationAccess.
 * The Reputation UI reads GET / for the reviews list, the pending requests, and a
 * stats block (average + star distribution) that is DERIVED from the review rows
 * in review-math.ts — never a stored, driftable number. An empty location returns
 * an honest zero.
 *
 *   POST /request  → mint a tokenized public link to ask a contact for a review
 *                    (logs a review_request timeline event)
 *   PATCH /:id     → moderation only: publish ↔ hide a review. This never changes
 *                    the rating, so hiding spam can't quietly inflate the average.
 *
 *   POST /sync     → mirror in the reviews customers really left on the
 *                    location's Google Business Profile / Facebook Page
 *                    (Module 51). Per-source honesty: an unconnected platform
 *                    reports its reason, never a fake zero-success.
 *   GET /sync/status → which sources would sync right now, with reasons.
 *
 * Nothing here writes a review the customer didn't — reviews arrive through the
 * customer's own submission on the public page, or mirrored verbatim from the
 * platforms they posted on. OpenLevel never fabricates feedback.
 */
export function reviewsRoute(deps: {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolver. */
  resolveReviews?: typeof resolveReviewSource
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const resolveReviews = deps.resolveReviews ?? resolveReviewSource

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const reviews = await new ReviewsRepo(deps.db, loc).list()
    const requests = await new ReviewRequestsRepo(deps.db, loc).list()
    return c.json({ reviews, requests, stats: reviewStats(reviews) })
  })

  app.post('/request', zValidator('json', requestSchema), async (c) => {
    const loc = c.get('locationId')
    const { contactId, channel } = c.req.valid('json')
    const repo = new ReviewRequestsRepo(deps.db, loc)
    const request = await repo.create({
      contactId: contactId ?? null,
      channel,
      token: nanoid(),
    })

    if (request.contact_id) {
      await new TimelineRepo(deps.db, loc).add({
        contactId: request.contact_id,
        type: 'review_request',
        refTable: 'review_requests',
        refId: request.id,
        payload: { channel: request.channel },
      })
    }

    return c.json({ ok: true, request, link: `${PUBLIC_REVIEW_BASE}/${loc}/${request.token}` }, 201)
  })

  // Review sync (Module 51). 200 always — the honesty lives per source inside
  // `results`, so one unconnected platform never masks the other's real import.
  app.post('/sync', async (c) => {
    const loc = c.get('locationId')
    const results = await syncReviews({ db: deps.db, resolveSource: resolveReviews }, loc)
    return c.json({ ok: true, results })
  })

  // Which sources WOULD sync right now. Resolves config + vault keys only —
  // never calls a platform, never writes a row.
  app.get('/sync/status', async (c) => {
    const loc = c.get('locationId')
    const entries = await Promise.all(
      REVIEW_SYNC_SOURCES.map(async (source) => {
        const r = await resolveReviews(deps.db, loc, source)
        return [source, r.ok ? { connected: true } : { connected: false, reason: r.reason }] as const
      }),
    )
    return c.json(Object.fromEntries(entries))
  })

  app.patch('/:id', zValidator('json', patchSchema), async (c) => {
    const loc = c.get('locationId')
    const review = await new ReviewsRepo(deps.db, loc).setStatus(c.req.param('id'), c.req.valid('json').status)
    if (!review) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, review })
  })

  return app
}
