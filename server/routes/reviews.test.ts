import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import type { resolveReviewSource } from '../lib/reviews/resolve'
import { reviewsRoute } from './reviews'

function harness(
  db: FakeDatabase,
  locationId = 'locA',
  extra: Partial<Parameters<typeof reviewsRoute>[0]> = {},
) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', reviewsRoute({ db, ...extra }))
  return app
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / returns reviews, pending requests, and an honest derived stats block', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv2', rating: 5 }, { id: 'rv1', rating: 4 }]) // reviews list, newest first
  db.enqueue([{ id: 'rq1', status: 'pending' }]) // requests list
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    reviews: { id: string }[]
    requests: { id: string }[]
    stats: { count: number; average: number; distribution: Record<string, number> }
  }
  expect(body.reviews).toHaveLength(2)
  expect(body.requests).toHaveLength(1)
  // stats are derived from the real rows, never read from a stored column.
  expect(body.stats.count).toBe(2)
  expect(body.stats.average).toBe(4.5)
  expect(body.stats.distribution['5']).toBe(1)
  expect(body.stats.distribution['4']).toBe(1)
  expect(db.calls[0]?.params).toEqual(['locA']) // reviews scoped
  expect(db.calls[1]?.params).toEqual(['locA']) // requests scoped
})

test('GET / on a location with no reviews is an honest zero, not a fabricated number', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // no reviews
  db.enqueue([]) // no requests
  const res = await harness(db).request('/')

  const body = (await res.json()) as { stats: { count: number; average: number } }
  expect(body.stats.count).toBe(0)
  expect(body.stats.average).toBe(0)
})

test('POST /request mints a tokenized link, stores the request, logs a timeline event (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rq_new', location_id: 'locA', contact_id: 'c1', token: 'tok_seed', channel: 'sms', status: 'pending' }])
  const res = await jsonReq(harness(db), '/request', 'POST', { contactId: 'c1' })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: boolean; request: { id: string }; link: string }
  expect(body.ok).toBe(true)
  expect(body.request.id).toBe('rq_new')
  // The shareable link points at the public, unauthenticated page for this token.
  expect(body.link).toBe('/api/public/reviews/locA/tok_seed')

  // create is scoped ($1=location), defaults channel, and mints a real token.
  const create = db.calls[0]
  expect(create?.sql).toMatch(/INSERT INTO review_requests/i)
  expect(create?.params?.[0]).toBe('locA')
  expect(create?.params).toContain('c1')
  expect(create?.params).toContain('sms')
  const token = create?.params?.find(
    (p) => typeof p === 'string' && p.length >= 12 && !['locA', 'c1', 'sms'].includes(p),
  )
  expect(typeof token).toBe('string') // a generated nanoid, not a guessable value

  // a review_request timeline event is logged against the contact
  const event = db.calls[1]
  expect(event?.sql).toMatch(/INSERT INTO timeline_events/i)
  expect(event?.params?.[1]).toBe('locA')
  expect(event?.params?.[2]).toBe('c1')
  expect(event?.params).toContain('review_request')
})

test('POST /request without a contact still mints a generic link and logs nothing', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rq_anon', location_id: 'locA', contact_id: null, token: 'tok_anon', channel: 'sms', status: 'pending' }])
  const res = await jsonReq(harness(db), '/request', 'POST', {})

  expect(res.status).toBe(201)
  const body = (await res.json()) as { link: string }
  expect(body.link).toBe('/api/public/reviews/locA/tok_anon')
  expect(db.calls).toHaveLength(1) // only the insert — no timeline event without a contact
})

test('POST /request rejects an empty contactId (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/request', 'POST', { contactId: '' })
  expect(res.status).toBe(400)
})

test('POST /sync imports from connected sources and reports unconnected ones honestly (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv_g1', location_id: 'locA', inserted: true }])
  const resolveReviews: typeof resolveReviewSource = async (_db, _loc, source) =>
    source === 'google'
      ? {
          ok: true,
          reviewSource: {
            source: 'google',
            fetchReviews: async () => [
              { externalId: 'gr_1', rating: 5, body: 'A+', reviewerName: 'M', createdAt: null },
            ],
          },
        }
      : { ok: false, reason: 'facebook page id is not configured' }
  const res = await harness(db, 'locA', { resolveReviews }).request('/sync', { method: 'POST' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    results: [
      { source: 'google', ok: true, imported: 1, updated: 0 },
      { source: 'facebook', ok: false, reason: 'facebook page id is not configured' },
    ],
  })
  expect(db.calls[0]?.params?.[0]).toBe('locA') // the upsert is scoped to the location
})

test('GET /sync/status reports per-source connection without fetching anything', async () => {
  const db = new FakeDatabase()
  const resolveReviews: typeof resolveReviewSource = async (_db, _loc, source) =>
    source === 'google'
      ? { ok: true, reviewSource: { source: 'google', fetchReviews: async () => [] } }
      : { ok: false, reason: 'facebook page token is not configured' }
  const res = await harness(db, 'locA', { resolveReviews }).request('/sync/status')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    google: { connected: true },
    facebook: { connected: false, reason: 'facebook page token is not configured' },
  })
  expect(db.calls).toHaveLength(0) // a status read never imports
})

test('PATCH /:id hides a review for moderation, scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv1', status: 'hidden' }])
  const res = await jsonReq(harness(db), '/rv1', 'PATCH', { status: 'hidden' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, review: { status: 'hidden' } })
  expect(db.calls[0]?.sql).toMatch(/SET status=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'hidden', 'rv1'])
})

test('PATCH /:id is 404 when the review is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // setStatus RETURNING -> none
  const res = await jsonReq(harness(db), '/missing', 'PATCH', { status: 'published' })
  expect(res.status).toBe(404)
})

test('PATCH /:id rejects an invalid status (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/rv1', 'PATCH', { status: 'bogus' })
  expect(res.status).toBe(400)
})
