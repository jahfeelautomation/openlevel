import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { type ConversationsDeps, conversationsRoute } from './conversations'

function harness(db: FakeDatabase, deps: Partial<ConversationsDeps> = {}, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', conversationsRoute({ db, ...deps }))
  return app
}

const conv = {
  id: 'conv1',
  location_id: 'locA',
  contact_id: 'c1',
  external_id: '55',
  provider: 'chatwoot',
  channel: 'chatwoot',
  status: 'open',
}

function postJson(app: Hono<AppEnv>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('lists conversations scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([conv]) // list
  const res = await harness(db).request('/')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ conversations: [conv] })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('thread returns the conversation with its messages', async () => {
  const db = new FakeDatabase()
  db.enqueue([conv]) // get
  db.enqueue([{ id: 'm1', direction: 'inbound' }]) // listByConversation
  const res = await harness(db).request('/conv1')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ conversation: conv, messages: [{ id: 'm1', direction: 'inbound' }] })
  expect(db.calls.every((call) => call.params.includes('locA'))).toBe(true)
})

test('thread is 404 when the conversation is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('send posts to chatwoot, persists outbound message + timeline, touches convo', async () => {
  const db = new FakeDatabase()
  db.enqueue([conv]) // get
  db.enqueue([
    {
      location_id: 'locA',
      inbox_id: '7',
      config: { baseUrl: 'https://chat', accountId: '1', tokenSecretName: 'Alex:chatwoot:api_token' },
    },
  ]) // getForLocation
  db.enqueue([{ id: 'm-out', direction: 'outbound' }]) // insertOutbound
  db.enqueue([{ id: 't-out' }]) // timeline add
  db.enqueue([]) // touch (UPDATE)

  const sendCalls: unknown[] = []
  const app = harness(db, {
    sendMessage: async (p) => {
      sendCalls.push(p)
      return { externalId: 'cw-99' }
    },
    resolveSecret: () => 'tok',
  })
  const res = await postJson(app, '/conv1/messages', { body: 'hello back' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, message: { id: 'm-out' } })
  expect(sendCalls[0]).toEqual({
    baseUrl: 'https://chat',
    accountId: '1',
    conversationId: '55',
    token: 'tok',
    content: 'hello back',
  })
  // get, insertOutbound, timeline add, and touch are all location-scoped
  for (const i of [0, 2, 3, 4]) {
    expect(db.calls[i]?.params).toContain('locA')
  }
})

test('send is 404 when the conversation is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await postJson(harness(db), '/nope/messages', { body: 'x' })
  expect(res.status).toBe(404)
})

test('send is 400 when the location has no chatwoot channel', async () => {
  const db = new FakeDatabase()
  db.enqueue([conv]) // get
  db.enqueue([]) // getForLocation -> none
  const res = await postJson(harness(db, { resolveSecret: () => 'tok' }), '/conv1/messages', { body: 'x' })
  expect(res.status).toBe(400)
})

