import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { templatesRoute } from './templates'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', templatesRoute({ db }))
  return app
}

function sendJson(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists templates scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1', location_id: 'locA', name: 'Welcome email' }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    templates: [{ id: 'tpl1', location_id: 'locA', name: 'Welcome email' }],
  })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a template (201) with location_id set', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl_new', location_id: 'locA', name: 'Welcome', channel: 'email' }])
  const res = await sendJson(harness(db), '/', 'POST', {
    name: 'Welcome',
    channel: 'email',
    subject: 'Hi {{first_name}}',
    body: 'Thanks for reaching out, {{first_name}}.',
  })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, template: { id: 'tpl_new', channel: 'email' } })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('POST / defaults the channel to email when omitted', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl_new', channel: 'email' }])
  await sendJson(harness(db), '/', 'POST', { name: 'No channel', body: 'hello' })

  // VALUES ($2,$1,$3,$4,$5,$6): channel is param index 3
  expect(db.calls[0]?.params[3]).toBe('email')
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { name: '', body: 'hi' })
  expect(res.status).toBe(400)
})

test('POST / rejects an empty body (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { name: 'No body', body: '' })
  expect(res.status).toBe(400)
})

test('POST / rejects an unknown channel (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { name: 'X', channel: 'fax', body: 'hi' })
  expect(res.status).toBe(400)
})

test('GET /:id returns the template', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1', name: 'Welcome' }])
  const res = await harness(db).request('/tpl1')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ template: { id: 'tpl1', name: 'Welcome' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'tpl1'])
})

test('GET /:id is 404 when the template is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id edits a template and returns the updated row (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1', name: 'old' }]) // existence check
  db.enqueue([{ id: 'tpl1', name: 'new' }]) // update RETURNING
  const res = await sendJson(harness(db), '/tpl1', 'PATCH', { name: 'new' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, template: { id: 'tpl1', name: 'new' } })
  expect(db.calls[1]?.sql).toMatch(/UPDATE templates/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'new', 'tpl1'])
})

test('PATCH /:id is 404 when the template is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // existence check -> none
  const res = await sendJson(harness(db), '/missing', 'PATCH', { name: 'new' })
  expect(res.status).toBe(404)
})

test('PATCH /:id with an empty body returns the template unchanged (200, no UPDATE issued)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1', name: 'unchanged' }]) // existence check
  const res = await sendJson(harness(db), '/tpl1', 'PATCH', {})

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, template: { id: 'tpl1', name: 'unchanged' } })
  // only the existence read happened; the empty patch issues no UPDATE
  expect(db.calls).toHaveLength(1)
})

test('DELETE /:id removes a template (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1' }]) // remove RETURNING
  const res = await harness(db).request('/tpl1', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM templates/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'tpl1'])
})

test('DELETE /:id is 404 when nothing was removed', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // remove RETURNING -> none
  const res = await harness(db).request('/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})
