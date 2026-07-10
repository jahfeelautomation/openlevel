import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import type { ClaudeClient } from '../jobs/agent-reply'
import type { SendTextFn, SendTextResult } from '../lib/operator-tools'
import { type AssistantRouteDeps, assistantRoute } from './assistant'

function fakeClaude(text = 'You have 2 open tasks.') {
  const calls: { apiKey: string; model: string; messages: unknown[] }[] = []
  const client: ClaudeClient = {
    createMessage: async (input) => {
      calls.push({ apiKey: input.apiKey, model: input.model, messages: input.messages })
      return { stopReason: 'end_turn', content: [{ type: 'text', text }] }
    },
  }
  return { client, calls }
}

function harness(db: FakeDatabase, deps: Partial<AssistantRouteDeps> = {}, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', assistantRoute({ db, ...deps }))
  return app
}

function postJson(app: Hono<AppEnv>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A fake gateway rail that records what it was asked to send and returns a canned result. */
function fakeSendText(result: SendTextResult = { ok: true, messageId: 'm1' }) {
  const calls: Array<{ e164: string; body: string; nonce: string }> = []
  const fn: SendTextFn = async (e164, body, nonce) => {
    calls.push({ e164, body, nonce })
    return result
  }
  return { fn, calls }
}

const LOC = { id: 'locA', name: 'Alex Co', slug: 'Alex', client_slug: 'Alex', branding: {}, settings: {} }
const TEXT_CONTACT = { id: 'c1', location_id: 'locA', name: 'Jane Doe', phones: ['+16025551234'], emails: [], tags: [] }

test('answers an operator message, scoped to the location, returning the reply', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC]) // getById
  const { client, calls } = fakeClaude()
  const res = await postJson(harness(db, { claude: client, resolveSecret: () => 'sk' }), '/messages', {
    history: [],
    message: 'How many open tasks do I have?',
  })
  expect(res.status).toBe(200)
  // the response carries the reply and the (here empty) list of prepared changes
  expect(await res.json()).toEqual({ reply: 'You have 2 open tasks.', proposals: [] })
  // the operator (Sonnet) model carried the call
  expect(calls[0]?.model).toBe('claude-sonnet-4-6')
  // the location read was scoped to locA
  expect(db.calls[0]?.params).toContain('locA')
})

test('threads prior turns + the new message through to the model', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC])
  const { client, calls } = fakeClaude()
  const res = await postJson(harness(db, { claude: client, resolveSecret: () => 'sk' }), '/messages', {
    history: [
      { role: 'operator', content: 'who is Jane?' },
      { role: 'assistant', content: 'A lead in Phoenix.' },
    ],
    message: 'find her open tasks',
  })
  expect(res.status).toBe(200)
  const msgs = calls[0]!.messages as { role: string; content: string }[]
  expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'find her open tasks' })
  expect(msgs.some((m) => m.role === 'assistant' && m.content === 'A lead in Phoenix.')).toBe(true)
})

test('501 when no claude client is configured', async () => {
  const db = new FakeDatabase()
  const res = await postJson(harness(db, { resolveSecret: () => 'sk' }), '/messages', { message: 'hi' })
  expect(res.status).toBe(501)
})

test('400 when the message is empty (rejected by validation)', async () => {
  const db = new FakeDatabase()
  const { client } = fakeClaude()
  const res = await postJson(harness(db, { claude: client, resolveSecret: () => 'sk' }), '/messages', { message: '' })
  expect(res.status).toBe(400)
})

test('404 when the location is unknown', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // getById -> none
  const { client } = fakeClaude()
  const res = await postJson(harness(db, { claude: client, resolveSecret: () => 'sk' }), '/messages', { message: 'hi' })
  expect(res.status).toBe(404)
})

test('400 when the client has no anthropic key', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC]) // getById
  const { client } = fakeClaude()
  const res = await postJson(harness(db, { claude: client, resolveSecret: () => undefined }), '/messages', {
    message: 'hi',
  })
  expect(res.status).toBe(400)
})

// --- /confirm: the ONLY route that actually performs a prepared write ----------

test('/confirm performs a prepared write, scoped to the operator tenant, and reports it', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }]) // re-resolve: contacts.get
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: ['vip'] }]) // addTag RETURNING
  // no claude passed — confirm never calls the model, it only performs the write
  const res = await postJson(harness(db, { resolveSecret: () => 'sk' }), '/confirm', {
    verb: 'tag_contact',
    params: { contactId: 'c1', tag: 'vip' },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { message: string }
  expect(body.message).toMatch(/tagged|vip/i)
  const writes = db.calls.filter((q) => /INSERT|UPDATE|DELETE/i.test(q.sql))
  expect(writes).toHaveLength(1)
  expect(writes[0]?.params[0]).toBe('locA') // the trusted tenant from the context, not the body
})

test('/confirm refuses a verb that is not a known write tool, touching nothing', async () => {
  const db = new FakeDatabase()
  const res = await postJson(harness(db, { resolveSecret: () => 'sk' }), '/confirm', {
    verb: 'delete_everything',
    params: {},
  })
  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: string }
  expect(body.error).toMatch(/unknown action|not/i)
  expect(db.calls).toHaveLength(0)
})

// --- /confirm threads the gateway text rail (slice 3B) --------------------------
// The route is the seam that hands confirmOperatorWrite the injected sender. With a
// rail present, confirming a send_text actually reaches it; the destination is
// DERIVED from the contact (a forged e164 in the body can't redirect it), and the
// reply is the rail's honest outcome — never a false "sent".

test('/confirm with send_text reaches the injected rail with the DERIVED e164 + echoed nonce, and reports its result', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT]) // resolve(confirm) -> prepareText -> contacts.get
  db.enqueue([TEXT_CONTACT]) // perform -> prepareText -> contacts.get
  const { fn, calls } = fakeSendText({ ok: true, messageId: 'gw1' })
  const res = await postJson(harness(db, { sendText: fn }), '/confirm', {
    // a forged e164 in the payload must be ignored — destination comes from the contact
    verb: 'send_text',
    params: { contactId: 'c1', body: 'Hi Jane', nonce: 'n1', e164: '+19998887777' },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { message: string }
  expect(body.message).toMatch(/sent your text/i)
  // the rail was actually invoked, with the contact's real number (not the forged one) + the nonce
  expect(calls).toEqual([{ e164: '+16025551234', body: 'Hi Jane', nonce: 'n1' }])
})

test('/confirm with send_text on a server with no rail reports it is not set up, never a false send', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT])
  db.enqueue([TEXT_CONTACT])
  const res = await postJson(harness(db, {}), '/confirm', {
    verb: 'send_text',
    params: { contactId: 'c1', body: 'Hi', nonce: 'n1' },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { message: string }
  expect(body.message).toMatch(/not set up|isn't set up/i)
  expect(body.message).not.toMatch(/sent your text/i)
})

