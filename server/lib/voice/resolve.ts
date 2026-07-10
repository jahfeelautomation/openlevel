import type { Database } from '../../db/database'
import { LocationsRepo } from '../../repos/locations-repo'
import { resolveSecret } from '../vault'
import type { VoiceProvider } from './provider'
import { createTwilioVoiceAdapter } from './twilio-voice-adapter'
import { createVapiAdapter } from './vapi-adapter'

/** What a location chose under settings.voice. */
export interface VoiceSettings {
  provider?: 'twilio' | 'vapi' | 'none'
  /** Twilio: the location's voice number (E.164) calls show up from. */
  fromNumber?: string
  /** Twilio: the operator's own phone the bridge call connects to. */
  operatorNumber?: string
  /** Vapi: which assistant talks (their id, configured in their dashboard). */
  vapiAssistantId?: string
  /** Vapi: which of their phone numbers the call goes out from (their id). */
  vapiPhoneNumberId?: string
}

export type ResolvedVoice = { ok: true; provider: VoiceProvider } | { ok: false; reason: string }

/**
 * Build the voice adapter for one location from its settings + secrets — the
 * voice mirror of resolvePaymentProvider. Provider choice and numbers live in
 * settings.voice (operator-editable); the credentials are the LOCATION's own
 * keys, resolved by NAME from the vault layer (D-36). Twilio voice REUSES the
 * same `<slug>:twilio:account_sid` + `<slug>:twilio:auth_token` the SMS
 * channel already configured — one Twilio account, both channels. Missing
 * config reports a reason instead of throwing so routes can answer with
 * honest copy.
 */
export async function resolveVoiceProvider(
  db: Database,
  locationId: string,
  opts: { statusCallbackUrl?: string } = {},
): Promise<ResolvedVoice> {
  const location = await new LocationsRepo(db).getById(locationId)
  if (!location) return { ok: false, reason: 'location not found' }

  const voice = (location.settings?.voice ?? {}) as VoiceSettings
  const slug = location.client_slug ?? location.slug

  if (voice.provider === 'twilio') {
    const accountSid = resolveSecret(`${slug}:twilio:account_sid`)
    const authToken = resolveSecret(`${slug}:twilio:auth_token`)
    if (!accountSid || !authToken) return { ok: false, reason: 'twilio keys are not configured' }
    if (!voice.fromNumber) return { ok: false, reason: 'voice from number is not configured' }
    if (!voice.operatorNumber) return { ok: false, reason: 'operator phone number is not configured' }
    return {
      ok: true,
      provider: createTwilioVoiceAdapter({
        accountSid,
        authToken,
        from: voice.fromNumber,
        operatorNumber: voice.operatorNumber,
        statusCallbackUrl: opts.statusCallbackUrl,
      }),
    }
  }

  if (voice.provider === 'vapi') {
    const apiKey = resolveSecret(`${slug}:vapi:api_key`)
    if (!apiKey) return { ok: false, reason: 'vapi key is not configured' }
    if (!voice.vapiAssistantId) return { ok: false, reason: 'vapi assistant id is not configured' }
    if (!voice.vapiPhoneNumberId) return { ok: false, reason: 'vapi phone number id is not configured' }
    return {
      ok: true,
      provider: createVapiAdapter({
        apiKey,
        assistantId: voice.vapiAssistantId,
        phoneNumberId: voice.vapiPhoneNumberId,
        // Optional on purpose: placing calls works without it; receiving
        // webhooks does not (the adapter fails closed).
        webhookSecret: resolveSecret(`${slug}:vapi:webhook_secret`),
      }),
    }
  }

  return { ok: false, reason: 'no voice provider connected' }
}
