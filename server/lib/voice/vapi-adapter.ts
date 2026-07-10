import { createHash, timingSafeEqual } from 'node:crypto'
import type { CallEvent, OutboundCallRequest, PlacedCall, VoiceProvider, WebhookInput } from './provider'

const VAPI_CALLS_URL = 'https://api.vapi.ai/call'

export interface VapiAdapterConfig {
  /** The LOCATION's own Vapi key — resolved by name, never stored here. */
  apiKey: string
  /** The Vapi assistant that talks — its voice, prompt, and behavior live in
   *  the location's own Vapi account, not here. */
  assistantId: string
  /** The Vapi phone number (their id, not E.164) the call goes out from. */
  phoneNumberId: string
  /** The shared secret Vapi sends back as x-vapi-secret on every webhook.
   *  Without it deliveries are refused — fail closed, never open. */
  webhookSecret?: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/** Same constant-time pattern as the Stripe/Square/Chatwoot guards. */
function digestsMatch(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

/** End-of-call reasons that mean the customer never connected. */
function statusFromEndedReason(reason: string | undefined): string {
  if (reason === 'customer-did-not-answer') return 'no-answer'
  if (reason === 'customer-busy') return 'busy'
  return 'completed'
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/**
 * Vapi adapter — the Voice-AI half of Module 52. Vapi runs the entire
 * conversation (speech, reasoning, barge-in) inside the location's own Vapi
 * account; OpenLevel only starts outbound calls and mirrors what Vapi reports
 * back — status updates while the call runs, then the end-of-call report with
 * the real transcript, summary, and recording. Nothing in the log is invented
 * here: every field is exactly what Vapi said happened.
 */
export function createVapiAdapter(config: VapiAdapterConfig): VoiceProvider {
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    name: 'vapi',

    async placeCall(req: OutboundCallRequest): Promise<PlacedCall> {
      const res = await fetchImpl(VAPI_CALLS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          assistantId: config.assistantId,
          phoneNumberId: config.phoneNumberId,
          customer: { number: req.to },
        }),
      })
      // The key must never ride along on the error (it would land in logs).
      if (!res.ok) throw new Error(`vapi call failed: ${res.status}`)
      const data = (await res.json()) as { id?: string }
      if (!data.id) throw new Error('vapi call response missing id')
      return { externalId: data.id, provider: 'vapi' }
    },

    verifyWebhook({ headers }: WebhookInput): boolean {
      // Vapi authenticates by echoing the server secret configured on the
      // assistant. No secret in the vault = no believable deliveries.
      const provided = headers['x-vapi-secret']
      if (!provided || !config.webhookSecret) return false
      return digestsMatch(provided, config.webhookSecret)
    },

    parseEvent(rawBody: string): CallEvent {
      let payload: unknown
      try {
        payload = JSON.parse(rawBody)
      } catch {
        return { type: 'ignored' }
      }
      const message = (payload as { message?: unknown }).message as
        | {
            type?: string
            status?: string
            endedReason?: string
            transcript?: unknown
            summary?: unknown
            recordingUrl?: unknown
            durationSeconds?: unknown
            durationMs?: unknown
            artifact?: { transcript?: unknown; recordingUrl?: unknown }
            analysis?: { summary?: unknown }
            call?: { id?: unknown; type?: unknown; customer?: { number?: unknown } }
          }
        | undefined
      const externalId = str(message?.call?.id)
      if (!message || !externalId) return { type: 'ignored' }

      const direction = message.call?.type === 'inboundPhoneCall' ? 'inbound' : 'outbound'
      const customerNumber = str(message.call?.customer?.number)
      // The customer's number is the far end: where an inbound call came FROM,
      // where an outbound call went TO.
      const ends =
        direction === 'inbound' ? { from: customerNumber, to: null } : { from: null, to: customerNumber }

      if (message.type === 'status-update' && typeof message.status === 'string' && message.status) {
        return {
          type: 'call_update',
          externalId,
          status: message.status === 'ended' ? 'completed' : message.status,
          direction,
          ...ends,
        }
      }

      if (message.type === 'end-of-call-report') {
        const durationSeconds =
          typeof message.durationSeconds === 'number'
            ? Math.round(message.durationSeconds)
            : typeof message.durationMs === 'number'
              ? Math.round(message.durationMs / 1000)
              : null
        return {
          type: 'call_update',
          externalId,
          status: statusFromEndedReason(message.endedReason),
          direction,
          ...ends,
          durationSeconds,
          transcript: str(message.transcript) ?? str(message.artifact?.transcript),
          summary: str(message.summary) ?? str(message.analysis?.summary),
          recordingUrl: str(message.recordingUrl) ?? str(message.artifact?.recordingUrl),
        }
      }

      return { type: 'ignored' }
    },
  }
}
