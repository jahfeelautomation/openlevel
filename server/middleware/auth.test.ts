import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { createSession } from '../lib/session'
import { SESSION_COOKIE, operatorAuth } from './auth'

const secret = 'sek'

function harness() {
  const app = new Hono<AppEnv>()
  app.use('*', operatorAuth(secret))
  app.get('/x', (c) => c.json({ operatorId: c.get('operatorId') }))
  return app
}

test('401 when there is no session cookie', async () => {
  const res = await harness().request('/x')
  expect(res.status).toBe(401)
})

test('sets operatorId and passes through for a valid session', async () => {
  const token = createSession({ operatorId: 'op1' }, secret)
  const res = await harness().request('/x', { headers: { Cookie: `${SESSION_COOKIE}=${token}` } })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ operatorId: 'op1' })
})

test('401 for a tampered/garbage cookie', async () => {
  const res = await harness().request('/x', { headers: { Cookie: `${SESSION_COOKIE}=bogus.sig` } })
  expect(res.status).toBe(401)
})
