import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createSquareAdapter } from './square-adapter'

const ACCESS_TOKEN = 'sq_fake_access_token_not_real'
const SIGNATURE_KEY = 'sq_fake_signature_key_not_real'
const SQUARE_LOCATION = 'SQ_LOC_1'
const WEBHOOK_URL = 'https://ops.example.com/api/public/pay/webhook/square/loc_1'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
}

/** Square signs base64(HMAC-SHA256(notificationUrl + rawBody)) with the signature key. */
function sign(body: string, url = WEBHOOK_URL, key = SIGNATURE_KEY): string {
  return createHmac('sha256', key).update(url + body).digest('base64')
}

function adapter(fetchImpl = okFetch({})) {
  return createSquareAdapter({
    accessToken: ACCESS_TOKEN,
    webhookSignatureKey: SIGNATURE_KEY,
    squareLocationId: SQUARE_LOCATION,
    fetchImpl,
  })
}

const checkoutReq = {
  invoiceId: 'inv_1',
  invoiceNumber: 'INV-1001',
  amountCents: 12_50,
  currency: 'usd',
  successUrl: 'https://ops.example.com/pay/success',
}

describe('square adapter: createCheckoutLink', () => {
  it('POSTs a quick-pay payment link and returns the url with the ORDER id for webhook correlation', async () => {
    const fetchImpl = okFetch({
      payment_link: {
        id: 'plink_1',
        url: 'https://square.link/u/abc123',
        order_id: 'order_xyz',
      },
    })
    const link = await adapter(fetchImpl).createCheckoutLink(checkoutReq)

    expect(link).toEqual({ url: 'https://square.link/u/abc123', externalId: 'order_xyz', provider: 'square' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://connect.squareup.com/v2/online-checkout/payment-links')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    const body = JSON.parse(String(init.body)) as Record<string, any>
    expect(body.quick_pay).toEqual({
      name: 'Invoice INV-1001',
      price_money: { amount: 1250, currency: 'USD' },
      location_id: SQUARE_LOCATION,
    })
    expect(body.checkout_options?.redirect_url).toBe(checkoutReq.successUrl)
    // idempotency_key must exist so a retried request can't mint two links
    expect(typeof body.idempotency_key).toBe('string')
    expect((body.idempotency_key as string).length).toBeGreaterThan(0)
  })

  it('throws with the status when Square rejects, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"errors":[]}', { status: 401 }))
    await expect(adapter(fetchImpl).createCheckoutLink(checkoutReq)).rejects.toThrow(/401/)
    await expect(adapter(fetchImpl).createCheckoutLink(checkoutReq)).rejects.not.toThrow(new RegExp(ACCESS_TOKEN))
  })
})

describe('square adapter: verifyWebhook', () => {
  it('accepts a genuine signature over url + body', () => {
    const body = '{"type":"payment.updated"}'
    const ok = adapter().verifyWebhook({
      rawBody: body,
      headers: { 'x-square-hmacsha256-signature': sign(body) },
      url: WEBHOOK_URL,
    })
    expect(ok).toBe(true)
  })

  it('rejects the wrong key, a tampered body, a different url, and a missing header', () => {
    const body = '{"type":"payment.updated"}'
    const a = adapter()
    expect(
      a.verifyWebhook({ rawBody: body, headers: { 'x-square-hmacsha256-signature': sign(body, WEBHOOK_URL, 'bad') }, url: WEBHOOK_URL }),
    ).toBe(false)
    expect(
      a.verifyWebhook({ rawBody: '{"hacked":1}', headers: { 'x-square-hmacsha256-signature': sign(body) }, url: WEBHOOK_URL }),
    ).toBe(false)
    expect(
      a.verifyWebhook({ rawBody: body, headers: { 'x-square-hmacsha256-signature': sign(body) }, url: 'https://evil.example.com' }),
    ).toBe(false)
    expect(a.verifyWebhook({ rawBody: body, headers: {}, url: WEBHOOK_URL })).toBe(false)
  })
})

describe('square adapter: parseEvent', () => {
  it('maps a COMPLETED payment.updated to payment_completed keyed by order id', () => {
    const event = adapter().parseEvent(
      JSON.stringify({
        type: 'payment.updated',
        data: {
          object: {
            payment: { id: 'pay_1', status: 'COMPLETED', order_id: 'order_xyz', amount_money: { amount: 1250 } },
          },
        },
      }),
    )
    expect(event).toEqual({
      type: 'payment_completed',
      externalId: 'order_xyz',
      amountCents: 1250,
      method: 'square',
    })
  })

  it('ignores non-completed payments and unrelated events and junk', () => {
    const a = adapter()
    expect(
      a.parseEvent(
        JSON.stringify({ type: 'payment.updated', data: { object: { payment: { status: 'PENDING', order_id: 'o' } } } }),
      ),
    ).toEqual({ type: 'ignored' })
    expect(a.parseEvent(JSON.stringify({ type: 'order.created' }))).toEqual({ type: 'ignored' })
    expect(a.parseEvent('not json')).toEqual({ type: 'ignored' })
  })
})
