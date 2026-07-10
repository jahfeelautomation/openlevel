import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { TriggerLinkClicksRepo } from '../repos/trigger-link-clicks-repo'
import { TriggerLinksRepo } from '../repos/trigger-links-repo'
import { triggerLinksRoute } from './trigger-links'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location behind a middleware that sets the operator context the way
// operatorAuth + locationAccess do in production. Assertions run against real
// Postgres (pglite) so the unique-slug index and the derived-stats aggregate are
// genuinely exercised.
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
  await db.query(
    "INSERT INTO contacts (id, location_id, name, first_name) VALUES ('c1',$1,'Dana','Dana'),('c2',$1,'Reggie','Reggie')",
    [loc],
  )

  // A link with three real clicks: two distinct contacts + one anonymous.
  const links = new TriggerLinksRepo(db, loc)
  const clicks = new TriggerLinkClicksRepo(db, loc)
  const offer = await links.create({
    name: 'Free Cash Offer',
    slug: 'free-offer',
    destinationUrl: 'https://example.test/offer',
  })
  await clicks.record({ linkId: offer.id, contactId: 'c1' })
  await clicks.record({ linkId: offer.id, contactId: 'c2' })
  await clicks.record({ linkId: offer.id, contactId: null })

  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', loc)
    await next()
  })
  app.route('/', triggerLinksRoute({ db }))
  return { db, loc, app, offer }
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

type LinkShape = {
  id: string
  name: string
  slug: string
  destination_url: string
  clicks: number
  contacts: number
  last_clicked_at: string | null
  link: string
}

test('GET / lists links with stats DERIVED from real click rows + a public link', async () => {
  const { app } = await setup()
  const res = await app.request('/')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { links: LinkShape[] }
  expect(body.links).toHaveLength(1)
  const link = body.links[0]!
  expect(link.clicks).toBe(3) // three click rows
  expect(link.contacts).toBe(2) // two DISTINCT identified contacts
  expect(link.last_clicked_at).not.toBeNull()
  expect(link.link).toBe('/api/public/l/loc_test/free-offer')
})

test('POST / creates a link, deriving + de-duping the slug from the name', async () => {
  const { app } = await setup()
  // Same name as the seeded link → slug must not collide.
  const res = await jsonReq(app, '/', 'POST', {
    name: 'Free Cash Offer',
    destinationUrl: 'https://example.test/two',
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: true; link: LinkShape }
  expect(body.ok).toBe(true)
  expect(body.link.slug).not.toBe('free-offer') // de-duped
  expect(body.link.slug.startsWith('free-cash-offer')).toBe(true)
  expect(body.link.clicks).toBe(0) // brand new → honest zero
  expect(body.link.link).toBe(`/api/public/l/loc_test/${body.link.slug}`)
})

test('POST / rejects a non-http(s) destination so the redirect target stays safe', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/', 'POST', {
    name: 'Sketchy',
    destinationUrl: 'javascript:alert(1)',
  })
  expect(res.status).toBe(400)
})

test('GET /:id returns the link with its stats and the recent-click activity feed', async () => {
  const { app, offer } = await setup()
  const res = await app.request(`/${offer.id}`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    link: LinkShape
    clicks: { id: string; contact_id: string | null; contact_name: string | null }[]
  }
  expect(body.link.clicks).toBe(3)
  expect(body.clicks).toHaveLength(3) // newest-first activity feed
  // The feed names known clickers and shows anonymous opens honestly.
  const names = body.clicks.map((c) => c.contact_name)
  expect(names).toContain('Dana')
  expect(names).toContain('Reggie')
  expect(names).toContain(null)
})

test('PATCH /:id edits the destination', async () => {
  const { app, offer } = await setup()
  const res = await jsonReq(app, `/${offer.id}`, 'PATCH', {
    destinationUrl: 'https://example.test/updated',
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: true; link: LinkShape }
  expect(body.link.destination_url).toBe('https://example.test/updated')
  expect(body.link.clicks).toBe(3) // stats survive an edit
})

test('PATCH /:id rejects a non-http(s) destination', async () => {
  const { app, offer } = await setup()
  const res = await jsonReq(app, `/${offer.id}`, 'PATCH', { destinationUrl: 'ftp://x/y' })
  expect(res.status).toBe(400)
})

test('DELETE /:id removes the link', async () => {
  const { app, offer } = await setup()
  const del = await jsonReq(app, `/${offer.id}`, 'DELETE')
  expect(del.status).toBe(200)
  const after = await app.request('/')
  const body = (await after.json()) as { links: LinkShape[] }
  expect(body.links).toHaveLength(0)
})

test('GET /:id 404s for an unknown link', async () => {
  const { app } = await setup()
  const res = await app.request('/nope')
  expect(res.status).toBe(404)
})

