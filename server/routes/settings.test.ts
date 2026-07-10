import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import type { ResolvedProvider } from '../lib/payments/resolve'
import type { ResolvedEmailSender, ResolvedSmsSender } from '../lib/sending/resolve'
import { settingsRoute } from './settings'

function harness(db: FakeDatabase, locationId = 'locA', resolved?: ResolvedProvider) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', settingsRoute({ db, ...(resolved ? { resolvePayments: async () => resolved } : {}) }))
  return app
}

function sendJson(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET /agent returns the current reply mode + agent config, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { replyMode: 'autonomous', agent: { persona: 'Ada', facts: ['Open daily'] } } }])
  const res = await harness(db).request('/agent')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    replyMode: 'autonomous',
    agent: { persona: 'Ada', facts: ['Open daily'] },
  })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('GET /agent defaults to approve-first for a fresh location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: {} }])
  const res = await harness(db).request('/agent')
  expect(await res.json()).toEqual({ replyMode: 'approve-first', agent: {} })
})

test('PATCH /agent persists a change and echoes the merged view', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { replyMode: 'autonomous', agent: { persona: 'Ada', enabled: true } } }]) // RETURNING
  const res = await sendJson(harness(db), '/agent', 'PATCH', {
    replyMode: 'autonomous',
    enabled: true,
    persona: 'Ada',
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    replyMode: 'autonomous',
    agent: { persona: 'Ada', enabled: true },
  })
  // the write was scoped and split root vs agent patch
  expect(db.calls[0]?.params[0]).toBe('locA')
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ replyMode: 'autonomous' })
  expect(JSON.parse(db.calls[0]?.params[2] as string)).toEqual({ enabled: true, persona: 'Ada' })
})

test('PATCH /agent drops blank facts rows rather than rejecting them', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { agent: { facts: ['Real fact'] } } }])
  const res = await sendJson(harness(db), '/agent', 'PATCH', {
    facts: ['Real fact', '', '   '],
  })
  expect(res.status).toBe(200)
  expect(JSON.parse(db.calls[0]?.params[2] as string)).toEqual({ facts: ['Real fact'] })
})

test('PATCH /agent rejects an unknown reply mode (400) without touching the DB', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/agent', 'PATCH', { replyMode: 'yolo' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /agent allows clearing the persona back to the default', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { agent: {} } }])
  const res = await sendJson(harness(db), '/agent', 'PATCH', { persona: '' })
  expect(res.status).toBe(200)
  // empty string is sent through so the merge clears it; readAgentConfig then
  // drops it, so the view reports no persona (default applies at prompt time)
  expect(JSON.parse(db.calls[0]?.params[2] as string)).toEqual({ persona: '' })
  expect(await res.json()).toEqual({ ok: true, replyMode: 'approve-first', agent: {} })
})

// ---- /payments (Module 48: which processor this location connected)

const CONNECTED: ResolvedProvider = {
  ok: true,
  provider: { name: 'stripe', createCheckoutLink: async () => ({ url: 'x', externalId: 'x', provider: 'stripe' }), verifyWebhook: () => true, parseEvent: () => ({ type: 'ignored' }) },
}

test('GET /payments returns the choice plus an honest connected readout', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { payments: { provider: 'stripe' } } }])
  const res = await harness(db, 'locA', CONNECTED).request('/payments')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ provider: 'stripe', squareLocationId: null, connected: true })
})

test('GET /payments defaults to none + a reason when nothing is connected', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: {} }])
  const res = await harness(db, 'locA', { ok: false, reason: 'no payment provider connected' }).request('/payments')
  expect(await res.json()).toEqual({
    provider: 'none',
    squareLocationId: null,
    connected: false,
    reason: 'no payment provider connected',
  })
})

test('GET /payments reports a chosen provider whose keys are missing as NOT connected', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { payments: { provider: 'stripe' } } }])
  const res = await harness(db, 'locA', { ok: false, reason: 'stripe keys are not configured' }).request('/payments')
  expect(await res.json()).toEqual({
    provider: 'stripe',
    squareLocationId: null,
    connected: false,
    reason: 'stripe keys are not configured',
  })
})

test('PATCH /payments persists the choice under {payments} atomically', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { payments: { provider: 'square', squareLocationId: 'SQ_LOC' } } }]) // RETURNING
  const res = await sendJson(harness(db, 'locA', CONNECTED), '/payments', 'PATCH', {
    provider: 'square',
    squareLocationId: 'SQ_LOC',
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, provider: 'square', squareLocationId: 'SQ_LOC', connected: true })
  expect(db.calls[0]?.sql).toMatch(/jsonb_set/)
  expect(db.calls[0]?.sql).toMatch(/\{payments\}/)
  expect(db.calls[0]?.params[0]).toBe('locA')
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ provider: 'square', squareLocationId: 'SQ_LOC' })
})

test('PATCH /payments rejects an unknown provider (400) without touching the DB', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db, 'locA', CONNECTED), '/payments', 'PATCH', { provider: 'paypal' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /payments never accepts raw keys — unknown fields are simply dropped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { payments: { provider: 'stripe' } } }])
  const res = await sendJson(harness(db, 'locA', CONNECTED), '/payments', 'PATCH', {
    provider: 'stripe',
    secretKey: 'sk_live_should_never_land',
  })
  expect(res.status).toBe(200)
  // the write contains only the whitelisted fields — no credential ever lands in settings
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ provider: 'stripe' })
})

// ---- /sending (Module 49: which providers carry this location's campaigns)

const EMAIL_OK: ResolvedEmailSender = {
  ok: true,
  sender: { name: 'brevo', sendEmail: async () => ({ externalId: 'x', provider: 'brevo' }) },
}
const SMS_OK: ResolvedSmsSender = {
  ok: true,
  sender: { name: 'twilio', sendSms: async () => ({ externalId: 'x', provider: 'twilio' }) },
}
const EMAIL_OFF: ResolvedEmailSender = { ok: false, reason: 'no email provider connected' }
const SMS_OFF: ResolvedSmsSender = { ok: false, reason: 'no sms provider connected' }

function sendingHarness(db: FakeDatabase, email: ResolvedEmailSender, sms: ResolvedSmsSender) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', 'locA')
    await next()
  })
  app.route('/', settingsRoute({ db, resolveEmail: async () => email, resolveSms: async () => sms }))
  return app
}

test('GET /sending returns the choices plus honest per-channel readouts', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { sending: { emailProvider: 'brevo', fromEmail: 'Alex@deals.com', fromName: 'Alex' } } }])
  const res = await sendingHarness(db, EMAIL_OK, SMS_OFF).request('/sending')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    emailProvider: 'brevo',
    fromEmail: 'Alex@deals.com',
    fromName: 'Alex',
    smsProvider: 'none',
    smsFrom: null,
    email: { connected: true },
    sms: { connected: false, reason: 'no sms provider connected' },
  })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('GET /sending defaults to none on both channels for a fresh location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: {} }])
  const res = await sendingHarness(db, EMAIL_OFF, SMS_OFF).request('/sending')
  expect(await res.json()).toEqual({
    emailProvider: 'none',
    fromEmail: null,
    fromName: null,
    smsProvider: 'none',
    smsFrom: null,
    email: { connected: false, reason: 'no email provider connected' },
    sms: { connected: false, reason: 'no sms provider connected' },
  })
})

test('PATCH /sending persists the choice under {sending} atomically', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { sending: { smsProvider: 'twilio', smsFrom: '+16025550100' } } }]) // RETURNING
  const res = await sendJson(sendingHarness(db, EMAIL_OFF, SMS_OK), '/sending', 'PATCH', {
    smsProvider: 'twilio',
    smsFrom: '+16025550100',
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({
    ok: true,
    smsProvider: 'twilio',
    smsFrom: '+16025550100',
    sms: { connected: true },
  })
  expect(db.calls[0]?.sql).toMatch(/jsonb_set/)
  expect(db.calls[0]?.sql).toMatch(/\{sending\}/)
  expect(db.calls[0]?.params[0]).toBe('locA')
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ smsProvider: 'twilio', smsFrom: '+16025550100' })
})

test('PATCH /sending rejects an unknown provider (400) without touching the DB', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(sendingHarness(db, EMAIL_OFF, SMS_OFF), '/sending', 'PATCH', {
    emailProvider: 'sendgrid',
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /sending never accepts raw keys — unknown fields are simply dropped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { sending: { emailProvider: 'brevo' } } }])
  const res = await sendJson(sendingHarness(db, EMAIL_OK, SMS_OFF), '/sending', 'PATCH', {
    emailProvider: 'brevo',
    apiKey: 'xkeysib-should-never-land',
  })
  expect(res.status).toBe(200)
  // the write contains only the whitelisted fields — no credential ever lands in settings
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ emailProvider: 'brevo' })
})

// ---- /social (Module 50: the channels this location publishes through)

function socialHarness(db: FakeDatabase, okPlatforms: string[], reasons: Record<string, string> = {}) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', 'locA')
    await next()
  })
  app.route(
    '/',
    settingsRoute({
      db,
      resolveSocial: async (_db, _loc, platform) =>
        okPlatforms.includes(platform)
          ? {
              ok: true,
              publisher: { platform, publish: async () => ({ externalId: 'x', platform }) },
            }
          : { ok: false, reason: reasons[platform] ?? `${platform} is not configured` },
      // google_business has no publish adapter — its honest readout comes from
      // the review-sync resolver instead (Module 51).
      resolveReviews: async (_db, _loc, source) =>
        okPlatforms.includes('google_business') && source === 'google'
          ? { ok: true, reviewSource: { source: 'google', fetchReviews: async () => [] } }
          : { ok: false, reason: reasons.google_business ?? `${source} reviews are not configured` },
    }),
  )
  return app
}

test('GET /social returns the channel ids plus an honest per-platform readout', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { social: { facebookPageId: '1234', linkedinAuthorUrn: 'urn:li:organization:55' } } }])
  const res = await socialHarness(db, ['facebook'], {
    instagram: 'instagram account id is not configured',
    linkedin: 'linkedin access token is not configured',
    x: 'x access token is not configured',
    google_business: 'google business account id is not configured',
  }).request('/social')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    facebookPageId: '1234',
    instagramUserId: null,
    linkedinAuthorUrn: 'urn:li:organization:55',
    googleAccountId: null,
    googleLocationId: null,
    channels: {
      facebook: { connected: true },
      instagram: { connected: false, reason: 'instagram account id is not configured' },
      linkedin: { connected: false, reason: 'linkedin access token is not configured' },
      x: { connected: false, reason: 'x access token is not configured' },
      google_business: { connected: false, reason: 'google business account id is not configured' },
    },
  })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('GET /social reports google_business connected when the review-sync resolver is satisfied', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { social: { googleAccountId: 'acc1', googleLocationId: 'gloc9' } } }])
  const res = await socialHarness(db, ['google_business']).request('/social')

  const body = (await res.json()) as {
    googleAccountId: string | null
    channels: Record<string, { connected: boolean }>
  }
  expect(body.googleAccountId).toBe('acc1')
  expect(body.channels.google_business).toEqual({ connected: true })
})

test('PATCH /social persists the ids under {social} atomically', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { social: { facebookPageId: '1234', instagramUserId: '178414' } } }]) // RETURNING
  const res = await sendJson(socialHarness(db, ['facebook', 'instagram']), '/social', 'PATCH', {
    facebookPageId: '1234',
    instagramUserId: '178414',
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({
    ok: true,
    facebookPageId: '1234',
    instagramUserId: '178414',
    channels: { facebook: { connected: true }, instagram: { connected: true } },
  })
  expect(db.calls[0]?.sql).toMatch(/jsonb_set/)
  expect(db.calls[0]?.sql).toMatch(/\{social\}/)
  expect(db.calls[0]?.params[0]).toBe('locA')
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ facebookPageId: '1234', instagramUserId: '178414' })
})

test('PATCH /social never accepts raw tokens — unknown fields are simply dropped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { social: { facebookPageId: '1234' } } }])
  const res = await sendJson(socialHarness(db, []), '/social', 'PATCH', {
    facebookPageId: '1234',
    pageToken: 'EAA_should_never_land',
    accessToken: 'also_never',
  })
  expect(res.status).toBe(200)
  // the write contains only the whitelisted ids — no credential ever lands in settings
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ facebookPageId: '1234' })
})

test('PATCH /social persists the Google Business ids (Module 51)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { social: { googleAccountId: 'acc1', googleLocationId: 'gloc9' } } }])
  const res = await sendJson(socialHarness(db, []), '/social', 'PATCH', {
    googleAccountId: 'acc1',
    googleLocationId: 'gloc9',
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, googleAccountId: 'acc1', googleLocationId: 'gloc9' })
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({
    googleAccountId: 'acc1',
    googleLocationId: 'gloc9',
  })
})

// ---- /voice (Module 52: the voice provider this location connects)

function voiceHarness(db: FakeDatabase, resolved: { ok: true } | { ok: false; reason: string }) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', 'locA')
    await next()
  })
  app.route(
    '/',
    settingsRoute({
      db,
      resolveVoice: async () =>
        resolved.ok
          ? { ok: true, provider: { name: 'twilio', placeCall: async () => ({ externalId: 'x', provider: 'twilio' }), verifyWebhook: () => false, parseEvent: () => ({ type: 'ignored' as const }) } }
          : resolved,
    }),
  )
  return app
}

test('GET /voice returns the settings plus an honest connected readout', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { settings: { voice: { provider: 'twilio', fromNumber: '+14805550111', operatorNumber: '+14809802287' } } },
  ])
  const res = await voiceHarness(db, { ok: true }).request('/voice')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    provider: 'twilio',
    fromNumber: '+14805550111',
    operatorNumber: '+14809802287',
    vapiAssistantId: null,
    vapiPhoneNumberId: null,
    connected: true,
  })
})

test('GET /voice surfaces the refusal reason instead of claiming connected', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { voice: { provider: 'twilio' } } }])
  const res = await voiceHarness(db, { ok: false, reason: 'twilio keys are not configured' }).request('/voice')
  const body = await res.json()
  expect(body.connected).toBe(false)
  expect(body.reason).toBe('twilio keys are not configured')
})

test('PATCH /voice persists numbers/ids under {voice} and echoes the merged view', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { voice: { provider: 'vapi', vapiAssistantId: 'asst_42', vapiPhoneNumberId: 'pn_7' } } }])
  const res = await sendJson(voiceHarness(db, { ok: true }), '/voice', 'PATCH', {
    provider: 'vapi',
    vapiAssistantId: 'asst_42',
    vapiPhoneNumberId: 'pn_7',
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.provider).toBe('vapi')
  expect(body.connected).toBe(true)
  const call = db.calls[0]
  expect(call?.sql).toMatch(/\{voice\}/)
  expect(call?.params[0]).toBe('locA')
})

test('PATCH /voice rejects an unknown provider and never accepts credentials', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(voiceHarness(db, { ok: true }), '/voice', 'PATCH', { provider: 'skype' })
  expect(res.status).toBe(400)
  // A credential-shaped field is simply not part of the schema — stripped, never stored.
  db.enqueue([{ settings: { voice: {} } }])
  const res2 = await sendJson(voiceHarness(db, { ok: true }), '/voice', 'PATCH', { authToken: 'tok_evil' })
  expect(res2.status).toBe(200)
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({})
})

