import { FakeDatabase } from '../db/fake-database'
import { hashPassword } from '../lib/password'
import { createSession } from '../lib/session'
import { SESSION_COOKIE } from '../middleware/auth'
import { authRoute } from './auth'

const secret = 'sek'

function postJson(app: ReturnType<typeof authRoute>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const operatorRow = { id: 'op1', email: 'AL@x.com', name: 'AL', role: 'owner' }

test('login with the correct password sets an httpOnly session cookie', async () => {
  const password_hash = await hashPassword('pw')
  const db = new FakeDatabase()
  db.enqueue([{ ...operatorRow, password_hash }]) // findByEmail
  const res = await postJson(authRoute({ db, sessionSecret: secret }), '/login', {
    email: 'AL@x.com',
    password: 'pw',
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, operator: { id: 'op1', email: 'AL@x.com' } })
  const cookie = res.headers.get('set-cookie') ?? ''
  expect(cookie).toContain(`${SESSION_COOKIE}=`)
  expect(cookie.toLowerCase()).toContain('httponly')
})

test('login with the wrong password is 401 and sets no cookie', async () => {
  const password_hash = await hashPassword('pw')
  const db = new FakeDatabase()
  db.enqueue([{ ...operatorRow, password_hash }])
  const res = await postJson(authRoute({ db, sessionSecret: secret }), '/login', {
    email: 'AL@x.com',
    password: 'nope',
  })
  expect(res.status).toBe(401)
  expect(res.headers.get('set-cookie')).toBeNull()
})

test('login with an unknown email is 401', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // findByEmail -> none
  const res = await postJson(authRoute({ db, sessionSecret: secret }), '/login', {
    email: 'ghost@x.com',
    password: 'x',
  })
  expect(res.status).toBe(401)
})

test('throttles repeated login attempts from the same IP with a 429', async () => {
  const db = new FakeDatabase()
  for (let i = 0; i < 5; i++) db.enqueue([]) // unknown email -> 401 each time
  const app = authRoute({ db, sessionSecret: secret, loginRateLimit: { max: 2, windowMs: 60_000 } })
  const attempt = () =>
    app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ email: 'ghost@x.com', password: 'x' }),
    })
  expect((await attempt()).status).toBe(401)
  expect((await attempt()).status).toBe(401)
  const blocked = await attempt()
  expect(blocked.status).toBe(429)
  expect(blocked.headers.get('retry-after')).toBeTruthy()
})

test('me returns the operator for a valid session', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ ...operatorRow, password_hash: 'h' }]) // getById
  const token = createSession({ operatorId: 'op1' }, secret)
  const res = await authRoute({ db, sessionSecret: secret }).request('/me', {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ operator: operatorRow })
})

test('me without a session is 401', async () => {
  const res = await authRoute({ db: new FakeDatabase(), sessionSecret: secret }).request('/me')
  expect(res.status).toBe(401)
})

test('logout clears the session cookie', async () => {
  const res = await authRoute({ db: new FakeDatabase(), sessionSecret: secret }).request('/logout', {
    method: 'POST',
  })
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie') ?? ''
  expect(cookie).toContain(`${SESSION_COOKIE}=`)
  expect(cookie.toLowerCase()).toMatch(/max-age=0/)
})

