/**
 * Voice-provider abstraction (Module 52). Exactly like payments and sending,
 * each location connects its OWN account — Twilio for plain bridge calls, Vapi
 * for the AI voice agent — and every call happens inside that account: their
 * number, their per-minute rates, their recordings. OpenLevel only
 * orchestrates: it asks the provider to place a call and listens for the
 * provider's webhooks to keep the call log honest. The AI agent has no tool
 * that reaches any of this.
 *
 * Credentials follow D-36: the resolver reads the location's keys by NAME
 * (`<slug>:twilio:account_sid`, `<slug>:vapi:api_key`) via the vault layer and
 * hands the values only to the adapter for the outbound request.
 */

export interface OutboundCallRequest {
  /** The customer's number, E.164. */
  to: string
}

export interface PlacedCall {
  /** Provider-side call id (Twilio CallSid / Vapi call id) — what the webhook
   *  later correlates against. */
  externalId: string
  provider: string
  /** The number the call shows up from, when the adapter knows it. */
  from?: string
}

/** What a provider webhook told us about a call. Anything we don't act on is
 *  `ignored`. Optional fields are patches — absent means "no news", and the
 *  repo keeps what it already recorded. */
export type CallEvent =
  | {
      type: 'call_update'
      externalId: string
      status: string
      direction: 'inbound' | 'outbound'
      from?: string | null
      to?: string | null
      durationSeconds?: number | null
      recordingUrl?: string | null
      transcript?: string | null
      summary?: string | null
    }
  | { type: 'ignored' }

/** Everything an adapter may need to authenticate a webhook delivery. */
export interface WebhookInput {
  rawBody: string
  headers: Record<string, string | undefined>
  /** Full public URL the webhook was delivered to (Twilio signs over it). */
  url: string
}

export interface VoiceProvider {
  readonly name: string
  placeCall(req: OutboundCallRequest): Promise<PlacedCall>
  /** MUST be timing-safe. False = drop the delivery with a 401. */
  verifyWebhook(input: WebhookInput): boolean
  /** Only called after verifyWebhook passed. */
  parseEvent(rawBody: string): CallEvent
}
