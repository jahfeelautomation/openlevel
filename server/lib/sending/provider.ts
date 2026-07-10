/**
 * Outbound send provider contracts (Module 49). Same shape discipline as
 * lib/payments/provider.ts: tiny interfaces, adapters own the HTTP, the
 * resolver owns settings + secret names. OpenLevel relays through the
 * LOCATION's own Brevo/Twilio account — we are never the sender of record.
 */

/** One personalized email, ready to hand to the provider. */
export interface EmailMessage {
  to: string
  toName?: string
  subject: string
  text: string
}

/** One personalized SMS. The from-number is adapter config, not per-message. */
export interface SmsMessage {
  to: string
  body: string
}

export interface SendResult {
  /** Provider-side message id, for delivery audits. */
  externalId: string
  provider: string
}

export interface EmailSender {
  name: string
  sendEmail(msg: EmailMessage): Promise<SendResult>
}

export interface SmsSender {
  name: string
  sendSms(msg: SmsMessage): Promise<SendResult>
}
