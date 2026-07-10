/**
 * Payment-processor abstraction. OpenLevel NEVER moves money itself — exactly
 * like GHL, each location connects its OWN processor account (Stripe, Square)
 * and every charge happens inside that account. This layer only orchestrates:
 * it asks the processor for a hosted checkout link and listens for the
 * processor's webhook to mark the invoice paid. There is deliberately no
 * charge/refund call surface, and the AI agent has no tool that reaches any of
 * this.
 *
 * Credentials follow D-36: the route resolves the location's key by NAME
 * (`<slug>:stripe:secret_key`) via the vault layer and hands the value only to
 * the adapter for the one outbound request.
 */

export interface CheckoutRequest {
  /** Round-tripped through processor metadata so the webhook can find the invoice. */
  invoiceId: string
  /** Human label the customer sees on the processor's checkout page. */
  invoiceNumber: string
  amountCents: number
  /** ISO currency code, lowercase (e.g. 'usd'). */
  currency: string
  /** Where the processor sends the customer after paying. */
  successUrl: string
}

export interface CheckoutLink {
  url: string
  /**
   * The processor-side id we correlate the webhook against: Stripe's checkout
   * session id, Square's order id. Stored on the invoice when the link is made.
   */
  externalId: string
  provider: string
}

/** What a processor webhook told us. Anything we don't act on is `ignored`. */
export type PaymentEvent =
  | {
      type: 'payment_completed'
      /** Present when the processor round-trips our metadata (Stripe). */
      invoiceId?: string
      /** Processor-side correlation id (Stripe session id / Square order id). */
      externalId: string
      amountCents: number | null
      method: string
    }
  | { type: 'ignored' }

/** Everything an adapter may need to authenticate a webhook delivery. */
export interface WebhookInput {
  rawBody: string
  headers: Record<string, string | undefined>
  /** Full public URL the webhook was delivered to (Square signs over it). */
  url: string
}

export interface PaymentProvider {
  readonly name: string
  createCheckoutLink(req: CheckoutRequest): Promise<CheckoutLink>
  /** MUST be timing-safe. False = drop the delivery with a 401. */
  verifyWebhook(input: WebhookInput): boolean
  /** Only called after verifyWebhook passed. */
  parseEvent(rawBody: string): PaymentEvent
}
