import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { CheckoutLink, CheckoutRequest, PaymentEvent, PaymentProvider, WebhookInput } from './provider'

const STRIPE_CHECKOUT_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions'
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

export interface StripeAdapterConfig {
  /** The LOCATION's own Stripe secret key — resolved by name, never stored here. */
  secretKey: string
  /** The signing secret of the location's webhook endpoint (whsec_...). */
  webhookSecret: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
  /** Injectable clock (ms) for the replay-tolerance check. */
  now?: () => number
}

/** Hash both sides to a fixed-length digest, then compare in constant time —
 *  same rationale as the Chatwoot webhook guard (see webhooks-chatwoot.ts). */
function digestsMatch(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

/**
 * Stripe adapter. Checkout happens on Stripe's own hosted page inside the
 * location's Stripe account; we only mint the session (with the invoice id in
 * metadata) and verify the completed-checkout webhook. Money never touches
 * OpenLevel.
 */
export function createStripeAdapter(config: StripeAdapterConfig): PaymentProvider {
  const fetchImpl = config.fetchImpl ?? fetch
  const now = config.now ?? Date.now

  return {
    name: 'stripe',

    async createCheckoutLink(req: CheckoutRequest): Promise<CheckoutLink> {
      const form = new URLSearchParams({
        mode: 'payment',
        success_url: req.successUrl,
        'metadata[invoice_id]': req.invoiceId,
        'line_items[0][price_data][currency]': req.currency,
        'line_items[0][price_data][unit_amount]': String(req.amountCents),
        'line_items[0][price_data][product_data][name]': `Invoice ${req.invoiceNumber}`,
        'line_items[0][quantity]': '1',
      })
      const res = await fetchImpl(STRIPE_CHECKOUT_SESSIONS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })
      // The key must never ride along on the error (it would land in job logs).
      if (!res.ok) throw new Error(`stripe checkout session failed: ${res.status}`)
      const data = (await res.json()) as { id?: string; url?: string }
      if (!data.id || !data.url) throw new Error('stripe checkout session response missing id/url')
      return { url: data.url, externalId: data.id, provider: 'stripe' }
    },

    verifyWebhook({ rawBody, headers }: WebhookInput): boolean {
      const header = headers['stripe-signature']
      if (!header) return false
      // Header shape: t=<unix seconds>,v1=<hex hmac>[,v1=...]. Stripe may send
      // several v1 entries during a secret roll — accept if ANY matches.
      const parts = header.split(',').map((p) => p.split('=', 2) as [string, string])
      const t = parts.find(([k]) => k === 't')?.[1]
      const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
      if (!t || signatures.length === 0) return false

      const timestamp = Number(t)
      if (!Number.isFinite(timestamp)) return false
      if (Math.abs(now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false

      const expected = createHmac('sha256', config.webhookSecret).update(`${t}.${rawBody}`).digest('hex')
      return signatures.some((sig) => digestsMatch(sig, expected))
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
        data?: { object?: { id?: string; amount_total?: number; metadata?: { invoice_id?: string } } }
      }
      if (event.type !== 'checkout.session.completed') return { type: 'ignored' }
      const session = event.data?.object
      if (!session?.id) return { type: 'ignored' }
      return {
        type: 'payment_completed',
        invoiceId: session.metadata?.invoice_id,
        externalId: session.id,
        amountCents: typeof session.amount_total === 'number' ? session.amount_total : null,
        method: 'stripe',
      }
    },
  }
}
