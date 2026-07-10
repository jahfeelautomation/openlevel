import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { blogRoute } from './blog'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location behind a middleware that sets the operator context the way
// operatorAuth + locationAccess do in production. Assertions run against real
// Postgres (pglite) so the unique-slug index and the first-publish stamp are
// genuinely exercised, and the derived read time is proven to track the body.
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

  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', loc)
    await next()
  })
  app.route('/', blogRoute({ db }))
  return { db, loc, app }
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

type PostShape = {
  id: string
  slug: string
  status: string
  published_at: string | null
  readingMinutes: number
  link: string
}

async function createPost(app: Hono<AppEnv>, body: Record<string, unknown>) {
  const res = await jsonReq(app, '/', 'POST', body)
  return (await res.json()) as { ok: boolean; post: PostShape }
}

test('POST / creates a draft post and derives a slug from the title', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/', 'POST', { title: 'How We Buy Houses For Cash' })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: boolean; post: PostShape }
  expect(body.ok).toBe(true)
  expect(body.post.slug).toBe('how-we-buy-houses-for-cash')
  expect(body.post.status).toBe('draft') // unpublished until the operator says so
  expect(body.post.published_at).toBeNull() // a draft has no live date
  expect(body.post.link).toBe('/api/public/blog/loc_test/how-we-buy-houses-for-cash')
})

test('POST / keeps slugs unique within the location', async () => {
  const { app } = await setup()
  const a = await createPost(app, { title: 'Cash Offers' })
  const b = await createPost(app, { title: 'Cash Offers' })
  expect(a.post.slug).toBe('cash-offers')
  expect(b.post.slug).not.toBe(a.post.slug)
  expect(b.post.slug.startsWith('cash-offers-')).toBe(true) // a suffix keeps the public URL collision-free
})

test('POST / can publish on create, stamping the live date', async () => {
  const { app } = await setup()
  const { post } = await createPost(app, { title: 'Launch Day', status: 'published' })
  expect(post.status).toBe('published')
  expect(post.published_at).toBeTruthy()
})

test('GET / lists posts with a derived read time and a public link', async () => {
  const { app } = await setup()
  const longBody = Array.from({ length: 250 }, () => 'word').join(' ') // ~2 min at 200 wpm
  const created = await createPost(app, { title: 'The Long Read', body: longBody })

  const res = await jsonReq(app, '/', 'GET')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { posts: PostShape[] }
  const row = body.posts.find((p) => p.id === created.post.id)
  expect(row?.readingMinutes).toBe(2) // derived from the body, not stored
  expect(row?.link).toBe(`/api/public/blog/loc_test/${created.post.slug}`)
})

test('GET /:id returns one post with its derived read time', async () => {
  const { app } = await setup()
  const { post } = await createPost(app, { title: 'Short One', body: 'just a few words here' })
  const res = await jsonReq(app, `/${post.id}`, 'GET')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { post: PostShape }
  expect(body.post.id).toBe(post.id)
  expect(body.post.readingMinutes).toBe(1) // a short non-empty post floors to 1
})

test('GET /:id is 404 for an unknown post', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/nope', 'GET')).status).toBe(404)
})

test('PATCH /:id publishes a post and stamps published_at', async () => {
  const { app, db } = await setup()
  const { post } = await createPost(app, { title: 'Draft Then Live' })
  const res = await jsonReq(app, `/${post.id}`, 'PATCH', { status: 'published' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, post: { status: 'published' } })

  const [row] = await db.query<{ published_at: string | null }>(
    'SELECT published_at FROM blog_posts WHERE id=$1',
    [post.id],
  )
  expect(row?.published_at).toBeTruthy()
})

test('PATCH /:id re-derives the read time when the body changes — never a stored figure', async () => {
  const { app } = await setup()
  const longBody = Array.from({ length: 250 }, () => 'word').join(' ')
  const { post } = await createPost(app, { title: 'Edited', body: longBody })

  const trimmed = (await (await jsonReq(app, `/${post.id}`, 'PATCH', { body: 'now just a sentence' })).json()) as {
    post: PostShape
  }
  expect(trimmed.post.readingMinutes).toBe(1) // shrinks with the real body
})

test('PATCH /:id is 404 for an unknown post', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/nope', 'PATCH', { title: 'x' })).status).toBe(404)
})

test('DELETE /:id removes a post', async () => {
  const { app } = await setup()
  const { post } = await createPost(app, { title: 'Temporary' })
  expect((await jsonReq(app, `/${post.id}`, 'DELETE')).status).toBe(200)
  expect((await jsonReq(app, `/${post.id}`, 'GET')).status).toBe(404)
})

test('DELETE /:id is 404 for an unknown post', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/nope', 'DELETE')).status).toBe(404)
})
