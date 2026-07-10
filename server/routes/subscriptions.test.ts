import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { subscriptionsRoute } from './subscriptions'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', subscriptionsRoute({ db }))
  return app
}

function sendJson(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists subscriptions with a derived schedule and summary', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      id: 's1',
      location_id: 'locA',
      status: 'active',
      amount_cents: 125_000,
      billing_interval: 'month',
      started_at: '2026-01-10T00:00:00.000Z',
    },
    {
      id: 's2',
      location_id: 'locA',
      status: 'paused',
      amount_cents: 50_000,
      billing_interval: 'month',
      started_at: '2026-01-01T00:00:00.000Z',
    },
  ])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    subscriptions: { id: string; next_renewal: string | null }[]
    summary: { active: number; paused: number; canceled: number; mrr_cents: number }
  }
  expect(body.summary).toEqual({ active: 1, paused: 1, canceled: 0, mrr_cents: 125_000 })
  // Active subscription gets a real upcoming date; the paused one renews nothing.
  expect(typeof body.subscriptions[0]?.next_renewal).toBe('string')
  expect(body.subscriptions[1]?.next_renewal).toBe(null)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / starts a subscription from a recurring product, snapshotting it (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      id: 'prod1',
      location_id: 'locA',
      name: 'Monthly Management Retainer',
      price_cents: 125_000,
      currency: 'usd',
      type: 'recurring',
      recurring_interval: 'month',
      status: 'active',
    },
  ]) // ProductsRepo.get
  db.enqueue([{ id: 's_new', location_id: 'locA', name: 'Monthly Management Retainer', status: 'active' }]) // create RETURNING
  const res = await sendJson(harness(db), '/', 'POST', { productId: 'prod1', contactId: 'c1' })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, subscription: { id: 's_new', status: 'active' } })
  // create params: [locA, id, contact_id, product_id, name, amount_cents, currency, interval, started_at]
  expect(db.calls[1]?.params[2]).toBe('c1') // contact snapshot
  expect(db.calls[1]?.params[3]).toBe('prod1') // product link
  expect(db.calls[1]?.params[4]).toBe('Monthly Management Retainer') // name snapshot
  expect(db.calls[1]?.params[5]).toBe(125_000) // amount snapshot from the product price
  expect(db.calls[1]?.params[7]).toBe('month') // cadence snapshot
})

test('POST / is 404 when the product is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // ProductsRepo.get -> none
  const res = await sendJson(harness(db), '/', 'POST', { productId: 'missing' })
  expect(res.status).toBe(404)
  expect(db.calls).toHaveLength(1) // never reached create
})

test('POST / refuses a one-time product (400) — nothing to bill on a cadence', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { id: 'prod2', location_id: 'locA', type: 'one_time', recurring_interval: null, price_cents: 25_000 },
  ])
  const res = await sendJson(harness(db), '/', 'POST', { productId: 'prod2' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(1) // validated then refused, no create
})

test('POST / rejects a missing productId (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { contactId: 'c1' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /:id cancels a subscription (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', status: 'active' }]) // existence check
  db.enqueue([{ id: 's1', status: 'canceled' }]) // update RETURNING
  const res = await sendJson(harness(db), '/s1', 'PATCH', { status: 'canceled' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, subscription: { id: 's1', status: 'canceled' } })
  expect(db.calls[1]?.sql).toMatch(/UPDATE subscriptions/i)
  expect(db.calls[1]?.sql).toMatch(/canceled_at=now\(\)/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'canceled', 's1'])
})

test('PATCH /:id is 404 when the subscription is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // existence check -> none
  const res = await sendJson(harness(db), '/missing', 'PATCH', { status: 'paused' })
  expect(res.status).toBe(404)
})

test('PATCH /:id rejects an unknown status (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/s1', 'PATCH', { status: 'expired' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('DELETE /:id removes a subscription (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1' }]) // delete RETURNING id
  const res = await harness(db).request('/s1', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM subscriptions/i)
})

test('DELETE /:id is 404 when nothing was removed', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // delete RETURNING -> none
  const res = await harness(db).request('/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})
