import { describe, expect, it, vi } from 'vitest'
import { createBrevoAdapter } from './brevo-adapter'

const API_KEY = 'xkeysib-fake-not-real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 201 }))
}

const msg = {
  to: 'lead@example.com',
  toName: 'Lead Person',
  subject: 'June cash offer',
  text: 'Hi Lead, your offer is ready.',
}

describe('brevo adapter: sendEmail', () => {
  it('POSTs the transactional-email JSON with the location sender and returns the message id', async () => {
    const fetchImpl = okFetch({ messageId: '<202606100001.123@smtp-relay.mailin.fr>' })
    const brevo = createBrevoAdapter({
      apiKey: API_KEY,
      fromEmail: 'Alex@cashoffers.example.com',
      fromName: 'Alex — Cash Offers',
      fetchImpl,
    })

    const result = await brevo.sendEmail(msg)

    expect(result).toEqual({
      externalId: '<202606100001.123@smtp-relay.mailin.fr>',
      provider: 'brevo',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect((init.headers as Record<string, string>)['api-key']).toBe(API_KEY)
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { email: 'Alex@cashoffers.example.com', name: 'Alex — Cash Offers' },
      to: [{ email: 'lead@example.com', name: 'Lead Person' }],
      subject: 'June cash offer',
      textContent: 'Hi Lead, your offer is ready.',
    })
  })

  it('omits the optional names instead of sending undefined', async () => {
    const fetchImpl = okFetch({ messageId: '<m2>' })
    const brevo = createBrevoAdapter({ apiKey: API_KEY, fromEmail: 'ops@example.com', fetchImpl })

    await brevo.sendEmail({ to: 'lead@example.com', subject: 's', text: 't' })

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { email: 'ops@example.com' },
      to: [{ email: 'lead@example.com' }],
      subject: 's',
      textContent: 't',
    })
  })

  it('throws with the status when Brevo rejects the send, never echoing the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"code":"unauthorized"}', { status: 401 }))
    const brevo = createBrevoAdapter({ apiKey: API_KEY, fromEmail: 'ops@example.com', fetchImpl })
    await expect(brevo.sendEmail(msg)).rejects.toThrow(/401/)
    await expect(brevo.sendEmail(msg)).rejects.not.toThrow(new RegExp(API_KEY))
  })

  it('throws when the response has no message id', async () => {
    const brevo = createBrevoAdapter({ apiKey: API_KEY, fromEmail: 'ops@example.com', fetchImpl: okFetch({}) })
    await expect(brevo.sendEmail(msg)).rejects.toThrow(/missing messageId/)
  })
})

