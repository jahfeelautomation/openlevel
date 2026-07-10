import type { Database } from '../../db/database'
import { LocationsRepo } from '../../repos/locations-repo'
import { resolveSecret } from '../vault'
import { createBrevoAdapter } from './brevo-adapter'
import type { EmailSender, SmsSender } from './provider'
import { createTwilioAdapter } from './twilio-adapter'

/** What a location chose under settings.sending. */
export interface SendingSettings {
  emailProvider?: 'brevo' | 'none'
  /** Sender identity, verified in the location's own email account. */
  fromEmail?: string
  fromName?: string
  smsProvider?: 'twilio' | 'none'
  /** The location's provisioned sending number (E.164). */
  smsFrom?: string
}

export type ResolvedEmailSender = { ok: true; sender: EmailSender } | { ok: false; reason: string }
export type ResolvedSmsSender = { ok: true; sender: SmsSender } | { ok: false; reason: string }

/**
 * Build the email sender for one location from its settings + secrets — the
 * sending mirror of resolvePaymentProvider. Provider choice and sender
 * identity live in settings.sending (operator-editable); the credential is
 * the LOCATION's own key, resolved by NAME from the vault layer (D-36) —
 * `<slug>:brevo:api_key`. Missing config reports a reason instead of
 * throwing so routes and jobs can answer with honest copy.
 */
export async function resolveEmailSender(db: Database, locationId: string): Promise<ResolvedEmailSender> {
  const location = await new LocationsRepo(db).getById(locationId)
  if (!location) return { ok: false, reason: 'location not found' }

  const sending = (location.settings?.sending ?? {}) as SendingSettings
  const slug = location.client_slug ?? location.slug

  if (sending.emailProvider === 'brevo') {
    const apiKey = resolveSecret(`${slug}:brevo:api_key`)
    if (!apiKey) return { ok: false, reason: 'brevo key is not configured' }
    if (!sending.fromEmail) return { ok: false, reason: 'sender email is not configured' }
    return {
      ok: true,
      sender: createBrevoAdapter({ apiKey, fromEmail: sending.fromEmail, fromName: sending.fromName }),
    }
  }

  return { ok: false, reason: 'no email provider connected' }
}

/** SMS counterpart: `<slug>:twilio:account_sid` + `<slug>:twilio:auth_token`. */
export async function resolveSmsSender(db: Database, locationId: string): Promise<ResolvedSmsSender> {
  const location = await new LocationsRepo(db).getById(locationId)
  if (!location) return { ok: false, reason: 'location not found' }

  const sending = (location.settings?.sending ?? {}) as SendingSettings
  const slug = location.client_slug ?? location.slug

  if (sending.smsProvider === 'twilio') {
    const accountSid = resolveSecret(`${slug}:twilio:account_sid`)
    const authToken = resolveSecret(`${slug}:twilio:auth_token`)
    if (!accountSid || !authToken) return { ok: false, reason: 'twilio keys are not configured' }
    if (!sending.smsFrom) return { ok: false, reason: 'sms from number is not configured' }
    return { ok: true, sender: createTwilioAdapter({ accountSid, authToken, from: sending.smsFrom }) }
  }

  return { ok: false, reason: 'no sms provider connected' }
}
