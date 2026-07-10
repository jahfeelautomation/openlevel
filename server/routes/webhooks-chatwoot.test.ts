import type { Hono } from 'hono'
import { FakeDatabase } from '../db/fake-database'
import { chatwootWebhookRoute } from './webhooks-chatwoot'

const payload = {
  event: 'message_created',
  message_type: 'incoming',
  content: 'hi',
  id: 991,
  conversation: { id: 55 },
  inbox: { id: 7 },
  sender: { name: 'Bob', phone_number: '+15035550199', email: null },
}

function post(app: Hono, body: unknown, secret = 'sek') {
  return app.request(`/?secret=${secret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function postHeader(app: Hono, body: unknown, secret: string) {
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
    body: JSON.stringify(body),
  })
}

test('rejects a wrong webhook secret with 401', async () => {
  const app = chatwootWebhookRoute({ db: new FakeDatabase(), webhookSecret: 'sek' })
  const res = await post(app, payload, 'wrong') // different length than the real secret
  expect(res.status).toBe(401) // and the timing-safe compare does not throw on the length mismatch
})

test('rejects a request that carries no secret at all with 401', async () => {
  const app = chatwootWebhookRoute({ db: new FakeDatabase(), webhookSecret: 'sek' })
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  expect(res.status).toBe(401)
})

test('accepts the secret from the x-webhook-secret header (the non-leaking path)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ location_id: 'locJamal', inbox_id: '7', config: {} }]) // resolveLocation
  db.enqueue([{ id: 'c1', location_id: 'locJamal' }]) // contacts upsert (atomic)
  db.enqueue([{ id: 'conv1', location_id: 'locJamal' }]) // conversations upsert (atomic)
  db.enqueue([{ id: 'm1', location_id: 'locJamal' }]) // messages insertInbound
  db.enqueue([{ id: 't1' }]) // timeline add
  db.enqueue([]) // conversations touch

  const app = chatwootWebhookRoute({ db, webhookSecret: 'sek' })
  const res = await postHeader(app, payload, 'sek')
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, contactId: 'c1' })
})

test('rejects a wrong header secret with 401', async () => {
  const app = chatwootWebhookRoute({ db: new FakeDatabase(), webhookSecret: 'sek' })
  const res = await postHeader(app, payload, 'nope')
  expect(res.status).toBe(401)
})

test('ignores non-message events with 200', async () => {
  const app = chatwootWebhookRoute({ db: new FakeDatabase(), webhookSecret: 'sek' })
  const res = await post(app, { event: 'conversation_status_changed' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ignored: true })
})

test('ingests inbound: contact + conversation + message + timeline, all location-scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ location_id: 'locJamal', inbox_id: '7', config: {} }]) // resolveLocation
  db.enqueue([{ id: 'c1', location_id: 'locJamal' }]) // contacts upsert (atomic)
  db.enqueue([{ id: 'conv1', location_id: 'locJamal' }]) // conversations upsert (atomic)
  db.enqueue([{ id: 'm1', location_id: 'locJamal' }]) // messages insertInbound
  db.enqueue([{ id: 't1' }]) // timeline add
  db.enqueue([]) // conversations touch (UPDATE)

  const app = chatwootWebhookRoute({ db, webhookSecret: 'sek' })
  const res = await post(app, payload)
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, contactId: 'c1', conversationId: 'conv1', messageId: 'm1' })

  // every query after resolveLocation carried the resolved location id
  for (const call of db.calls.slice(1)) {
    expect(call.params).toContain('locJamal')
  }
})

test('enqueues onInbound after a fresh inbound message', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ location_id: 'locJamal', inbox_id: '7', config: {} }]) // resolveLocation
  db.enqueue([{ id: 'c1' }]) // contacts upsert
  db.enqueue([{ id: 'conv1' }]) // conversations upsert
  db.enqueue([{ id: 'm1' }]) // messages insertInbound
  db.enqueue([{ id: 't1' }]) // timeline add
  db.enqueue([]) // conversations touch

  const seen: unknown[] = []
  const app = chatwootWebhookRoute({
    db,
    webhookSecret: 'sek',
    onInbound: (e) => {
      seen.push(e)
    },
  })
  await post(app, payload)
  expect(seen).toEqual([
    { locationId: 'locJamal', conversationId: 'conv1', contactId: 'c1', messageId: 'm1', contactName: 'Bob', preview: 'hi' },
  ])
})

test('dedupes a repeated message (insertInbound conflict) without timeline write', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ location_id: 'locJamal', inbox_id: '7', config: {} }]) // resolveLocation
  db.enqueue([{ id: 'c1' }]) // contacts upsert
  db.enqueue([{ id: 'conv1' }]) // conversations upsert
  db.enqueue([]) // insertInbound -> conflict -> null

  const app = chatwootWebhookRoute({ db, webhookSecret: 'sek' })
  const res = await post(app, payload)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, deduped: true })
  expect(db.calls).toHaveLength(4) // no timeline, no touch
})
