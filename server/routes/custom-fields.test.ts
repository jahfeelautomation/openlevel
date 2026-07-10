import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { customFieldsRoute } from './custom-fields'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', customFieldsRoute({ db }))
  return app
}

function sendJson(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists fields scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', location_id: 'locA', key: 'roof_age', label: 'Roof Age' }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    fields: [{ id: 'f1', location_id: 'locA', key: 'roof_age', label: 'Roof Age' }],
  })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a field (201) and defaults type to text', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'roof_age', position: 0 }]) // existing keys/positions for create
  db.enqueue([{ id: 'f_new', location_id: 'locA', key: 'lead_source', type: 'text' }]) // insert
  const res = await sendJson(harness(db), '/', 'POST', { label: 'Lead Source' })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, field: { id: 'f_new', type: 'text' } })
  // INSERT params: [locA, id, key, label, type, options, placeholder, position]
  expect(db.calls[1]?.params[4]).toBe('text')
})

test('POST / rejects an empty label (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { label: '   ' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('POST / rejects an unknown type (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { label: 'X', type: 'rating' })
  expect(res.status).toBe(400)
})

test('POST / accepts dropdown options', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // no existing fields
  db.enqueue([{ id: 'f_new', key: 'stage', type: 'dropdown' }])
  const res = await sendJson(harness(db), '/', 'POST', {
    label: 'Stage',
    type: 'dropdown',
    options: ['Buyer', 'Seller'],
  })

  expect(res.status).toBe(201)
  // options serialized as json at param index 5
  expect(db.calls[1]?.params[5]).toBe('["Buyer","Seller"]')
})

test('GET /:id returns the field', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', key: 'roof_age' }])
  const res = await harness(db).request('/f1')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ field: { id: 'f1', key: 'roof_age' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'f1'])
})

test('GET /:id is 404 when the field is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id edits a field and returns the updated row (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', label: 'old' }]) // existence check
  db.enqueue([{ id: 'f1', label: 'Roof Age (yrs)' }]) // update RETURNING
  const res = await sendJson(harness(db), '/f1', 'PATCH', { label: 'Roof Age (yrs)' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, field: { id: 'f1', label: 'Roof Age (yrs)' } })
  expect(db.calls[1]?.sql).toMatch(/UPDATE custom_fields/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'Roof Age (yrs)', 'f1'])
})

test('PATCH /:id is 404 when the field is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // existence check -> none
  const res = await sendJson(harness(db), '/missing', 'PATCH', { label: 'new' })
  expect(res.status).toBe(404)
})

test('PATCH /:id with an empty body returns the field unchanged (200, no UPDATE)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', label: 'unchanged' }]) // existence check
  const res = await sendJson(harness(db), '/f1', 'PATCH', {})

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, field: { id: 'f1', label: 'unchanged' } })
  expect(db.calls).toHaveLength(1) // only the existence read; empty patch issues no UPDATE
})

test('DELETE /:id removes a field (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'roof_age' }]) // delete RETURNING key
  db.enqueue([]) // contact value sweep
  const res = await harness(db).request('/f1', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM custom_fields/i)
})

test('DELETE /:id is 404 when nothing was removed', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // delete RETURNING -> none
  const res = await harness(db).request('/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})
