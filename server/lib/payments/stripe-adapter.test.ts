import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createStripeAdapter } from './stripe-adapter'

const SECRET_KEY = 'sk_test_fake_not_real'
const WEBHOOK_SECRET = 'whsec_fake_not_real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
}

/** Build a real Stripe-Signature header for `body` at time `t`. */
function sign(body: string, t: number, secret = WEBHOOK_SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${v1}`
}

const checkoutReq = {
  invoiceId: 'inv_1',
  invoiceNumber: 'INV-1001',
  amountCents: 12_50,
  currency: 'usd',
  successUrl: 'https://ops.example.com/pay/success',
}

describe('stripe adapter: createCheckoutLink', () => {
  it('POSTs a form-encoded checkout session with the invoice metadata and returns the hosted url', async () => {
    const fetchImpl = okFetch({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' })
    const stripe = createStripeAdapter({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetchImpl })

    const link = await stripe.createCheckoutLink(checkoutReq)

    expect(link).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      externalId: 'cs_test_123',
      provider: 'stripe',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET_KEY}`)
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('mode')).toBe('payment')
    expect(body.get('success_url')).toBe(checkoutReq.successUrl)
    expect(body.get('metadata[invoice_id]')).toBe('inv_1')
    expect(body.get('line_items[0][price_data][currency]')).toBe('usd')
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1250')
    expect(body.get('line_items[0][price_data][product_data][name]')).toBe('Invoice INV-1001')
    expect(body.get('line_items[0][quantity]')).toBe('1')
  })

  it('throws with the status when Stripe rejects the request, never echoing the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{}}', { status: 402 }))
    const stripe = createStripeAdapter({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetchImpl })
    await expect(stripe.createCheckoutLink(checkoutReq)).rejects.toThrow(/402/)
    await expect(stripe.createCheckoutLink(checkoutReq)).rejects.not.toThrow(new RegExp(SECRET_KEY))
  })
})

describe('stripe adapter: verifyWebhook', () => {
  const now = () => 1_700_000_000_000 // ms
  const tNow = 1_700_000_000 // matching seconds

  function adapter() {
    return createStripeAdapter({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetchImpl: okFetch({}), now })
  }

  it('accepts a genuine signature', () => {
    const body = '{"type":"checkout.session.completed"}'
    const ok = adapter().verifyWebhook({
      rawBody: body,
      headers: { 'stripe-signature': sign(body, tNow) },
      url: 'https://ops.example.com/api/public/pay/webhook/stripe/loc_1',
    })
    expect(ok).toBe(true)
  })

  it('rejects a signature made with the wrong secret', () => {
    const body = '{"type":"checkout.session.completed"}'
    const ok = adapter().verifyWebhook({
      rawBody: body,
      headers: { 'stripe-signature': sign(body, tNow, 'whsec_wrong') },
      url: 'https://x',
    })
    expect(ok).toBe(false)
  })

  it('rejects a tampered body', () => {
    const ok = adapter().verifyWebhook({
      rawBody: '{"type":"checkout.session.completed","amount":99}',
      headers: { 'stripe-signature': sign('{"type":"checkout.session.completed"}', tNow) },
      url: 'https://x',
    })
    expect(ok).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(adapter().verifyWebhook({ rawBody: '{}', headers: {}, url: 'https://x' })).toBe(false)
  })

  it('rejects a replayed timestamp outside the 5-minute tolerance', () => {
    const body = '{}'
    const stale = tNow - 6 * 60
    const ok = adapter().verifyWebhook({
      rawBody: body,
      headers: { 'stripe-signature': sign(body, stale) },
      url: 'https://x',
    })
    expect(ok).toBe(false)
  })
})

describe('stripe adapter: parseEvent', () => {
  const stripe = createStripeAdapter({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetchImpl: okFetch({}) })

  it('maps checkout.session.completed to payment_completed with the round-tripped invoice id', () => {
    const event = stripe.parseEvent(
      JSON.stringify({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_123', amount_total: 1250, metadata: { invoice_id: 'inv_1' } } },
      }),
    )
    expect(event).toEqual({
      type: 'payment_completed',
      invoiceId: 'inv_1',
      externalId: 'cs_test_123',
      amountCents: 1250,
      method: 'stripe',
    })
  })

  it('ignores unrelated event types', () => {
    expect(stripe.parseEvent(JSON.stringify({ type: 'invoice.created', data: { object: {} } }))).toEqual({
      type: 'ignored',
    })
  })

  it('ignores malformed JSON instead of throwing', () => {
    expect(stripe.parseEvent('not json')).toEqual({ type: 'ignored' })
  })
})
