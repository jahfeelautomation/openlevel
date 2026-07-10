import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import type { CallEvent, VoiceProvider, WebhookInput } from '../lib/voice/provider'
import type { ResolvedVoice } from '../lib/voice/resolve'
import { voiceWebhookRoute } from './webhooks-voice'

/** A fake voice provider: signature = the literal header 'x-test-signature:
 *  good'; events come from the canned queue. The adapters' own tests cover the
 *  real HMAC/secret plumbing. */
function fakeProvider(name: string, events: CallEvent[]): VoiceProvider & { seenUrls: string[] } {
  const seenUrls: string[] = []
  return {
    name,
    seenUrls,
    placeCall: vi.fn(async () => ({ externalId: 'x', provider: name })),
    verifyWebhook(input: WebhookInput): boolean {
      seenUrls.push(input.url)
      return input.headers['x-test-signature'] === 'good'
    },
    parseEvent(): CallEvent {
      return events.shift() ?? { type: 'ignored' }
    },
  }
}

function harness(db: FakeDatabase, resolved: ResolvedVoice) {
  const app = new Hono<AppEnv>()
  app.route('/', voiceWebhookRoute({ db, resolveVoice: async () => resolved }))
  return app
}

function deliver(app: Hono<AppEnv>, path: string, signature = 'good', headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signature': signature, ...headers },
    body: '{"some":"event"}',
  })
}

const UPDATE: CallEvent = {
  type: 'call_update',
  externalId: 'CA_1',
  status: 'completed',
  direction: 'outbound',
  from: '+14805550111',
  to: '+16025550123',
  durationSeconds: 95,
}

test('404 when the location has no voice provider connected', async () => {
  const db = new FakeDatabase()
  const res = await deliver(harness(db, { ok: false, reason: 'no voice provider connected' }), '/webhook/twilio/locA')
  expect(res.status).toBe(404)
  expect(db.calls).toHaveLength(0)
})

test('404 when the URL names a different provider than the location connected', async () => {
  const db = new FakeDatabase()
  const provider = fakeProvider('twilio', [])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/vapi/locA')
  expect(res.status).toBe(404)
})

test('401 on a bad signature, before any parsing or DB access', async () => {
  const db = new FakeDatabase()
  const provider = fakeProvider('twilio', [UPDATE])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/twilio/locA', 'forged')
  expect(res.status).toBe(401)
  expect(db.calls).toHaveLength(0)
})

test('verification sees the https URL when X-Forwarded-Proto says so (Twilio signs over it)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'call1', inserted: true }])
  const provider = fakeProvider('twilio', [UPDATE])
  await deliver(harness(db, { ok: true, provider }), '/webhook/twilio/locA', 'good', {
    'x-forwarded-proto': 'https',
  })
  expect(provider.seenUrls[0]).toMatch(/^https:\/\//)
})

test('a verified call update upserts the scoped log row by the provider call id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'call1', location_id: 'locA', status: 'completed', inserted: false }])
  const provider = fakeProvider('twilio', [UPDATE])

  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/twilio/locA')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, applied: true, inserted: false })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO calls/i)
  expect(call?.sql).toMatch(/ON CONFLICT \(location_id, provider, external_id\)/i)
  expect(call?.params?.[0]).toBe('locA') // scoped to the URL's location
  expect(call?.params).toContain('CA_1')
  expect(call?.params).toContain(95)
})

test('an inbound call we never placed inserts honestly', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'call_new', location_id: 'locA', direction: 'inbound', inserted: true }])
  const provider = fakeProvider('vapi', [
    { type: 'call_update', externalId: 'cv_9', status: 'ringing', direction: 'inbound', from: '+16025550123' },
  ])

  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/vapi/locA')
  expect(await res.json()).toEqual({ ok: true, applied: true, inserted: true })
  expect(db.calls[0]?.params).toContain('inbound')
})

test('an event the adapter does not act on answers 200 ignored without touching the DB', async () => {
  const db = new FakeDatabase()
  const provider = fakeProvider('twilio', [{ type: 'ignored' }])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/twilio/locA')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, ignored: true })
  expect(db.calls).toHaveLength(0)
})
