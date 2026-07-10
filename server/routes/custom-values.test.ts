import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { customValuesRoute } from './custom-values'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', customValuesRoute({ db }))
  return app
}

function sendJson(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists values scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1', location_id: 'locA', key: 'business_name', name: 'Business Name' }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    values: [{ id: 'v1', location_id: 'locA', key: 'business_name', name: 'Business Name' }],
  })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a value (201) and slugifies the name into a key', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'business_name', position: 0 }]) // existing keys/positions
  db.enqueue([{ id: 'v_new', location_id: 'locA', key: 'booking_link', name: 'Booking Link' }]) // insert
  const res = await sendJson(harness(db), '/', 'POST', {
    name: 'Booking Link',
    value: 'https://book.test',
  })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, value: { id: 'v_new', key: 'booking_link' } })
  // INSERT params: [locA, id, key, name, value, position]
  expect(db.calls[1]?.params[2]).toBe('booking_link') // computed key
  expect(db.calls[1]?.params[3]).toBe('Booking Link') // name
  expect(db.calls[1]?.params[4]).toBe('https://book.test') // value
})

test('POST / defaults a missing value to an empty string (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // no existing values
  db.enqueue([{ id: 'v_new', location_id: 'locA', key: 'tagline' }])
  const res = await sendJson(harness(db), '/', 'POST', { name: 'Tagline' })

  expect(res.status).toBe(201)
  expect(db.calls[1]?.params[4]).toBe('') // value defaulted to ''
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { name: '   ' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('GET /:id returns the value', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1', key: 'business_name' }])
  const res = await harness(db).request('/v1')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ value: { id: 'v1', key: 'business_name' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'v1'])
})

test('GET /:id is 404 when the value is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id edits a value and returns the updated row (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1', value: 'old' }]) // existence check
  db.enqueue([{ id: 'v1', value: 'Acme Roofing' }]) // update RETURNING
  const res = await sendJson(harness(db), '/v1', 'PATCH', { value: 'Acme Roofing' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, value: { id: 'v1', value: 'Acme Roofing' } })
  expect(db.calls[1]?.sql).toMatch(/UPDATE custom_values/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'Acme Roofing', 'v1'])
})

test('PATCH /:id is 404 when the value is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // existence check -> none
  const res = await sendJson(harness(db), '/missing', 'PATCH', { value: 'new' })
  expect(res.status).toBe(404)
})

test('PATCH /:id with an empty body returns the value unchanged (200, no UPDATE)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1', value: 'unchanged' }]) // existence check
  const res = await sendJson(harness(db), '/v1', 'PATCH', {})

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, value: { id: 'v1', value: 'unchanged' } })
  expect(db.calls).toHaveLength(1) // only the existence read; empty patch issues no UPDATE
})

test('DELETE /:id removes a value (200) with no per-contact fan-out', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1' }]) // delete RETURNING id
  const res = await harness(db).request('/v1', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(db.calls).toHaveLength(1) // single DELETE, nothing to sweep
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM custom_values/i)
})

test('DELETE /:id is 404 when nothing was removed', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // delete RETURNING -> none
  const res = await harness(db).request('/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})
