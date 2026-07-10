import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { locationAccess } from './location-access'

function harness(db: FakeDatabase) {
  const app = new Hono<AppEnv>()
  app.use('/loc/:loc/*', async (c, next) => {
    c.set('operatorId', 'op1')
    await next()
  })
  app.use('/loc/:loc/*', locationAccess(db))
  app.get('/loc/:loc/thing', (c) => c.json({ locationId: c.get('locationId') }))
  return app
}

test('403 when the operator lacks the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // hasAccess -> no rows
  const res = await harness(db).request('/loc/locA/thing')
  expect(res.status).toBe(403)
})

test('passes and sets locationId when the operator has access', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ ok: 1 }]) // hasAccess -> a row
  const res = await harness(db).request('/loc/locA/thing')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ locationId: 'locA' })
  expect(db.calls[0]?.params).toEqual(['op1', 'locA']) // access check scoped to operator + location
})

test('401 when operatorId was never set (auth did not run)', async () => {
  const db = new FakeDatabase()
  const app = new Hono<AppEnv>()
  app.use('/loc/:loc/*', locationAccess(db))
  app.get('/loc/:loc/thing', (c) => c.json({ ok: true }))
  const res = await app.request('/loc/locA/thing')
  expect(res.status).toBe(401)
})
