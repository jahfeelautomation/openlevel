import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { CallEvent, OutboundCallRequest, PlacedCall, VoiceProvider, WebhookInput } from './provider'

export interface TwilioVoiceAdapterConfig {
  /** The LOCATION's own Twilio credentials — resolved by name, never stored here. */
  accountSid: string
  authToken: string
  /** The location's provisioned voice number (E.164) — the caller id. */
  from: string
  /** The operator's own phone: when the customer answers, the call dials this
   *  number and bridges the two. Plain click-to-call, no hosted TwiML app. */
  operatorNumber: string
  /** Where Twilio posts call-status updates. Optional — without it the call
   *  still happens, the log just stays at 'queued'. */
  statusCallbackUrl?: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/** Same constant-time pattern as the Stripe/Square/Chatwoot guards. */
function digestsMatch(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

/** The operator number rides inside inline TwiML — XML-escape it so an odd
 *  settings value can never change the document's shape. */
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Twilio's call statuses, normalized to the log's vocabulary. */
function normalizeStatus(raw: string): string {
  if (raw === 'initiated') return 'queued'
  if (raw === 'canceled') return 'failed'
  return raw
}

/**
 * Twilio voice adapter: a simple bridge call. We ask Twilio to ring the
 * customer from the location's own number; when they pick up, inline TwiML
 * dials the operator's phone and connects the two. No AI, no hosted TwiML
 * endpoint — the whole behavior travels in the create-call request.
 *
 * Webhook side: Twilio signs status callbacks with HMAC-SHA1 over the exact
 * delivery URL + the sorted form params, keyed by the auth token we already
 * hold — so the call log only believes deliveries Twilio really made.
 */
export function createTwilioVoiceAdapter(config: TwilioVoiceAdapterConfig): VoiceProvider {
  const fetchImpl = config.fetchImpl ?? fetch
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`
  const auth = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`

  return {
    name: 'twilio',

    async placeCall(req: OutboundCallRequest): Promise<PlacedCall> {
      const form = new URLSearchParams({
        To: req.to,
        From: config.from,
        Twiml: `<Response><Dial>${escapeXml(config.operatorNumber)}</Dial></Response>`,
      })
      if (config.statusCallbackUrl) {
        form.set('StatusCallback', config.statusCallbackUrl)
        form.set('StatusCallbackMethod', 'POST')
        for (const ev of ['initiated', 'ringing', 'answered', 'completed']) {
          form.append('StatusCallbackEvent', ev)
        }
      }
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: auth,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })
      // The token must never ride along on the error (it would land in logs).
      if (!res.ok) throw new Error(`twilio call failed: ${res.status}`)
      const data = (await res.json()) as { sid?: string }
      if (!data.sid) throw new Error('twilio call response missing sid')
      return { externalId: data.sid, provider: 'twilio', from: config.from }
    },

    verifyWebhook({ rawBody, headers, url: deliveredUrl }: WebhookInput): boolean {
      const provided = headers['x-twilio-signature']
      if (!provided) return false
      // Twilio signs base64(HMAC-SHA1(url + sorted(key+value)...)) with the
      // auth token. Signing over the URL means a delivery replayed at a
      // different endpoint fails.
      const entries = [...new URLSearchParams(rawBody).entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )
      const signed = deliveredUrl + entries.map(([k, v]) => k + v).join('')
      const expected = createHmac('sha1', config.authToken).update(signed).digest('base64')
      return digestsMatch(provided, expected)
    },

    parseEvent(rawBody: string): CallEvent {
      const params = new URLSearchParams(rawBody)
      const sid = params.get('CallSid')
      const rawStatus = params.get('CallStatus')
      if (!sid || !rawStatus) return { type: 'ignored' }
      const durationRaw = params.get('CallDuration')
      return {
        type: 'call_update',
        externalId: sid,
        status: normalizeStatus(rawStatus),
        direction: (params.get('Direction') ?? '').startsWith('inbound') ? 'inbound' : 'outbound',
        from: params.get('From'),
        to: params.get('To'),
        durationSeconds: durationRaw !== null && /^\d+$/.test(durationRaw) ? Number(durationRaw) : null,
        recordingUrl: params.get('RecordingUrl'),
      }
    },
  }
}
