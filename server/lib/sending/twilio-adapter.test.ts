import { describe, expect, it, vi } from 'vitest'
import { createTwilioAdapter } from './twilio-adapter'

const ACCOUNT_SID = 'ACfake0000000000000000000000000000'
const AUTH_TOKEN = 'twilio-auth-fake-not-real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 201 }))
}

const msg = { to: '+16025550123', body: 'Your offer is ready. Reply STOP to opt out.' }

describe('twilio adapter: sendSms', () => {
  it('POSTs a form-encoded message to the account Messages endpoint with basic auth', async () => {
    const fetchImpl = okFetch({ sid: 'SM_fake_123' })
    const twilio = createTwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      from: '+14805550111',
      fetchImpl,
    })

    const result = await twilio.sendSms(msg)

    expect(result).toEqual({ externalId: 'SM_fake_123', provider: 'twilio' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`)
    const expectedAuth = `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`
    expect((init.headers as Record<string, string>).authorization).toBe(expectedAuth)
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('To')).toBe('+16025550123')
    expect(body.get('From')).toBe('+14805550111')
    expect(body.get('Body')).toBe('Your offer is ready. Reply STOP to opt out.')
  })

  it('throws with the status when Twilio rejects the send, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"code":20003}', { status: 401 }))
    const twilio = createTwilioAdapter({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, from: '+1', fetchImpl })
    await expect(twilio.sendSms(msg)).rejects.toThrow(/401/)
    await expect(twilio.sendSms(msg)).rejects.not.toThrow(new RegExp(AUTH_TOKEN))
  })

  it('throws when the response has no message sid', async () => {
    const twilio = createTwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      from: '+1',
      fetchImpl: okFetch({}),
    })
    await expect(twilio.sendSms(msg)).rejects.toThrow(/missing sid/)
  })
})
