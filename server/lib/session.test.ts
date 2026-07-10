import { createHmac } from 'node:crypto'
import { createSession, readSession } from './session'

const secret = 'test-secret'

test('round-trips an operator session', () => {
  const token = createSession({ operatorId: 'op1' }, secret)
  expect(readSession(token, secret)).toEqual({ operatorId: 'op1' })
})

test('accepts a token within its ttl but rejects it once expired', () => {
  const t0 = 1_000_000
  const token = createSession({ operatorId: 'op1' }, secret, { ttlMs: 60_000, now: t0 })
  expect(readSession(token, secret, { now: t0 + 59_000 })).toEqual({ operatorId: 'op1' })
  expect(readSession(token, secret, { now: t0 + 60_001 })).toBeNull()
})

test('rejects a correctly-signed token that carries no expiry claim', () => {
  // A legacy / forged payload with no exp must not be honored as a perpetual session.
  const payload = Buffer.from(JSON.stringify({ operatorId: 'op1' }), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  expect(readSession(`${payload}.${sig}`, secret)).toBeNull()
})

test('rejects a tampered payload', () => {
  const token = createSession({ operatorId: 'op1' }, secret)
  const forged = Buffer.from(JSON.stringify({ operatorId: 'evil' }), 'utf8').toString('base64url')
  const tampered = token.replace(/^[^.]+/, forged)
  expect(readSession(tampered, secret)).toBeNull()
})

test('rejects a token signed with a different secret', () => {
  const token = createSession({ operatorId: 'op1' }, secret)
  expect(readSession(token, 'other-secret')).toBeNull()
})

test('rejects empty, missing, and garbage tokens', () => {
  expect(readSession(undefined, secret)).toBeNull()
  expect(readSession(null, secret)).toBeNull()
  expect(readSession('', secret)).toBeNull()
  expect(readSession('no-dot-here', secret)).toBeNull()
})
