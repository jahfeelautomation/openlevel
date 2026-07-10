import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import type { VoiceProvider } from '../lib/voice/provider'
import type { resolveVoiceProvider } from '../lib/voice/resolve'
import { callsRoute } from './calls'

function fakeProvider(name: string): VoiceProvider {
  return {
    name,
    placeCall: vi.fn(async () => ({ externalId: 'CA_placed_1', provider: name, from: '+14805550111' })),
    verifyWebhook: () => false,
    parseEvent: () => ({ type: 'ignored' as const }),
  }
}

function harness(db: FakeDatabase, resolveVoice: typeof resolveVoiceProvider) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', 'locA')
    await next()
  })
  app.route('/', callsRoute({ db, resolveVoice }))
  return app
}

function postCall(app: Hono<AppEnv>, body: unknown) {
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / returns the scoped call log plus derived stats', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { id: 'call1', location_id: 'locA', direction: 'outbound', status: 'completed', duration_seconds: 120 },
    { id: 'call2', location_id: 'locA', direction: 'inbound', status: 'no-answer', duration_seconds: null },
  ])
  const res = await harness(db, async () => ({ ok: true, provider: fakeProvider('twilio') })).request('/')

  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.calls).toHaveLength(2)
  expect(body.stats).toEqual({
    total: 2,
    inbound: 1,
    outbound: 1,
    completed: 1,
    connectedRate: 50,
    avgDurationSeconds: 120,
  })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / places the call through the resolved provider and records the log row', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', phones: ['+16025550123'] }]) // contact get
  db.enqueue([{ id: 'call_new', location_id: 'locA', status: 'queued', external_id: 'CA_placed_1' }]) // insert
  const provider = fakeProvider('twilio')
  const seenOpts: unknown[] = []
  const res = await postCall(
    harness(db, async (_db, _loc, opts) => {
      seenOpts.push(opts)
      return { ok: true, provider }
    }),
    { contactId: 'c1' },
  )

  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.call.id).toBe('call_new')
  expect(provider.placeCall).toHaveBeenCalledWith({ to: '+16025550123' })
  // The Twilio status callback points at the signature-verified public webhook.
  expect((seenOpts[0] as { statusCallbackUrl?: string }).statusCallbackUrl).toMatch(
    /\/api\/public\/voice\/webhook\/twilio\/locA$/,
  )
  // The insert links the contact and keeps the provider's call id.
  const insert = db.calls[1]
  expect(insert?.sql).toMatch(/INSERT INTO calls/i)
  expect(insert?.params?.[0]).toBe('locA')
  expect(insert?.params).toContain('c1')
  expect(insert?.params).toContain('CA_placed_1')
  expect(insert?.params).toContain('+16025550123')
})

test('POST / answers 404 for an unknown contact and 422 for one without a phone', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // contact miss
  const app = harness(db, async () => ({ ok: true, provider: fakeProvider('twilio') }))
  expect((await postCall(app, { contactId: 'ghost' })).status).toBe(404)

  db.enqueue([{ id: 'c2', location_id: 'locA', phones: [] }])
  const res = await postCall(app, { contactId: 'c2' })
  expect(res.status).toBe(422)
  expect((await res.json()).error).toBe('contact has no phone number')
})

test('POST / surfaces the resolver refusal as a 409 instead of pretending to call', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', phones: ['+16025550123'] }])
  const res = await postCall(
    harness(db, async () => ({ ok: false, reason: 'no voice provider connected' })),
    { contactId: 'c1' },
  )
  expect(res.status).toBe(409)
  expect((await res.json()).error).toBe('no voice provider connected')
})

test('POST / answers 502 with the adapter error when the provider rejects the call', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', phones: ['+16025550123'] }])
  const provider = fakeProvider('twilio')
  ;(provider.placeCall as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('twilio call failed: 401'))
  const res = await postCall(harness(db, async () => ({ ok: true, provider })), { contactId: 'c1' })
  expect(res.status).toBe(502)
  expect((await res.json()).error).toBe('twilio call failed: 401')
  // No call row is invented for a call that never happened.
  expect(db.calls.filter((q) => /INSERT INTO calls/i.test(q.sql))).toHaveLength(0)
})
