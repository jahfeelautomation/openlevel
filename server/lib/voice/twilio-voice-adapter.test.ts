import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createTwilioVoiceAdapter } from './twilio-voice-adapter'

const ACCOUNT_SID = 'ACfake0000000000000000000000000000'
const AUTH_TOKEN = 'twilio-auth-fake-not-real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 201 }))
}

function adapter(overrides: Partial<Parameters<typeof createTwilioVoiceAdapter>[0]> = {}) {
  return createTwilioVoiceAdapter({
    accountSid: ACCOUNT_SID,
    authToken: AUTH_TOKEN,
    from: '+14805550111',
    operatorNumber: '+14809802287',
    ...overrides,
  })
}

describe('twilio voice adapter: placeCall', () => {
  it('POSTs a bridge call: ring the customer from the location number, Dial connects the operator', async () => {
    const fetchImpl = okFetch({ sid: 'CA_fake_123' })
    const twilio = adapter({ fetchImpl })

    const placed = await twilio.placeCall({ to: '+16025550123' })

    expect(placed).toEqual({ externalId: 'CA_fake_123', provider: 'twilio', from: '+14805550111' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json`)
    const expectedAuth = `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`
    expect((init.headers as Record<string, string>).authorization).toBe(expectedAuth)
    const body = new URLSearchParams(String(init.body))
    expect(body.get('To')).toBe('+16025550123')
    expect(body.get('From')).toBe('+14805550111')
    expect(body.get('Twiml')).toBe('<Response><Dial>+14809802287</Dial></Response>')
    // No callback configured -> none requested.
    expect(body.get('StatusCallback')).toBeNull()
  })

  it('requests status callbacks when a callback URL is configured', async () => {
    const fetchImpl = okFetch({ sid: 'CA_fake_124' })
    const twilio = adapter({ fetchImpl, statusCallbackUrl: 'https://app.example.com/api/public/voice/jamal/twilio' })

    await twilio.placeCall({ to: '+16025550123' })

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = new URLSearchParams(String(init.body))
    expect(body.get('StatusCallback')).toBe('https://app.example.com/api/public/voice/jamal/twilio')
    expect(body.get('StatusCallbackMethod')).toBe('POST')
    expect(body.getAll('StatusCallbackEvent')).toEqual(['initiated', 'ringing', 'answered', 'completed'])
  })

  it('XML-escapes the operator number so a hostile settings value cannot reshape the TwiML', async () => {
    const fetchImpl = okFetch({ sid: 'CA_fake_125' })
    const twilio = adapter({ fetchImpl, operatorNumber: '+1<Hangup/>' })

    await twilio.placeCall({ to: '+16025550123' })

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = new URLSearchParams(String(init.body))
    expect(body.get('Twiml')).toBe('<Response><Dial>+1&lt;Hangup/&gt;</Dial></Response>')
  })

  it('throws with the status when Twilio rejects the call, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"code":20003}', { status: 401 }))
    const twilio = adapter({ fetchImpl })
    await expect(twilio.placeCall({ to: '+1' })).rejects.toThrow(/401/)
    await expect(twilio.placeCall({ to: '+1' })).rejects.not.toThrow(new RegExp(AUTH_TOKEN))
  })

  it('throws when the response has no call sid', async () => {
    const twilio = adapter({ fetchImpl: okFetch({}) })
    await expect(twilio.placeCall({ to: '+1' })).rejects.toThrow(/missing sid/)
  })
})

describe('twilio voice adapter: verifyWebhook', () => {
  const url = 'https://app.example.com/api/public/voice/jamal/twilio'
  const rawBody = 'CallSid=CA_fake_123&CallStatus=completed&To=%2B16025550123&From=%2B14805550111'

  function sign(deliveredUrl: string, body: string, token: string): string {
    const entries = [...new URLSearchParams(body).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const signed = deliveredUrl + entries.map(([k, v]) => k + v).join('')
    return createHmac('sha1', token).update(signed).digest('base64')
  }

  it('accepts a delivery signed with the auth token over url + sorted params', () => {
    const twilio = adapter()
    const headers = { 'x-twilio-signature': sign(url, rawBody, AUTH_TOKEN) }
    expect(twilio.verifyWebhook({ rawBody, headers, url })).toBe(true)
  })

  it('rejects a bad signature, a missing header, and a replay at a different URL', () => {
    const twilio = adapter()
    expect(twilio.verifyWebhook({ rawBody, headers: { 'x-twilio-signature': 'AAAA' }, url })).toBe(false)
    expect(twilio.verifyWebhook({ rawBody, headers: {}, url })).toBe(false)
    // Signed for another endpoint -> the URL is part of the signature.
    const headers = { 'x-twilio-signature': sign('https://elsewhere.example.com/hook', rawBody, AUTH_TOKEN) }
    expect(twilio.verifyWebhook({ rawBody, headers, url })).toBe(false)
  })
})

describe('twilio voice adapter: parseEvent', () => {
  it('normalizes a status callback into a call update', () => {
    const twilio = adapter()
    const event = twilio.parseEvent(
      'CallSid=CA_1&CallStatus=completed&Direction=outbound-api&From=%2B14805550111&To=%2B16025550123&CallDuration=95',
    )
    expect(event).toEqual({
      type: 'call_update',
      externalId: 'CA_1',
      status: 'completed',
      direction: 'outbound',
      from: '+14805550111',
      to: '+16025550123',
      durationSeconds: 95,
      recordingUrl: null,
    })
  })

  it("maps Twilio's vocabulary onto the log's: initiated->queued, canceled->failed, inbound direction", () => {
    const twilio = adapter()
    expect(twilio.parseEvent('CallSid=CA_2&CallStatus=initiated')).toMatchObject({ status: 'queued' })
    expect(twilio.parseEvent('CallSid=CA_3&CallStatus=canceled')).toMatchObject({ status: 'failed' })
    expect(twilio.parseEvent('CallSid=CA_4&CallStatus=ringing&Direction=inbound')).toMatchObject({
      direction: 'inbound',
    })
  })

  it('ignores a body without a call sid or status', () => {
    const twilio = adapter()
    expect(twilio.parseEvent('Foo=bar')).toEqual({ type: 'ignored' })
    expect(twilio.parseEvent('CallSid=CA_5')).toEqual({ type: 'ignored' })
  })
})
