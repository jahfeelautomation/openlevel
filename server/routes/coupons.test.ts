import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { couponsRoute } from './coupons'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', couponsRoute({ db }))
  return app
}

function sendJson(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists coupons with a derived redeemable flag and KPI summary', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      id: 'c1',
      location_id: 'locA',
      code: 'SUMMER25',
      status: 'active',
      expires_at: null,
      max_redemptions: null,
      times_redeemed: 3,
    },
    {
      id: 'c2',
      location_id: 'locA',
      code: 'OLDONE',
      status: 'archived',
      expires_at: null,
      max_redemptions: null,
      times_redeemed: 8,
    },
  ])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    coupons: { id: string; redeemable: boolean }[]
    summary: { active: number; redeemable: number; redemptions: number; archived: number }
  }
  expect(body.summary).toEqual({ active: 1, redeemable: 1, redemptions: 11, archived: 1 })
  expect(body.coupons[0]?.redeemable).toBe(true) // active, no limits
  expect(body.coupons[1]?.redeemable).toBe(false) // archived
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / defines a coupon after a uniqueness check (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // getByCode -> none
  db.enqueue([{ id: 'c_new', location_id: 'locA', code: 'SAVE10' }]) // create RETURNING
  const res = await sendJson(harness(db), '/', 'POST', { code: 'save 10', discountValue: 10 })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, coupon: { id: 'c_new', code: 'SAVE10' } })
  expect(db.calls[0]?.sql).toMatch(/SELECT \* FROM coupons WHERE location_id = \$1 AND code=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'SAVE10']) // lookup normalised
  // create params: [locA, id, code, description, discount_type, discount_value, max_redemptions, expires_at]
  expect(db.calls[1]?.params[2]).toBe('SAVE10')
  expect(db.calls[1]?.params[4]).toBe('percent') // defaulted type
  expect(db.calls[1]?.params[5]).toBe(10)
})

test('POST / is 409 when the code already exists', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', code: 'SUMMER25' }]) // getByCode -> exists
  const res = await sendJson(harness(db), '/', 'POST', { code: 'SUMMER25', discountValue: 25 })

  expect(res.status).toBe(409)
  expect(db.calls).toHaveLength(1) // never reached create
})

test('POST / rejects a missing code (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { discountValue: 10 })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('POST / refuses a percent discount above 100 (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', {
    code: 'TOOMUCH',
    discountType: 'percent',
    discountValue: 150,
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('POST / accepts a fixed discount larger than 100 cents', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // getByCode -> none
  db.enqueue([{ id: 'c_fixed', location_id: 'locA', code: 'FIFTY' }])
  const res = await sendJson(harness(db), '/', 'POST', {
    code: 'FIFTY',
    discountType: 'fixed',
    discountValue: 5_000,
  })
  expect(res.status).toBe(201)
  expect(db.calls[1]?.params[4]).toBe('fixed')
  expect(db.calls[1]?.params[5]).toBe(5_000)
})

test('PATCH /:id archives a coupon (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', status: 'active' }]) // existence check
  db.enqueue([{ id: 'c1', status: 'archived' }]) // update RETURNING
  const res = await sendJson(harness(db), '/c1', 'PATCH', { status: 'archived' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, coupon: { id: 'c1', status: 'archived' } })
  expect(db.calls[1]?.sql).toMatch(/UPDATE coupons/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'archived', 'c1'])
})

test('PATCH /:id is 404 when the coupon is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // existence check -> none
  const res = await sendJson(harness(db), '/missing', 'PATCH', { status: 'archived' })
  expect(res.status).toBe(404)
})

test('PATCH /:id is 409 when renaming onto another coupon code', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', code: 'SAVE10' }]) // existence check
  db.enqueue([{ id: 'c2', location_id: 'locA', code: 'SUMMER25' }]) // getByCode -> a different coupon
  const res = await sendJson(harness(db), '/c1', 'PATCH', { code: 'summer 25' })

  expect(res.status).toBe(409)
  expect(db.calls).toHaveLength(2) // never reached update
})

test('PATCH /:id allows renaming to the same coupon own code', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', code: 'SAVE10' }]) // existence check
  db.enqueue([{ id: 'c1', location_id: 'locA', code: 'SAVE10' }]) // getByCode -> itself
  db.enqueue([{ id: 'c1', location_id: 'locA', code: 'SAVE10', description: 'x' }]) // update RETURNING
  const res = await sendJson(harness(db), '/c1', 'PATCH', { code: 'save10', description: 'x' })

  expect(res.status).toBe(200)
  expect(db.calls).toHaveLength(3) // reached update because the clash is itself
})

test('PATCH /:id refuses flipping to percent while the existing value exceeds 100 (400)', async () => {
  const db = new FakeDatabase()
  // A $50.00 FIXED coupon: value 5000 is valid for fixed (cents) but absurd as a percent.
  db.enqueue([
    { id: 'c1', location_id: 'locA', code: 'FIFTY', discount_type: 'fixed', discount_value: 5_000 },
  ])
  const res = await sendJson(harness(db), '/c1', 'PATCH', { discountType: 'percent' })

  expect(res.status).toBe(400)
  // Only the existence read happened; the inconsistent flip never reached the update.
  expect(db.calls).toHaveLength(1)
})

test('PATCH /:id refuses raising a percent value above 100 (400)', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { id: 'c1', location_id: 'locA', code: 'SAVE20', discount_type: 'percent', discount_value: 20 },
  ])
  const res = await sendJson(harness(db), '/c1', 'PATCH', { discountValue: 150 })

  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(1)
})

test('PATCH /:id allows a valid simultaneous fixed-to-percent change (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { id: 'c1', location_id: 'locA', code: 'FIFTY', discount_type: 'fixed', discount_value: 5_000 },
  ]) // existence check
  db.enqueue([
    { id: 'c1', location_id: 'locA', code: 'FIFTY', discount_type: 'percent', discount_value: 25 },
  ]) // update RETURNING
  const res = await sendJson(harness(db), '/c1', 'PATCH', { discountType: 'percent', discountValue: 25 })

  expect(res.status).toBe(200)
  expect(db.calls).toHaveLength(2) // reached update because the effective pair is consistent
})

test('DELETE /:id removes a coupon (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1' }]) // delete RETURNING id
  const res = await harness(db).request('/c1', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM coupons/i)
})

test('DELETE /:id is 404 when nothing was removed', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // delete RETURNING -> none
  const res = await harness(db).request('/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})
