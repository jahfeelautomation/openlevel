import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { AffiliateProgramsRepo } from '../repos/affiliate-programs-repo'
import { AffiliatesRepo } from '../repos/affiliates-repo'
import { publicAffiliatesRoute } from './public-affiliates'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location with a contact, a referral program that sends traffic to a
// landing page, and one affiliate carrying the code MARCUS. Visiting that code
// should record a click (attributed when ?c= names a real contact) and 302 to the
// program's landing URL. The module is self-contained — no workflow, no timeline.
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
    "INSERT INTO contacts (id, location_id, name, first_name) VALUES ('c1',$1,'Dana','Dana')",
    [loc],
  )

  const program = await new AffiliateProgramsRepo(db, loc).create({
    name: 'Partner Program',
    commissionType: 'percent',
    commissionValue: 10,
    landingUrl: 'https://example.test/partner-offer',
  })
  const affiliate = await new AffiliatesRepo(db, loc).create({
    programId: program.id,
    name: 'Sam Smith',
    code: 'MARCUS',
  })

  const app = new Hono<AppEnv>()
  app.route('/', publicAffiliatesRoute({ db }))
  return { db, loc, app, program, affiliate }
}

async function clicks(db: PgliteDatabase, affiliateId: string) {
  return db.query<{ id: string; contact_id: string | null }>(
    'SELECT id, contact_id FROM affiliate_clicks WHERE affiliate_id=$1',
    [affiliateId],
  )
}

test('an anonymous referral visit 302-redirects to the landing URL and records a click', async () => {
  const { db, app, affiliate } = await setup()

  const res = await app.request(`/loc_test/MARCUS`)
  expect(res.status).toBe(302)
  expect(res.headers.get('location')).toBe('https://example.test/partner-offer')

  const rows = await clicks(db, affiliate.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.contact_id).toBeNull() // anonymous — no ?c=
})

test('a referral visit attributed to a real contact records that contact', async () => {
  const { db, app, affiliate } = await setup()

  const res = await app.request(`/loc_test/MARCUS?c=c1`)
  expect(res.status).toBe(302)
  expect(res.headers.get('location')).toBe('https://example.test/partner-offer')

  const rows = await clicks(db, affiliate.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.contact_id).toBe('c1')
})

test('an unknown ?c= is treated as anonymous but still redirects and counts', async () => {
  const { db, app, affiliate } = await setup()

  const res = await app.request(`/loc_test/MARCUS?c=ghost`)
  expect(res.status).toBe(302)

  const rows = await clicks(db, affiliate.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.contact_id).toBeNull() // unknown contact → not attributed, not leaked
})

test('an unknown code 404s and records no click', async () => {
  const { db, app, affiliate } = await setup()

  const res = await app.request(`/loc_test/NOPE`)
  expect(res.status).toBe(404)

  const rows = await clicks(db, affiliate.id)
  expect(rows).toHaveLength(0)
})

test('a paused affiliate 404s and records no click — a turned-off link stops earning', async () => {
  const { db, app, affiliate } = await setup()
  await db.query("UPDATE affiliates SET status='paused' WHERE id=$1", [affiliate.id])

  const res = await app.request(`/loc_test/MARCUS`)
  expect(res.status).toBe(404)
  expect((await res.text()).toLowerCase()).toContain("isn't available")

  const rows = await clicks(db, affiliate.id)
  expect(rows).toHaveLength(0) // no attribution after deactivation
})

test('a paused program 404s every link under it and records no click', async () => {
  const { db, app, affiliate, program } = await setup()
  await db.query("UPDATE affiliate_programs SET status='paused' WHERE id=$1", [program.id])

  const res = await app.request(`/loc_test/MARCUS`)
  expect(res.status).toBe(404)

  const rows = await clicks(db, affiliate.id)
  expect(rows).toHaveLength(0)
})

