import type { EmailMessage, EmailSender, SendResult } from './provider'

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'

export interface BrevoAdapterConfig {
  /** The LOCATION's own Brevo API key — resolved by name, never stored here. */
  apiKey: string
  /** Sender identity, verified inside the location's Brevo account. */
  fromEmail: string
  fromName?: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Brevo transactional-email adapter. Mail goes out of the location's own
 * Brevo account under their verified sender — OpenLevel only relays, so
 * deliverability reputation and unsubscribe compliance stay with the client.
 */
export function createBrevoAdapter(config: BrevoAdapterConfig): EmailSender {
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    name: 'brevo',

    async sendEmail(msg: EmailMessage): Promise<SendResult> {
      const payload = {
        sender: config.fromName ? { email: config.fromEmail, name: config.fromName } : { email: config.fromEmail },
        to: [msg.toName ? { email: msg.to, name: msg.toName } : { email: msg.to }],
        subject: msg.subject,
        textContent: msg.text,
      }
      const res = await fetchImpl(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': config.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })
      // The key must never ride along on the error (it would land in job logs).
      if (!res.ok) throw new Error(`brevo send failed: ${res.status}`)
      const data = (await res.json()) as { messageId?: string }
      if (!data.messageId) throw new Error('brevo send response missing messageId')
      return { externalId: data.messageId, provider: 'brevo' }
    },
  }
}
