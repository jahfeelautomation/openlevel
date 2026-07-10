import { afterEach, describe, expect, it } from 'vitest'
import { FakeDatabase } from '../../db/fake-database'
import { resolveVoiceProvider } from './resolve'

// Secrets resolve by NAME via the env-backed vault layer. Twilio voice REUSES
// the SMS channel's keys (<slug>:twilio:account_sid -> ACME_TWILIO_ACCOUNT_SID);
// Vapi gets its own (<slug>:vapi:api_key -> ACME_VAPI_API_KEY).
const ENV_KEYS = [
  'ACME_TWILIO_ACCOUNT_SID',
  'ACME_TWILIO_AUTH_TOKEN',
  'ACME_VAPI_API_KEY',
  'ACME_VAPI_WEBHOOK_SECRET',
]

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

function dbWithLocation(voice: Record<string, unknown>, clientSlug: string | null = 'acme') {
  const db = new FakeDatabase()
  db.enqueue([
    { id: 'locA', name: 'Acme', slug: 'acme-loc', client_slug: clientSlug, branding: {}, settings: { voice } },
  ])
  return db
}

const twilioVoice = { provider: 'twilio', fromNumber: '+14805550111', operatorNumber: '+14809802287' }
const vapiVoice = { provider: 'vapi', vapiAssistantId: 'asst_42', vapiPhoneNumberId: 'pn_7' }

describe('resolveVoiceProvider: twilio', () => {
  it("reuses the SMS channel's twilio keys when the numbers are configured", async () => {
    process.env.ACME_TWILIO_ACCOUNT_SID = 'AC_fake'
    process.env.ACME_TWILIO_AUTH_TOKEN = 'tok_fake'
    const resolved = await resolveVoiceProvider(dbWithLocation(twilioVoice), 'locA')
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.provider.name).toBe('twilio')
  })

  it('reports each missing piece honestly instead of throwing', async () => {
    expect(await resolveVoiceProvider(dbWithLocation(twilioVoice), 'locA')).toEqual({
      ok: false,
      reason: 'twilio keys are not configured',
    })
    process.env.ACME_TWILIO_ACCOUNT_SID = 'AC_fake'
    process.env.ACME_TWILIO_AUTH_TOKEN = 'tok_fake'
    expect(
      await resolveVoiceProvider(dbWithLocation({ provider: 'twilio', operatorNumber: '+1' }), 'locA'),
    ).toEqual({ ok: false, reason: 'voice from number is not configured' })
    expect(
      await resolveVoiceProvider(dbWithLocation({ provider: 'twilio', fromNumber: '+1' }), 'locA'),
    ).toEqual({ ok: false, reason: 'operator phone number is not configured' })
  })
})

describe('resolveVoiceProvider: vapi', () => {
  it('builds the vapi adapter when the key resolves and both ids are configured', async () => {
    process.env.ACME_VAPI_API_KEY = 'vapi_fake'
    const resolved = await resolveVoiceProvider(dbWithLocation(vapiVoice), 'locA')
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.provider.name).toBe('vapi')
  })

  it('reports each missing piece honestly', async () => {
    expect(await resolveVoiceProvider(dbWithLocation(vapiVoice), 'locA')).toEqual({
      ok: false,
      reason: 'vapi key is not configured',
    })
    process.env.ACME_VAPI_API_KEY = 'vapi_fake'
    expect(
      await resolveVoiceProvider(dbWithLocation({ provider: 'vapi', vapiPhoneNumberId: 'pn_7' }), 'locA'),
    ).toEqual({ ok: false, reason: 'vapi assistant id is not configured' })
    expect(
      await resolveVoiceProvider(dbWithLocation({ provider: 'vapi', vapiAssistantId: 'asst_42' }), 'locA'),
    ).toEqual({ ok: false, reason: 'vapi phone number id is not configured' })
  })

  it('the webhook secret stays optional — placing calls works without it', async () => {
    process.env.ACME_VAPI_API_KEY = 'vapi_fake'
    const resolved = await resolveVoiceProvider(dbWithLocation(vapiVoice), 'locA')
    expect(resolved.ok).toBe(true)
    // Fails closed downstream: without the secret the adapter refuses webhooks.
    if (resolved.ok) {
      expect(
        resolved.provider.verifyWebhook({ rawBody: '{}', headers: { 'x-vapi-secret': 'x' }, url: 'https://x' }),
      ).toBe(false)
    }
  })
})

describe('resolveVoiceProvider: edges', () => {
  it('reports no provider connected for none/absent settings', async () => {
    expect(await resolveVoiceProvider(dbWithLocation({}), 'locA')).toEqual({
      ok: false,
      reason: 'no voice provider connected',
    })
    expect(await resolveVoiceProvider(dbWithLocation({ provider: 'none' }), 'locA')).toEqual({
      ok: false,
      reason: 'no voice provider connected',
    })
  })

  it('falls back to the location slug when there is no client_slug', async () => {
    process.env.ACME_LOC_VAPI_API_KEY = 'vapi_fake'
    try {
      const resolved = await resolveVoiceProvider(dbWithLocation(vapiVoice, null), 'locA')
      expect(resolved.ok).toBe(true)
    } finally {
      delete process.env.ACME_LOC_VAPI_API_KEY
    }
  })

  it('reports a missing location', async () => {
    const db = new FakeDatabase()
    db.enqueue([])
    expect(await resolveVoiceProvider(db, 'nope')).toEqual({ ok: false, reason: 'location not found' })
  })
})
