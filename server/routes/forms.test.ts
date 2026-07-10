import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { formsRoute } from './forms'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', formsRoute({ db }))
  return app
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists forms with their honest submission count, scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', name: 'Cash offer', slug: 'cash-offer', status: 'published', submissions: 2 }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { forms: { id: string; submissions: number }[] }
  expect(body.forms[0]?.id).toBe('fm1')
  expect(body.forms[0]?.submissions).toBe(2)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a form, auto-seeds starter content, defaults to draft (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm_new', location_id: 'locA', name: 'New form', slug: 'new-form', status: 'draft' }])
  const res = await jsonReq(harness(db), '/', 'POST', { name: 'New form', slug: 'new-form' })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: boolean; form: { id: string } }
  expect(body.ok).toBe(true)
  expect(body.form.id).toBe('fm_new')
  // create is scoped to location ($1) and seeds real starter fields
  expect(db.calls[0]?.params?.[0]).toBe('locA')
  expect(db.calls[0]?.params).toContain('draft')
  expect(db.calls[0]?.params?.some((p) => typeof p === 'string' && p.includes('full_name'))).toBe(true)
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/', 'POST', { name: '', slug: 'x' })
  expect(res.status).toBe(400)
})

test('POST / rejects a bad slug (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/', 'POST', { name: 'Ok', slug: 'Not A Slug' })
  expect(res.status).toBe(400)
})

test('GET /:id returns the form with its recent submissions', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', name: 'Cash offer', slug: 'cash-offer', status: 'published' }]) // form get
  db.enqueue([
    { id: 'sub2', form_id: 'fm1', values: { email: 'b@c.com' } },
    { id: 'sub1', form_id: 'fm1', values: { email: 'a@b.com' } },
  ]) // submissions, newest first
  const res = await harness(db).request('/fm1')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { form: { id: string }; submissions: { id: string }[] }
  expect(body.form.id).toBe('fm1')
  expect(body.submissions).toHaveLength(2)
  expect(body.submissions[0]?.id).toBe('sub2')
  expect(db.calls[0]?.params).toEqual(['locA', 'fm1']) // form get scoped
  expect(db.calls[1]?.params).toEqual(['locA', 'fm1']) // submissions scoped to location + form
})

test('GET /:id is 404 when the form is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // form get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id with status publishes the form', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', status: 'published' }])
  const res = await jsonReq(harness(db), '/fm1', 'PATCH', { status: 'published' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, form: { status: 'published' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'published', 'fm1'])
})

test('PATCH /:id with name/slug/content edits the form', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', name: 'Renamed' }])
  const res = await jsonReq(harness(db), '/fm1', 'PATCH', {
    name: 'Renamed',
    content: { headline: 'New headline' },
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, form: { id: 'fm1' } })
  expect(db.calls[0]?.params?.[0]).toBe('locA')
  expect(db.calls[0]?.params).toContain(JSON.stringify({ headline: 'New headline' }))
  expect(db.calls[0]?.params?.[db.calls[0].params.length - 1]).toBe('fm1') // id pinned last
})

test('PATCH /:id is 404 when nothing matched', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // setStatus RETURNING -> none
  const res = await jsonReq(harness(db), '/missing', 'PATCH', { status: 'published' })
  expect(res.status).toBe(404)
})
