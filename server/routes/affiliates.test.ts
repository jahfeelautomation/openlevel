import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { AffiliateClicksRepo } from '../repos/affiliate-clicks-repo'
import { AffiliateProgramsRepo } from '../repos/affiliate-programs-repo'
import { AffiliateReferralsRepo } from '../repos/affiliate-referrals-repo'
import { AffiliatesRepo } from '../repos/affiliates-repo'
import { affiliatesRoute } from './affiliates'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location behind a middleware that sets the operator context the way
// operatorAuth + locationAccess do in production. Assertions run against real
// Postgres (pglite) so the unique-code index, the correlated-subquery stats (which
// must NOT fan out across the two child tables), and the locked commission are all
// genuinely exercised.
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
  await db.query(
    "INSERT INTO contacts (id, location_id, name, first_name) VALUES ('c1',$1,'Dana','Dana'),('c2',$1,'Reggie','Reggie')",
    [loc],
  )

  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', loc)
    await next()
  })
  app.route('/', affiliatesRoute({ db }))
  return { db, loc, app }
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Stand up a 10%-percent program for the location and return it. */
async function seedProgram(db: PgliteDatabase, loc: string) {
  return new AffiliateProgramsRepo(db, loc).create({
    name: 'Partner Program',
    commissionType: 'percent',
    commissionValue: 10,
    landingUrl: 'https://example.test/partner',
  })
}

type AffiliateShape = {
  id: string
  name: string
  code: string
  status: string
  clicks: number
  referrals: number
  sales_volume_cents: number | string
  commission_cents: number | string
  commission_paid_cents: number | string
  ref_url: string
}

test('GET / is an honest empty manager before a program is set up', async () => {
  const { app } = await setup()
  const res = await app.request('/')
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    program: unknown | null
    affiliates: AffiliateShape[]
    rollup: { affiliates: number; clicks: number; commissionCents: number }
  }
  expect(body.program).toBeNull()
  expect(body.affiliates).toHaveLength(0)
  expect(body.rollup).toMatchObject({ affiliates: 0, clicks: 0, commissionCents: 0 })
})

test('POST /program creates the location program', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/program', 'POST', {
    name: 'Partner Program',
    commissionType: 'percent',
    commissionValue: 10,
    landingUrl: 'https://example.test/partner',
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: true; program: { id: string; name: string } }
  expect(body.ok).toBe(true)
  expect(body.program.name).toBe('Partner Program')
})

test('POST /program rejects a non-http(s) landing URL', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/program', 'POST', {
    name: 'Sketchy',
    landingUrl: 'javascript:alert(1)',
  })
  expect(res.status).toBe(400)
})

test('POST / refuses to add an affiliate before the program exists', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/', 'POST', { name: 'Marcus Webb' })
  expect(res.status).toBe(409)
})

test('POST / adds an affiliate, deriving a code and a hosted referral URL', async () => {
  const { db, loc, app } = await setup()
  await seedProgram(db, loc)
  const res = await jsonReq(app, '/', 'POST', { name: 'Marcus Webb' })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: true; affiliate: AffiliateShape }
  expect(body.affiliate.code).toBe('MARCUSWEBB')
  expect(body.affiliate.ref_url).toBe('/api/public/ref/loc_test/MARCUSWEBB')
  expect(body.affiliate.clicks).toBe(0) // brand new → honest zero
  expect(body.affiliate.referrals).toBe(0)
})

test('POST / de-dupes a colliding code', async () => {
  const { db, loc, app } = await setup()
  await seedProgram(db, loc)
  await jsonReq(app, '/', 'POST', { name: 'Marcus Webb' })
  const res = await jsonReq(app, '/', 'POST', { name: 'Marcus Webb' })
  const body = (await res.json()) as { affiliate: AffiliateShape }
  expect(body.affiliate.code).not.toBe('MARCUSWEBB') // suffix appended
  expect(body.affiliate.code.startsWith('MARCUSWEBB-')).toBe(true)
})

test('GET / reports honest per-affiliate stats with NO join fan-out across clicks + referrals', async () => {
  const { db, loc, app } = await setup()
  const program = await seedProgram(db, loc)
  const affiliate = await new AffiliatesRepo(db, loc).create({
    programId: program.id,
    name: 'Marcus Webb',
    code: 'MARCUS',
  })
  // THREE clicks and TWO referrals. A naive double LEFT JOIN + GROUP BY would
  // multiply these (3×2 = 6 rows) and overstate both counts; correlated subqueries
  // keep each honest.
  const clicks = new AffiliateClicksRepo(db, loc)
  await clicks.record({ affiliateId: affiliate.id, contactId: 'c1' })
  await clicks.record({ affiliateId: affiliate.id, contactId: 'c2' })
  await clicks.record({ affiliateId: affiliate.id, contactId: null })
  const referrals = new AffiliateReferralsRepo(db, loc)
  await referrals.create({ affiliateId: affiliate.id, amountCents: 25_000, commissionCents: 2_500 })
  await referrals.create({ affiliateId: affiliate.id, amountCents: 40_000, commissionCents: 4_000 })

  const res = await app.request('/')
  const body = (await res.json()) as { affiliates: AffiliateShape[]; rollup: { clicks: number; referrals: number; salesVolumeCents: number; commissionCents: number } }
  const a = body.affiliates[0]!
  expect(a.clicks).toBe(3) // not 6
  expect(a.referrals).toBe(2) // not 6
  expect(Number(a.sales_volume_cents)).toBe(65_000) // 25000 + 40000, not doubled
  expect(Number(a.commission_cents)).toBe(6_500)
  // The rollup sums the honest per-affiliate figures.
  expect(body.rollup).toMatchObject({ clicks: 3, referrals: 2, salesVolumeCents: 65_000, commissionCents: 6_500 })
})

test('POST /:id/referrals LOCKS the commission from the program rate', async () => {
  const { db, loc, app } = await setup()
  const program = await seedProgram(db, loc) // 10%
  const affiliate = await new AffiliatesRepo(db, loc).create({
    programId: program.id,
    name: 'Marcus',
    code: 'MARCUS',
  })
  // Record a $250.00 sale → 10% → $25.00 commission, computed server-side.
  const res = await jsonReq(app, `/${affiliate.id}/referrals`, 'POST', { amountCents: 25_000 })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { referral: { amount_cents: number | string; commission_cents: number | string; status: string } }
  expect(Number(body.referral.amount_cents)).toBe(25_000)
  expect(Number(body.referral.commission_cents)).toBe(2_500) // locked, not sent by the client
  expect(body.referral.status).toBe('pending')

  // Editing the program rate afterward must NOT rewrite the locked commission.
  await new AffiliateProgramsRepo(db, loc).update(program.id, { commissionValue: 50 })
  const [row] = await db.query<{ commission_cents: number | string }>(
    'SELECT commission_cents FROM affiliate_referrals WHERE affiliate_id=$1',
    [affiliate.id],
  )
  expect(Number(row?.commission_cents)).toBe(2_500) // still the original 10%
})

test('GET /:id returns the affiliate with referral + click feeds and an honest summary', async () => {
  const { db, loc, app } = await setup()
  const program = await seedProgram(db, loc)
  const affiliate = await new AffiliatesRepo(db, loc).create({
    programId: program.id,
    name: 'Marcus',
    code: 'MARCUS',
  })
  await new AffiliateClicksRepo(db, loc).record({ affiliateId: affiliate.id, contactId: 'c1' })
  await new AffiliateReferralsRepo(db, loc).create({
    affiliateId: affiliate.id,
    contactId: 'c1',
    amountCents: 25_000,
    commissionCents: 2_500,
    status: 'paid',
  })

  const res = await app.request(`/${affiliate.id}`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    affiliate: AffiliateShape
    referrals: { contact_name: string | null }[]
    clicks: { contact_name: string | null }[]
    summary: { referrals: number; commissionCents: number; paidCents: number; owedCents: number; clicks: number; conversionRate: number }
  }
  expect(body.referrals).toHaveLength(1)
  expect(body.referrals[0]?.contact_name).toBe('Dana')
  expect(body.clicks).toHaveLength(1)
  expect(body.summary).toMatchObject({
    referrals: 1,
    commissionCents: 2_500,
    paidCents: 2_500, // the referral is paid
    owedCents: 0,
    clicks: 1,
    conversionRate: 100, // 1 referral / 1 click
  })
})

test('PATCH /:id/referrals/:refId moves a referral through its lifecycle', async () => {
  const { db, loc, app } = await setup()
  const program = await seedProgram(db, loc)
  const affiliate = await new AffiliatesRepo(db, loc).create({
    programId: program.id,
    name: 'Marcus',
    code: 'MARCUS',
  })
  const referral = await new AffiliateReferralsRepo(db, loc).create({
    affiliateId: affiliate.id,
    amountCents: 10_000,
    commissionCents: 1_000,
  })
  const res = await jsonReq(app, `/${affiliate.id}/referrals/${referral.id}`, 'PATCH', {
    status: 'approved',
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { referral: { status: string } }
  expect(body.referral.status).toBe('approved')
})

test('POST /:id/payout settles ONLY approved referrals — pending stays pending until reviewed (GHL behavior)', async () => {
  const { db, loc, app } = await setup()
  const program = await seedProgram(db, loc)
  const affiliate = await new AffiliatesRepo(db, loc).create({
    programId: program.id,
    name: 'Marcus',
    code: 'MARCUS',
  })
  const referrals = new AffiliateReferralsRepo(db, loc)
  const pendingRef = await referrals.create({ affiliateId: affiliate.id, amountCents: 25_000, commissionCents: 2_500 })
  await referrals.create({ affiliateId: affiliate.id, amountCents: 40_000, commissionCents: 4_000, status: 'approved' })

  const res = await jsonReq(app, `/${affiliate.id}/payout`, 'POST')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: true; settledCount: number; paidCents: number }
  expect(body.settledCount).toBe(1) // only the approved row settles
  expect(body.paidCents).toBe(4_000)

  // The pending referral is untouched — it still awaits the operator's review.
  const stillPending = await referrals.get(pendingRef.id)
  expect(stillPending?.status).toBe('pending')
  expect(stillPending?.paid_at).toBeNull()

  // Owed (approved) drains to zero; the pending commission is reported as pending, not owed.
  const detail = await (await app.request(`/${affiliate.id}`)).json()
  expect(detail.summary).toMatchObject({
    commissionCents: 6_500,
    pendingCents: 2_500,
    paidCents: 4_000,
    owedCents: 0,
  })
})

test('POST /:id/payout approves nothing on its own: approve the pending row, pay out again, all settled', async () => {
  const { db, loc, app } = await setup()
  const program = await seedProgram(db, loc)
  const affiliate = await new AffiliatesRepo(db, loc).create({
    programId: program.id,
    name: 'Tanya',
    code: 'TANYA',
  })
  const referrals = new AffiliateReferralsRepo(db, loc)
  const ref = await referrals.create({ affiliateId: affiliate.id, amountCents: 10_000, commissionCents: 1_000 })

  // Paying out while everything is pending settles nothing.
  const first = (await (await jsonReq(app, `/${affiliate.id}/payout`, 'POST')).json()) as {
    settledCount: number
    paidCents: number
  }
  expect(first).toMatchObject({ settledCount: 0, paidCents: 0 })

  // Approve, then pay out — now it settles.
  await jsonReq(app, `/${affiliate.id}/referrals/${ref.id}`, 'PATCH', { status: 'approved' })
  const second = (await (await jsonReq(app, `/${affiliate.id}/payout`, 'POST')).json()) as {
    settledCount: number
    paidCents: number
  }
  expect(second).toMatchObject({ settledCount: 1, paidCents: 1_000 })
})

test('GET /:id 404s for an unknown affiliate', async () => {
  const { app } = await setup()
  const res = await app.request('/nope')
  expect(res.status).toBe(404)
})
