import type { SendResult, SmsMessage, SmsSender } from './provider'

export interface TwilioAdapterConfig {
  /** The LOCATION's own Twilio credentials — resolved by name, never stored here. */
  accountSid: string
  authToken: string
  /** The location's provisioned sending number (E.164). */
  from: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Twilio SMS adapter. Texts go out of the location's own Twilio account and
 * number — A2P registration, carrier fees, and opt-out handling are theirs.
 */
export function createTwilioAdapter(config: TwilioAdapterConfig): SmsSender {
  const fetchImpl = config.fetchImpl ?? fetch
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`
  const auth = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`

  return {
    name: 'twilio',

    async sendSms(msg: SmsMessage): Promise<SendResult> {
      const form = new URLSearchParams({ To: msg.to, From: config.from, Body: msg.body })
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: auth,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })
      // The token must never ride along on the error (it would land in job logs).
      if (!res.ok) throw new Error(`twilio send failed: ${res.status}`)
      const data = (await res.json()) as { sid?: string }
      if (!data.sid) throw new Error('twilio send response missing sid')
      return { externalId: data.sid, provider: 'twilio' }
    },
  }
}
