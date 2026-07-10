import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { locationsRoute } from './locations'

function harness(db: FakeDatabase, operatorId = 'op1') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', operatorId)
    await next()
  })
  app.route('/', locationsRoute({ db }))
  return app
}

const jamal = {
  id: 'locJamal',
  name: 'Jamal',
  slug: 'jamal',
  client_slug: 'jamal',
  branding: {},
  settings: {},
}

test('lists only the locations the operator belongs to, scoped by operator id', async () => {
  const db = new FakeDatabase()
  db.enqueue([jamal]) // listLocations join result
  const res = await harness(db).request('/')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ locations: [jamal] })
  expect(db.calls[0]?.params).toEqual(['op1'])
})
