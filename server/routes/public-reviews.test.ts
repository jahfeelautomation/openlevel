import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { ContactsRepo } from '../repos/contacts-repo'
import { ReviewRequestsRepo } from '../repos/review-requests-repo'
import { publicReviewsRoute } from './public-reviews'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location + contact + a pending review request, so a public GET/submit
// exercises the whole collect → store → mark-completed loop against real SQL
// (including the reviews.rating 1–5 CHECK and the FK back to the request).
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query('INSERT INTO locations (id, name, slug, branding) VALUES ($1,$2,$3,$4)', [
    loc,
    'Jamal — Cash Offers',
    'jamal',
    { color: '#4f46e5' },
  ])

  const contact = await new ContactsRepo(db, loc).upsertByMatch(
    { name: 'Marcus Webb', phone: '+16785550142' },
    'seed',
  )
  const request = await new ReviewRequestsRepo(db, loc).create({
    contactId: contact.id,
    token: 'tok_demo',
  })

  const app = new Hono<AppEnv>()
  app.route('/', publicReviewsRoute({ db }))
  return { db, loc, app, contactId: contact.id, requestId: request.id, token: 'tok_demo' }
}

test('GET /:loc/:token renders the star-rating page, prefilled with the contact name', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/tok_demo')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('How did we do?')
  expect(html).toContain('Jamal — Cash Offers')
  expect(html).toContain('name="rating"') // star radios present
  expect(html).toContain('action="/api/public/reviews/loc_test/tok_demo/submit"')
  expect(html).toContain('value="Marcus Webb"') // name prefilled from the contact
})

test('GET /:loc/:token is a styled html 404 for an unknown token', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('text/html')
  expect((await res.text()).toLowerCase()).toContain('not found')
})

test('GET /:loc/:token shows an "already shared" page once the request is completed', async () => {
  const { app, db, loc, requestId } = await setup()
  await new ReviewRequestsRepo(db, loc).markCompleted(requestId)

  const res = await app.request('/loc_test/tok_demo')
  expect(res.status).toBe(200)
  expect((await res.text()).toLowerCase()).toContain('already shared')
})

test('POST submit stores the review, links it, marks the request completed, logs timeline', async () => {
  const { app, db, contactId, requestId } = await setup()

  const res = await app.request('/loc_test/tok_demo/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 5, body: 'Fast and fair — closed in a week.', name: 'Marcus Webb' }),
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })

  // The review is stored with exactly what was entered, linked to contact + request.
  const reviews = await db.query<{
    rating: number
    body: string
    reviewer_name: string
    contact_id: string
    request_id: string
    source: string
    status: string
  }>('SELECT rating, body, reviewer_name, contact_id, request_id, source, status FROM reviews WHERE location_id=$1', [
    'loc_test',
  ])
  expect(reviews.length).toBe(1)
  expect(reviews[0]?.rating).toBe(5)
  expect(reviews[0]?.body).toBe('Fast and fair — closed in a week.')
  expect(reviews[0]?.reviewer_name).toBe('Marcus Webb')
  expect(reviews[0]?.contact_id).toBe(contactId)
  expect(reviews[0]?.request_id).toBe(requestId)
  expect(reviews[0]?.source).toBe('direct')
  expect(reviews[0]?.status).toBe('published')

  // The request is now completed — drives an honest response rate.
  const [request] = await db.query<{ status: string; completed_at: string | null }>(
    'SELECT status, completed_at FROM review_requests WHERE id=$1',
    [requestId],
  )
  expect(request?.status).toBe('completed')
  expect(request?.completed_at).toBeTruthy()

  // A timeline event was logged for the contact.
  const timeline = await db.query<{ type: string }>('SELECT type FROM timeline_events WHERE contact_id=$1', [
    contactId,
  ])
  expect(timeline.some((t) => t.type === 'review_received')).toBe(true)
})

test('POST submit keeps an empty comment as null, not an empty string', async () => {
  const { app, db } = await setup()
  const res = await app.request('/loc_test/tok_demo/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 4, body: '   ', name: '' }),
  })
  expect(res.status).toBe(200)
  const [review] = await db.query<{ body: string | null; reviewer_name: string | null }>(
    'SELECT body, reviewer_name FROM reviews WHERE location_id=$1',
    ['loc_test'],
  )
  expect(review?.body).toBeNull()
  expect(review?.reviewer_name).toBeNull()
})

test('POST submit rejects a rating outside 1–5 (400)', async () => {
  const { app } = await setup()
  for (const rating of [0, 6]) {
    const res = await app.request('/loc_test/tok_demo/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    })
    expect(res.status).toBe(400)
  }
})

test('POST submit is 404 for an unknown token', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 5 }),
  })
  expect(res.status).toBe(404)
})

test('POST submit twice is rejected — a completed link can not leave a second review', async () => {
  const { app, db } = await setup()
  const first = await app.request('/loc_test/tok_demo/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 5 }),
  })
  expect(first.status).toBe(200)

  const second = await app.request('/loc_test/tok_demo/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 1 }),
  })
  expect(second.status).toBe(404)

  // Only the first review exists.
  const reviews = await db.query<{ rating: number }>('SELECT rating FROM reviews WHERE location_id=$1', ['loc_test'])
  expect(reviews.length).toBe(1)
  expect(reviews[0]?.rating).toBe(5)
})
