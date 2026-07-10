import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { BlogPostsRepo } from '../repos/blog-posts-repo'
import { publicBlogRoute } from './public-blog'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location with a published post (long enough to derive a 2-minute read),
// a second published post, and a draft — so the public index/post routes run
// against real SQL and prove drafts never surface.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query('INSERT INTO locations (id, name, slug, branding) VALUES ($1,$2,$3,$4)', [
    loc,
    'Alex — Cash Offers',
    'Alex',
    { color: '#4f46e5' },
  ])

  const repo = new BlogPostsRepo(db, loc)
  // ~250 words → ceil(250/200) = 2 min read, derived not stored.
  const longBody = Array.from({ length: 250 }, () => 'word').join(' ')
  const live = await repo.create({
    title: 'How We Buy Houses For Cash',
    slug: 'buy-houses-cash',
    excerpt: 'The cash offer process, start to finish.',
    body: longBody,
    author: 'Alex',
    status: 'published',
  })
  const live2 = await repo.create({
    title: 'Avoiding Foreclosure',
    slug: 'avoiding-foreclosure',
    body: 'Short post.',
    status: 'published',
  })
  const draft = await repo.create({
    title: 'Secret Unpublished Draft',
    slug: 'secret-draft',
    body: 'Not for the public yet.',
    status: 'draft',
  })

  const app = new Hono<AppEnv>()
  app.route('/', publicBlogRoute({ db }))
  return { db, loc, app, live, live2, draft }
}

test('GET /:loc renders the branded index of published posts with a derived read time', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('Alex — Cash Offers')
  expect(html).toContain('How We Buy Houses For Cash')
  expect(html).toContain('Avoiding Foreclosure')
  expect(html).toContain('/api/public/blog/loc_test/buy-houses-cash')
  // 250 words at 200 wpm → 2 min, computed by the route, never stored.
  expect(html).toContain('2 min read')
})

test('GET /:loc never lists a draft', async () => {
  const { app } = await setup()
  const html = await (await app.request('/loc_test')).text()
  expect(html).not.toContain('Secret Unpublished Draft')
  expect(html).not.toContain('secret-draft')
})

test('GET /:loc is an honest empty state for a location with no published posts', async () => {
  const { app, db } = await setup()
  await db.query("INSERT INTO locations (id, name, slug, branding) VALUES ('loc_empty','Empty Co','empty','{}')")
  const html = await (await app.request('/loc_empty')).text()
  expect(html).toContain('No posts published yet')
})

test('GET /:loc/:slug renders a published post with its body, author and date', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/buy-houses-cash')

  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain('How We Buy Houses For Cash')
  expect(html).toContain('Alex')
  expect(html).toContain('2 min read')
  // Back link to the index.
  expect(html).toContain('href="/api/public/blog/loc_test"')
})

test('GET /:loc/:slug is a styled html 404 for a draft slug (a draft never leaks)', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/secret-draft')
  expect(res.status).toBe(404)
  const html = await res.text()
  expect(html.toLowerCase()).toContain('not found')
  expect(html).not.toContain('Secret Unpublished Draft')
})

test('GET /:loc/:slug is a styled html 404 for an unknown slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/no-such-post')
  expect(res.status).toBe(404)
  expect((await res.text()).toLowerCase()).toContain('not found')
})

test('a slug is scoped to its location — another location cannot read it', async () => {
  const { app, db } = await setup()
  await db.query("INSERT INTO locations (id, name, slug, branding) VALUES ('loc_other','Other Co','other','{}')")
  const res = await app.request('/loc_other/buy-houses-cash')
  expect(res.status).toBe(404)
})

