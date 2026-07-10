import { FakeDatabase } from './db/fake-database'
import { createApp } from './index'
import type { SendTextFn } from './lib/operator-tools'
import { createSession } from './lib/session'

function app(db = new FakeDatabase()) {
  return createApp({ db, sessionSecret: 'sek', webhookSecret: 'whsek' })
}

test('health is public', async () => {
  const res = await app().request('/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, service: 'openlevel' })
})

test('GET /api/locations requires a session', async () => {
  const res = await app().request('/api/locations')
  expect(res.status).toBe(401)
})

test('location-scoped routes require a session', async () => {
  const res = await app().request('/api/loc/locA/contacts')
  expect(res.status).toBe(401)
})

test('authenticated operator without access to the location gets 403', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // hasAccess -> none
  const token = createSession({ operatorId: 'op1' }, 'sek')
  const res = await app(db).request('/api/loc/locA/contacts', {
    headers: { Cookie: `ol_session=${token}` },
  })
  expect(res.status).toBe(403)
})

test('chatwoot webhook with the wrong secret is 401', async () => {
  const res = await app().request('/api/webhooks/chatwoot?secret=wrong', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'message_created' }),
  })
  expect(res.status).toBe(401)
})

// --- the text rail is wired end-to-end through createApp (slice 3B) -------------
// Prod injects the gateway rail at the top of the tree; this proves it actually
// reaches the assistant /confirm send_text handler through the real auth + tenant
// middleware — not just the route unit in isolation.

test('createApp threads the gateway text rail into the assistant /confirm send_text path', async () => {
  const db = new FakeDatabase()
  const CONTACT = { id: 'c1', location_id: 'locA', name: 'Jane Doe', phones: ['+16025551234'], emails: [], tags: [] }
  db.enqueue([{ id: 'locA' }]) // locationAccess: hasAccess -> granted
  db.enqueue([CONTACT]) // resolve(confirm) -> prepareText -> contacts.get
  db.enqueue([CONTACT]) // perform -> prepareText -> contacts.get
  const calls: Array<{ e164: string; body: string; nonce: string }> = []
  const sendText: SendTextFn = async (e164, body, nonce) => {
    calls.push({ e164, body, nonce })
    return { ok: true, messageId: 'gw1' }
  }
  const token = createSession({ operatorId: 'op1' }, 'sek')
  const res = await createApp({ db, sessionSecret: 'sek', webhookSecret: 'whsek', sendText }).request(
    '/api/loc/locA/assistant/confirm',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `ol_session=${token}` },
      body: JSON.stringify({ verb: 'send_text', params: { contactId: 'c1', body: 'Hi Jane', nonce: 'n1' } }),
    },
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ message: expect.stringMatching(/sent your text/i) })
  // the real rail was reached, with the contact's derived number + the echoed nonce
  expect(calls).toEqual([{ e164: '+16025551234', body: 'Hi Jane', nonce: 'n1' }])
})

// --- the hub federation surface is mounted, but inert until a token is set --------
// createApp wires /federation/* with its OWN bearer gate (separate from operator
// sessions). With no FEDERATION_SERVICE_TOKEN the whole surface answers 503 ("not
// turned on"); once a token is configured it answers, and a wrong bearer is 401.

test('federation surface is inert (503) when no token is configured', async () => {
  const res = await app().request('/federation/capabilities', { headers: { authorization: 'Bearer anything' } })
  expect(res.status).toBe(503)
})

test('federation capabilities answer (200) once a token is configured, 401 on a wrong bearer', async () => {
  const built = createApp({
    db: new FakeDatabase(),
    sessionSecret: 'sek',
    webhookSecret: 'whsek',
    federationServiceToken: 'fed-token',
  })
  const ok = await built.request('/federation/capabilities', { headers: { authorization: 'Bearer fed-token' } })
  expect(ok.status).toBe(200)
  expect(await ok.json()).toMatchObject({ app: 'openlevel' })
  const bad = await built.request('/federation/capabilities', { headers: { authorization: 'Bearer wrong' } })
  expect(bad.status).toBe(401)
})
