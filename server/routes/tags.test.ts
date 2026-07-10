import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { tagsRoute } from './tags'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', tagsRoute({ db }))
  return app
}

test('GET / lists tags with counts, scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { tag: 'lead', count: 3 },
    { tag: 'vip', count: 1 },
  ])
  const res = await harness(db).request('/')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    tags: [
      { tag: 'lead', count: 3 },
      { tag: 'vip', count: 1 },
    ],
  })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('PATCH /:tag renames across contacts and reports the count', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1' }, { id: 'c2' }]) // rename RETURNING id -> 2 contacts
  const res = await harness(db).request('/lead', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'prospect' }),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, renamed: 2 })
  expect(db.calls[0]?.params).toEqual(['locA', 'lead', 'prospect']) // location, from, to
})

test('PATCH /:tag with an empty name is rejected before the db', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/lead', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '   ' }),
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /:tag renaming to the same name is a no-op (0 touched, no write)', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/lead', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ' lead ' }), // trims to the same tag
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, renamed: 0 })
  expect(db.calls).toHaveLength(0)
})

test('DELETE /:tag removes from every contact and reports the count', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]) // remove RETURNING id
  const res = await harness(db).request('/lead', { method: 'DELETE' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, removed: 3 })
  expect(db.calls[0]?.params).toEqual(['locA', 'lead'])
})

test('an encoded tag with a space round-trips through the path', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1' }])
  const res = await harness(db).request('/cash%20offer', { method: 'DELETE' })
  expect(res.status).toBe(200)
  expect(db.calls[0]?.params).toEqual(['locA', 'cash offer']) // Hono decodes the path param
})
