import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { productsRoute } from './products'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', productsRoute({ db }))
  return app
}

function sendJson(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists products scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Roof Inspection', price_cents: 19900 }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    products: [{ id: 'p1', location_id: 'locA', name: 'Roof Inspection', price_cents: 19900 }],
  })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a one-time product (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // no existing positions
  db.enqueue([{ id: 'p_new', location_id: 'locA', name: 'Roof Inspection', type: 'one_time' }])
  const res = await sendJson(harness(db), '/', 'POST', {
    name: 'Roof Inspection',
    priceCents: 19900,
  })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, product: { id: 'p_new', type: 'one_time' } })
  // INSERT params: [locA, id, name, description, price_cents, currency, type, interval, position]
  expect(db.calls[1]?.params[2]).toBe('Roof Inspection') // name
  expect(db.calls[1]?.params[4]).toBe(19900) // price_cents
  expect(db.calls[1]?.params[6]).toBe('one_time') // type
  expect(db.calls[1]?.params[7]).toBe(null) // a one-time product has no interval
})

test('POST / creates a recurring product with its interval (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  db.enqueue([{ id: 'p_new', location_id: 'locA', type: 'recurring' }])
  const res = await sendJson(harness(db), '/', 'POST', {
    name: 'Care Plan',
    priceCents: 9900,
    type: 'recurring',
    recurringInterval: 'month',
  })

  expect(res.status).toBe(201)
  expect(db.calls[1]?.params[6]).toBe('recurring')
  expect(db.calls[1]?.params[7]).toBe('month')
})

test('POST / defaults a missing price to zero (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  db.enqueue([{ id: 'p_new', location_id: 'locA' }])
  const res = await sendJson(harness(db), '/', 'POST', { name: 'Free Consult' })

  expect(res.status).toBe(201)
  expect(db.calls[1]?.params[4]).toBe(0) // price_cents defaulted to 0
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { name: '   ' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('POST / rejects a negative price (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { name: 'Bad', priceCents: -5 })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('POST / rejects an unknown billing interval (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', {
    name: 'Odd',
    type: 'recurring',
    recurringInterval: 'fortnight',
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('GET /:id returns the product', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', name: 'Roof Inspection' }])
  const res = await harness(db).request('/p1')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ product: { id: 'p1', name: 'Roof Inspection' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('GET /:id is 404 when the product is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id edits a product and returns the updated row (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', price_cents: 19900 }]) // existence check
  db.enqueue([{ id: 'p1', price_cents: 22000 }]) // update RETURNING
  const res = await sendJson(harness(db), '/p1', 'PATCH', { priceCents: 22000 })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, product: { id: 'p1', price_cents: 22000 } })
  expect(db.calls[1]?.sql).toMatch(/UPDATE products/i)
  expect(db.calls[1]?.params).toEqual(['locA', 22000, 'p1'])
})

test('PATCH /:id can archive a product via its status (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'active' }]) // existence check
  db.enqueue([{ id: 'p1', status: 'archived' }]) // update RETURNING
  const res = await sendJson(harness(db), '/p1', 'PATCH', { status: 'archived' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, product: { id: 'p1', status: 'archived' } })
  expect(db.calls[1]?.params).toEqual(['locA', 'archived', 'p1'])
})

test('PATCH /:id rejects an unknown status (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/p1', 'PATCH', { status: 'deleted' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /:id is 404 when the product is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // existence check -> none
  const res = await sendJson(harness(db), '/missing', 'PATCH', { priceCents: 100 })
  expect(res.status).toBe(404)
})

test('PATCH /:id with an empty body returns the product unchanged (200, no UPDATE)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', price_cents: 19900 }]) // existence check
  const res = await sendJson(harness(db), '/p1', 'PATCH', {})

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, product: { id: 'p1', price_cents: 19900 } })
  expect(db.calls).toHaveLength(1) // only the existence read; empty patch issues no UPDATE
})

test('DELETE /:id removes a product (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1' }]) // delete RETURNING id
  const res = await harness(db).request('/p1', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM products/i)
})

test('DELETE /:id is 404 when nothing was removed', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // delete RETURNING -> none
  const res = await harness(db).request('/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})
