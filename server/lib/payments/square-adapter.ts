import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { CheckoutLink, CheckoutRequest, PaymentEvent, PaymentProvider, WebhookInput } from './provider'

const SQUARE_PAYMENT_LINKS_URL = 'https://connect.squareup.com/v2/online-checkout/payment-links'

export interface SquareAdapterConfig {
  /** The LOCATION's own Square access token — resolved by name, never stored here. */
  accessToken: string
  /** Square's webhook signature key for the subscription pointing at us. */
  webhookSignatureKey: string
  /** The Square location (their concept) to take the payment under. */
  squareLocationId: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/** Same constant-time pattern as the Stripe + Chatwoot guards. */
function digestsMatch(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

/**
 * Square adapter. We mint a quick-pay Payment Link inside the location's own
 * Square account; the customer pays on Square's hosted page. Square has no
 * metadata round-trip on the link, so correlation runs through the link's
 * ORDER id: we return it as externalId, the route stores it on the invoice,
 * and `payment.updated` (status COMPLETED) carries the same order_id back.
 */
export function createSquareAdapter(config: SquareAdapterConfig): PaymentProvider {
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    name: 'square',

    async createCheckoutLink(req: CheckoutRequest): Promise<CheckoutLink> {
      const res = await fetchImpl(SQUARE_PAYMENT_LINKS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          // A retried request (job re-run, double click) must not mint two links.
          idempotency_key: `ol-${req.invoiceId}-${nanoid(8)}`,
          quick_pay: {
            name: `Invoice ${req.invoiceNumber}`,
            price_money: { amount: req.amountCents, currency: req.currency.toUpperCase() },
            location_id: config.squareLocationId,
          },
          checkout_options: { redirect_url: req.successUrl },
        }),
      })
      // The token must never ride along on the error (it would land in job logs).
      if (!res.ok) throw new Error(`square payment link failed: ${res.status}`)
      const data = (await res.json()) as { payment_link?: { url?: string; order_id?: string } }
      const link = data.payment_link
      if (!link?.url || !link.order_id) throw new Error('square payment link response missing url/order_id')
      return { url: link.url, externalId: link.order_id, provider: 'square' }
    },

    verifyWebhook({ rawBody, headers, url }: WebhookInput): boolean {
      const provided = headers['x-square-hmacsha256-signature']
      if (!provided) return false
      // Square signs base64(HMAC-SHA256(notification_url + raw_body)). Signing
      // over the URL means a delivery replayed at a different endpoint fails.
      const expected = createHmac('sha256', config.webhookSignatureKey).update(url + rawBody).digest('base64')
      return digestsMatch(provided, expected)
    },

    parseEvent(rawBody: string): PaymentEvent {
      let payload: unknown
      try {
        payload = JSON.parse(rawBody)
      } catch {
        return { type: 'ignored' }
      }
      const event = payload as {
        type?: string
        data?: { object?: { payment?: { status?: string; order_id?: string; amount_money?: { amount?: number } } } }
      }
      if (event.type !== 'payment.updated') return { type: 'ignored' }
      const payment = event.data?.object?.payment
      if (!payment || payment.status !== 'COMPLETED' || !payment.order_id) return { type: 'ignored' }
      return {
        type: 'payment_completed',
        externalId: payment.order_id,
        amountCents: typeof payment.amount_money?.amount === 'number' ? payment.amount_money.amount : null,
        method: 'square',
      }
    },
  }
}
