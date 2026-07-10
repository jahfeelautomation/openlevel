import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { ClaudeClient, ContentBlock, CreateMessageInput } from '../lib/anthropic'
import { decodeActionRef, encodeActionRef } from '../lib/federation-types'
import type { SendTextFn, SendTextResult } from '../lib/operator-tools'
import { FakeDatabase } from '../db/fake-database'
import { type FederationRouteDeps, federationRoute } from './federation'

const TOKEN = 'fed-secret-token'

function harness(db: FakeDatabase, deps: Partial<FederationRouteDeps> = {}) {
  const app = new Hono<AppEnv>()
  app.route('/', federationRoute({ db, federationServiceToken: TOKEN, ...deps }))
  return app
}

function get(app: Hono<AppEnv>, path: string, headers: Record<string, string> = {}) {
  return app.request(path, { method: 'GET', headers })
}

const auth = { authorization: `Bearer ${TOKEN}` }
const tenant = { 'x-federation-tenant': 'locA' }

test('the whole surface is 503 while no token is configured', async () => {
  const app = new Hono<AppEnv>()
  app.route('/', federationRoute({ db: new FakeDatabase(), federationServiceToken: undefined }))
  const res = await get(app, '/federation/capabilities', { ...auth, ...tenant })
  expect(res.status).toBe(503)
})

test('401 on a missing or wrong bearer', async () => {
  const app = harness(new FakeDatabase())
  expect((await get(app, '/federation/capabilities', { ...tenant })).status).toBe(401)
  expect((await get(app, '/federation/capabilities', { authorization: 'Bearer nope', ...tenant })).status).toBe(401)
})

test('GET /capabilities returns the OpenLevel card', async () => {
  const app = harness(new FakeDatabase())
  const res = await get(app, '/federation/capabilities', { ...auth })
  expect(res.status).toBe(200)
  const card = (await res.json()) as { app: string; capabilities: unknown[] }
  expect(card.app).toBe('openlevel')
  expect(card.capabilities.length).toBe(6)
})

test('GET /today requires the tenant header', async () => {
  const app = harness(new FakeDatabase())
  expect((await get(app, '/federation/today', { ...auth })).status).toBe(400)
})

test('GET /today maps upcoming appointments + open tasks, carrying NO phone digits', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1', location_id: 'locA', title: 'Roof inspection - Jane', starts_at: '2026-06-21T17:00:00.000Z', status: 'scheduled' }]) // listByRange
  db.enqueue([
    { id: 't1', location_id: 'locA', contact_id: 'c1', contact_name: 'Jane Doe', title: 'Call back about the roof', due_at: '2026-06-19T17:00:00.000Z', completed_at: null }, // overdue
    { id: 't2', location_id: 'locA', contact_id: 'c2', contact_name: 'Sam Roe', title: 'Send quote', due_at: null, completed_at: '2026-06-18T00:00:00.000Z' }, // completed -> skipped
  ]) // listForLocation
  const res = await get(harness(db, { now: () => new Date('2026-06-20T12:00:00.000Z') }), '/federation/today', { ...auth, ...tenant })
  expect(res.status).toBe(200)
  const items = (await res.json()) as { id: string; title: string; urgency: number }[]
  const ids = items.map((i) => i.id)
  expect(ids).toContain('openlevel:appt:a1')
  expect(ids).toContain('openlevel:task:t1') // overdue, included
  expect(ids).not.toContain('openlevel:task:t2') // completed, skipped
  // overdue task outranks the appointment
  const t1 = items.find((i) => i.id === 'openlevel:task:t1')!
  const a1 = items.find((i) => i.id === 'openlevel:appt:a1')!
  expect(t1.urgency).toBeGreaterThan(a1.urgency)
  // no phone digits anywhere in the payload
  expect(JSON.stringify(items)).not.toMatch(/\d{3}[^a-z]?\d{3}[^a-z]?\d{4}/)
})

test('GET /today labels titles, filters tasks to the due window, and omits empty detail', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a9', location_id: 'locA', title: 'Roof check - Pat', starts_at: '2026-06-21T15:00:00.000Z', status: 'scheduled' }]) // listByRange
  db.enqueue([
    { id: 't_over', location_id: 'locA', contact_id: 'c1', contact_name: 'Alex Stone', title: 'Return call', due_at: '2026-06-18T00:00:00.000Z', completed_at: null }, // overdue
    { id: 't_soon', location_id: 'locA', contact_id: 'c2', contact_name: 'Robin Vale', title: 'Send quote', due_at: '2026-06-21T00:00:00.000Z', completed_at: null }, // due within window
    { id: 't_noname', location_id: 'locA', contact_id: 'c3', contact_name: null, title: 'Order parts', due_at: '2026-06-21T09:00:00.000Z', completed_at: null }, // due soon, no contact name
    { id: 't_future', location_id: 'locA', contact_id: 'c4', contact_name: 'Lee Park', title: 'Quarterly review', due_at: '2026-07-15T00:00:00.000Z', completed_at: null }, // beyond window -> dropped
    { id: 't_nodue', location_id: 'locA', contact_id: 'c5', contact_name: 'Drew Kim', title: 'Someday cleanup', due_at: null, completed_at: null }, // no due date -> dropped
  ]) // listForLocation
  const res = await get(harness(db, { now: () => new Date('2026-06-20T12:00:00.000Z') }), '/federation/today', { ...auth, ...tenant })
  expect(res.status).toBe(200)
  const items = (await res.json()) as { id: string; title: string; detail?: string; urgency: number }[]
  const ids = items.map((i) => i.id)
  // a "today" feed only shows things actually due today: future + no-due tasks drop out
  expect(ids).not.toContain('openlevel:task:t_future')
  expect(ids).not.toContain('openlevel:task:t_nodue')
  // titles carry a human label, matching the portal's TodayItem convention
  const a9 = items.find((i) => i.id === 'openlevel:appt:a9')!
  expect(a9.title).toBe('Appointment: Roof check - Pat')
  expect(a9.detail).toBe('starts 2026-06-21T15:00:00.000Z')
  expect(a9.urgency).toBe(7)
  const over = items.find((i) => i.id === 'openlevel:task:t_over')!
  expect(over.title).toBe('Task: Return call')
  expect(over.detail).toBe('Alex Stone · due 2026-06-18T00:00:00.000Z')
  expect(over.urgency).toBe(8)
  const soon = items.find((i) => i.id === 'openlevel:task:t_soon')!
  expect(soon.urgency).toBe(6)
  // detail drops the empty contact part (no leading separator, no filler text)
  const noname = items.find((i) => i.id === 'openlevel:task:t_noname')!
  expect(noname.detail).toBe('due 2026-06-21T09:00:00.000Z')
})

// REGRESSION: pg returns timestamptz columns (due_at / starts_at) as Date objects — there is
// no setTypeParser override — but the fixtures above use ISO strings. So the in-process window
// filter and overdue flag in buildToday silently no-op'd in production: `Date > string` and
// `Date < string` both coerce to NaN => false, so every dated task showed regardless of how
// far out, nothing was ever flagged overdue, and details rendered as Date.prototype.toString().
// This pins the real-driver (Date) shape so the bug can never come back.
test('GET /today handles Date-typed timestamps from pg (window filter + overdue flag + ISO detail)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'aD', location_id: 'locA', title: 'Site visit', starts_at: new Date('2026-06-21T15:00:00.000Z'), status: 'scheduled' }]) // listByRange -> pg Date
  db.enqueue([
    { id: 't_over', location_id: 'locA', contact_id: 'c1', contact_name: 'Zoe Hill', title: 'Call back', due_at: new Date('2025-11-13T00:00:00.000Z'), completed_at: null }, // long overdue
    { id: 't_soon', location_id: 'locA', contact_id: 'c2', contact_name: 'Max Reed', title: 'Renewal', due_at: new Date('2026-06-21T09:00:00.000Z'), completed_at: null }, // within the 2-day window
    { id: 't_future', location_id: 'locA', contact_id: 'c3', contact_name: 'Sam Vale', title: 'Annual review', due_at: new Date('2026-10-30T00:00:00.000Z'), completed_at: null }, // far future -> must drop
  ]) // listForLocation -> pg Dates
  const res = await get(harness(db, { now: () => new Date('2026-06-20T19:57:14.720Z') }), '/federation/today', { ...auth, ...tenant })
  expect(res.status).toBe(200)
  const items = (await res.json()) as { id: string; detail?: string; urgency: number }[]
  const ids = items.map((i) => i.id)
  // the window filter must operate on Date values: the far-future task drops out
  expect(ids).not.toContain('openlevel:task:t_future')
  expect(ids).toContain('openlevel:task:t_over')
  expect(ids).toContain('openlevel:task:t_soon')
  // the overdue flag must operate on Date values
  expect(items.find((i) => i.id === 'openlevel:task:t_over')!.urgency).toBe(8)
  expect(items.find((i) => i.id === 'openlevel:task:t_soon')!.urgency).toBe(6)
  // details render as clean ISO, never Date.prototype.toString()
  expect(items.find((i) => i.id === 'openlevel:appt:aD')!.detail).toBe('starts 2026-06-21T15:00:00.000Z')
  expect(items.find((i) => i.id === 'openlevel:task:t_over')!.detail).toBe('Zoe Hill · due 2025-11-13T00:00:00.000Z')
})

// ----- Task 4: POST /turn (propose, never mutate) -----

function postJson(app: Hono<AppEnv>, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function fakeClaude(text = 'You have 2 open tasks.') {
  const client: ClaudeClient = {
    createMessage: async () => ({ stopReason: 'end_turn', content: [{ type: 'text', text }] }),
  }
  return client
}

// Drives the real two-round tool loop: round 1 asks to run `toolName`, round 2
// answers with the tool_result text. A write tool_use becomes a PROPOSAL.
function toolUsingClaude(toolName: string, toolInput: Record<string, unknown> = {}) {
  const calls: CreateMessageInput[] = []
  const client: ClaudeClient = {
    createMessage: async (input) => {
      calls.push(input)
      if (calls.length === 1) {
        return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: toolName, input: toolInput }] }
      }
      const last = input.messages[input.messages.length - 1]
      const result = Array.isArray(last?.content)
        ? last.content.find((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result')
        : undefined
      return { stopReason: 'end_turn', content: [{ type: 'text', text: result?.content ?? '(no tool output)' }] }
    },
  }
  return { client, calls }
}

const LOC = { id: 'locA', name: 'Alex Co', slug: 'Alex', client_slug: 'Alex', branding: {}, settings: {} }

type TurnResponseLike = { reply: string; proposals: { ref: string; kind: string; approve: string; summary: string }[] }

test('POST /turn returns a reply and (here empty) proposals, requiring claude + tenant', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC]) // getById
  const res = await postJson(harness(db, { claude: fakeClaude(), resolveSecret: () => 'sk' }), '/federation/turn',
    { message: 'how many open tasks?' }, { ...auth, ...tenant })
  expect(res.status).toBe(200)
  const body = (await res.json()) as TurnResponseLike
  expect(body.reply).toMatch(/open tasks/i)
  expect(body.proposals).toEqual([])
})

test('POST /turn is 501 with no claude, 400 with no tenant, 400 on an empty message', async () => {
  const db = new FakeDatabase()
  expect((await postJson(harness(db, { resolveSecret: () => 'sk' }), '/federation/turn', { message: 'hi' }, { ...auth, ...tenant })).status).toBe(501)
  expect((await postJson(harness(db, { claude: fakeClaude(), resolveSecret: () => 'sk' }), '/federation/turn', { message: 'hi' }, { ...auth })).status).toBe(400)
  db.enqueue([LOC])
  expect((await postJson(harness(db, { claude: fakeClaude(), resolveSecret: () => 'sk' }), '/federation/turn', { message: '' }, { ...auth, ...tenant })).status).toBe(400)
})

test('GATE: a write tool_use becomes a confirm proposal whose ref decodes to {verb, params} — and NOTHING is written', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC]) // getById
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }]) // book resolve: contacts.get
  db.enqueue([{ id: 'cal1', location_id: 'locA', name: 'Roof Inspection', duration_min: 30, position: 0, booking_enabled: true, timezone: 'America/Phoenix' }]) // book resolve: calendars.list
  const { client } = toolUsingClaude('book_appointment', { contactId: 'c1', start: '2026-06-20T17:00:00Z' })
  const res = await postJson(harness(db, { claude: client, resolveSecret: () => 'sk' }), '/federation/turn',
    { message: 'book Jane for Friday' }, { ...auth, ...tenant })
  expect(res.status).toBe(200)
  const body = (await res.json()) as TurnResponseLike
  expect(body.proposals).toHaveLength(1)
  const p0 = body.proposals[0]!
  expect(p0.kind).toBe('confirm')
  expect(p0.approve).toBe('confirm-card')
  const decoded = decodeActionRef(p0.ref)
  expect(decoded).toMatchObject({ verb: 'book_appointment', params: { contactId: 'c1', start: '2026-06-20T17:00:00Z' } })
  // the chat turn performed ZERO writes
  expect(db.calls.every((q) => !/INSERT|UPDATE|DELETE/i.test(q.sql))).toBe(true)
})

// ----- Task 5: POST /confirm (one write, both shapes) + gate preservation -----

function fakeSendText(result: SendTextResult = { ok: true, messageId: 'm1' }) {
  const calls: Array<{ e164: string; body: string; nonce: string }> = []
  const fn: SendTextFn = async (e164, body, nonce) => {
    calls.push({ e164, body, nonce })
    return result
  }
  return { fn, calls }
}

const TEXT_CONTACT = { id: 'c1', location_id: 'locA', name: 'Jane Doe', phones: ['+16025551234'], emails: [], tags: [] }

type ConfirmResultLike = { ok: boolean; reason?: string; detail?: string }

test('POST /confirm performs a prepared write (verb+params), scoped to the tenant header, string detail', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }]) // re-resolve: contacts.get
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: ['vip'] }]) // addTag RETURNING
  const res = await postJson(harness(db, {}), '/federation/confirm',
    { verb: 'tag_contact', params: { contactId: 'c1', tag: 'vip' } }, { ...auth, ...tenant })
  expect(res.status).toBe(200)
  const body = (await res.json()) as ConfirmResultLike
  expect(body.ok).toBe(true)
  expect(typeof body.detail).toBe('string') // string, not object
  const writes = db.calls.filter((q) => /INSERT|UPDATE|DELETE/i.test(q.sql))
  expect(writes).toHaveLength(1)
  expect(writes[0]?.params[0]).toBe('locA') // trusted tenant from the header, not the body
})

test('POST /confirm accepts a proposalRef and decodes it to the same write', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }])
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: ['vip'] }])
  const ref = encodeActionRef({ verb: 'tag_contact', params: { contactId: 'c1', tag: 'vip' } })
  const res = await postJson(harness(db, {}), '/federation/confirm', { proposalRef: ref }, { ...auth, ...tenant })
  expect(res.status).toBe(200)
  expect(((await res.json()) as ConfirmResultLike).ok).toBe(true)
})

test('GATE: POST /confirm refuses a verb that is not a known write tool, touching nothing', async () => {
  const db = new FakeDatabase()
  const res = await postJson(harness(db, {}), '/federation/confirm',
    { verb: 'delete_everything', params: {} }, { ...auth, ...tenant })
  // a forged verb is a valid SHAPE but an invalid action: structured ok:false at 200
  expect(res.status).toBe(200)
  const body = (await res.json()) as ConfirmResultLike
  expect(body.ok).toBe(false)
  expect(db.calls).toHaveLength(0)
})

test('GATE: POST /confirm send_text reaches the rail with the DERIVED e164 (forged e164 ignored)', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT]) // resolve(confirm) -> prepareText -> contacts.get
  db.enqueue([TEXT_CONTACT]) // perform -> prepareText -> contacts.get
  const { fn, calls } = fakeSendText({ ok: true, messageId: 'gw1' })
  const res = await postJson(harness(db, { sendText: fn }), '/federation/confirm',
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi Jane', nonce: 'n1', e164: '+19998887777' } },
    { ...auth, ...tenant })
  expect(res.status).toBe(200)
  expect(((await res.json()) as ConfirmResultLike).ok).toBe(true)
  expect(calls).toEqual([{ e164: '+16025551234', body: 'Hi Jane', nonce: 'n1' }]) // contact's real number, not the forged one
})

test('GATE: POST /confirm send_text with no rail reports it is not set up, never a false send', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT])
  db.enqueue([TEXT_CONTACT])
  const res = await postJson(harness(db, {}), '/federation/confirm',
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi', nonce: 'n1' } }, { ...auth, ...tenant })
  expect(res.status).toBe(200)
  const body = (await res.json()) as ConfirmResultLike
  // No rail wired, so nothing is sent; confirmOperatorWrite reports it honestly (an ok:true
  // result carrying a "not set up" message). The assertion is on the whole body, so it holds
  // however that surfaces, never a false "sent".
  expect(JSON.stringify(body)).toMatch(/not set up|isn't set up/i)
  expect(JSON.stringify(body)).not.toMatch(/sent your text/i)
})

test('POST /confirm requires the tenant header and rejects a malformed body', async () => {
  const db = new FakeDatabase()
  expect((await postJson(harness(db, {}), '/federation/confirm', { verb: 'tag_contact', params: {} }, { ...auth })).status).toBe(400) // no tenant
  expect((await postJson(harness(db, {}), '/federation/confirm', { nope: true }, { ...auth, ...tenant })).status).toBe(400) // bad shape
  expect((await postJson(harness(db, {}), '/federation/confirm', { proposalRef: 'portal:not-ours' }, { ...auth, ...tenant })).status).toBe(400) // un-decodable ref
})

