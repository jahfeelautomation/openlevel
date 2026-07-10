import { describe, expect, it, vi } from 'vitest'
import { createVapiAdapter } from './vapi-adapter'

const API_KEY = 'vapi-key-fake-not-real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 201 }))
}

function adapter(overrides: Partial<Parameters<typeof createVapiAdapter>[0]> = {}) {
  return createVapiAdapter({
    apiKey: API_KEY,
    assistantId: 'asst_42',
    phoneNumberId: 'pn_7',
    webhookSecret: 'vapi-hook-secret',
    ...overrides,
  })
}

describe('vapi adapter: placeCall', () => {
  it('POSTs the assistant + phone number + customer to /call with bearer auth', async () => {
    const fetchImpl = okFetch({ id: 'call_vapi_1' })
    const vapi = adapter({ fetchImpl })

    const placed = await vapi.placeCall({ to: '+16025550123' })

    expect(placed).toEqual({ externalId: 'call_vapi_1', provider: 'vapi' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.vapi.ai/call')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`)
    expect(JSON.parse(String(init.body))).toEqual({
      assistantId: 'asst_42',
      phoneNumberId: 'pn_7',
      customer: { number: '+16025550123' },
    })
  })

  it('throws with the status when Vapi rejects the call, never echoing the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }))
    const vapi = adapter({ fetchImpl })
    await expect(vapi.placeCall({ to: '+1' })).rejects.toThrow(/401/)
    await expect(vapi.placeCall({ to: '+1' })).rejects.not.toThrow(new RegExp(API_KEY))
  })

  it('throws when the response has no call id', async () => {
    const vapi = adapter({ fetchImpl: okFetch({}) })
    await expect(vapi.placeCall({ to: '+1' })).rejects.toThrow(/missing id/)
  })
})

describe('vapi adapter: verifyWebhook', () => {
  const input = (secret?: string) => ({
    rawBody: '{}',
    headers: secret === undefined ? {} : { 'x-vapi-secret': secret },
    url: 'https://app.example.com/api/public/voice/jamal/vapi',
  })

  it('accepts only a delivery that echoes the configured server secret', () => {
    const vapi = adapter()
    expect(vapi.verifyWebhook(input('vapi-hook-secret'))).toBe(true)
    expect(vapi.verifyWebhook(input('wrong'))).toBe(false)
    expect(vapi.verifyWebhook(input())).toBe(false)
  })

  it('fails closed when no webhook secret is configured at all', () => {
    const vapi = adapter({ webhookSecret: undefined })
    expect(vapi.verifyWebhook(input('anything'))).toBe(false)
  })
})

describe('vapi adapter: parseEvent', () => {
  it('maps a status-update onto a call update, translating ended->completed', () => {
    const vapi = adapter()
    const event = vapi.parseEvent(
      JSON.stringify({
        message: {
          type: 'status-update',
          status: 'in-progress',
          call: { id: 'call_vapi_1', type: 'outboundPhoneCall', customer: { number: '+16025550123' } },
        },
      }),
    )
    expect(event).toEqual({
      type: 'call_update',
      externalId: 'call_vapi_1',
      status: 'in-progress',
      direction: 'outbound',
      from: null,
      to: '+16025550123',
    })
    expect(
      vapi.parseEvent(
        JSON.stringify({ message: { type: 'status-update', status: 'ended', call: { id: 'call_vapi_1' } } }),
      ),
    ).toMatchObject({ status: 'completed' })
  })

  it('mirrors the end-of-call report: duration, transcript, summary, recording', () => {
    const vapi = adapter()
    const event = vapi.parseEvent(
      JSON.stringify({
        message: {
          type: 'end-of-call-report',
          endedReason: 'assistant-ended-call',
          durationSeconds: 142.6,
          artifact: { transcript: 'AI: Hi...\nCustomer: Hello.', recordingUrl: 'https://vapi.example/rec.wav' },
          analysis: { summary: 'Customer asked about pricing; booked a callback.' },
          call: { id: 'call_vapi_1', type: 'outboundPhoneCall', customer: { number: '+16025550123' } },
        },
      }),
    )
    expect(event).toEqual({
      type: 'call_update',
      externalId: 'call_vapi_1',
      status: 'completed',
      direction: 'outbound',
      from: null,
      to: '+16025550123',
      durationSeconds: 143,
      transcript: 'AI: Hi...\nCustomer: Hello.',
      summary: 'Customer asked about pricing; booked a callback.',
      recordingUrl: 'https://vapi.example/rec.wav',
    })
  })

  it('reports no-answer and busy honestly instead of calling them completed', () => {
    const vapi = adapter()
    const report = (endedReason: string) =>
      JSON.stringify({ message: { type: 'end-of-call-report', endedReason, call: { id: 'c1' } } })
    expect(vapi.parseEvent(report('customer-did-not-answer'))).toMatchObject({ status: 'no-answer' })
    expect(vapi.parseEvent(report('customer-busy'))).toMatchObject({ status: 'busy' })
  })

  it('puts the customer number on the FROM side for an inbound call', () => {
    const vapi = adapter()
    const event = vapi.parseEvent(
      JSON.stringify({
        message: {
          type: 'status-update',
          status: 'ringing',
          call: { id: 'c2', type: 'inboundPhoneCall', customer: { number: '+16025550123' } },
        },
      }),
    )
    expect(event).toMatchObject({ direction: 'inbound', from: '+16025550123', to: null })
  })

  it('ignores junk JSON, bodies without a call id, and message types it does not know', () => {
    const vapi = adapter()
    expect(vapi.parseEvent('not json')).toEqual({ type: 'ignored' })
    expect(vapi.parseEvent('{"message":{"type":"status-update","status":"ringing"}}')).toEqual({
      type: 'ignored',
    })
    expect(
      vapi.parseEvent(JSON.stringify({ message: { type: 'speech-update', call: { id: 'c3' } } })),
    ).toEqual({ type: 'ignored' })
  })
})
