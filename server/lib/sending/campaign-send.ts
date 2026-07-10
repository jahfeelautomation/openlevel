import type { Database } from '../../db/database'
import { renderTemplate } from '../merge-fields'
import type { Campaign } from '../../repos/campaigns-repo'
import type { Contact } from '../../repos/contacts-repo'
import type { EmailSender, SmsSender } from './provider'
import { resolveEmailSender, resolveSmsSender } from './resolve'

export type RecipientStatus = 'sent' | 'skipped' | 'failed'

export interface RecipientOutcome {
  contactId: string
  status: RecipientStatus
  /** Why a contact was skipped or failed; null for a delivered send. Adapter
   *  errors never carry the credential, so this is safe to persist and show. */
  detail: string | null
}

export type CampaignSendResult =
  | { ok: true; outcomes: RecipientOutcome[]; sentCount: number }
  | { ok: false; reason: string }

export interface CampaignSendDeps {
  db: Database
  /** Injectable for tests — default to the settings+vault resolvers. */
  resolveEmail?: typeof resolveEmailSender
  resolveSms?: typeof resolveSmsSender
  /** Pause between consecutive provider calls — a floor under Brevo/Twilio
   *  rate limits (long-code SMS is ~1 msg/sec; we stay well inside it). */
  throttleMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface CampaignSendInput {
  locationId: string
  campaign: Campaign
  /** The already-resolved audience (the route owns segmenting + the cap). */
  contacts: Contact[]
  /** Location merge tags for {{custom_values.<key>}} in body/subject. */
  customValues?: Record<string, string>
}

/** Contacts carrying any of these tags are never blasted — the operator-visible
 *  opt-out convention. Matched case-insensitively against contact tags. */
export const SUPPRESSION_TAGS = ['unsubscribed', 'dnd'] as const

const DEFAULT_THROTTLE_MS = 100

/**
 * Fan a campaign out to its audience through the location's OWN provider
 * (Module 49). The send is refused outright — not faked — when no provider is
 * connected, so a campaign is only ever marked sent when messages actually
 * left. Per-contact failures are isolated: one bad address or provider 500
 * records a `failed` outcome and the loop keeps going. Sends run sequentially
 * with a throttle pause so a 5000-contact blast cannot trip provider limits.
 */
export async function sendCampaign(deps: CampaignSendDeps, input: CampaignSendInput): Promise<CampaignSendResult> {
  const throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE_MS
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const customValues = input.customValues ?? {}
  const isEmail = input.campaign.channel === 'email'

  let email: EmailSender | null = null
  let sms: SmsSender | null = null
  if (isEmail) {
    const resolved = await (deps.resolveEmail ?? resolveEmailSender)(deps.db, input.locationId)
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    email = resolved.sender
  } else {
    const resolved = await (deps.resolveSms ?? resolveSmsSender)(deps.db, input.locationId)
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    sms = resolved.sender
  }

  const outcomes: RecipientOutcome[] = []
  let sentCount = 0
  let providerCalls = 0

  for (const contact of input.contacts) {
    const suppressed = contact.tags.find((t) =>
      (SUPPRESSION_TAGS as readonly string[]).includes(t.toLowerCase()),
    )
    if (suppressed) {
      outcomes.push({ contactId: contact.id, status: 'skipped', detail: suppressed.toLowerCase() })
      continue
    }

    const to = isEmail ? contact.emails[0] : contact.phones[0]
    if (!to) {
      outcomes.push({
        contactId: contact.id,
        status: 'skipped',
        detail: isEmail ? 'no email address' : 'no phone number',
      })
      continue
    }

    if (providerCalls > 0 && throttleMs > 0) await sleep(throttleMs)
    providerCalls++

    const body = renderTemplate(input.campaign.body, contact, customValues)
    try {
      if (email) {
        const subject = renderTemplate(input.campaign.subject ?? input.campaign.name, contact, customValues)
        await email.sendEmail({ to, toName: contact.name ?? undefined, subject, text: body })
      } else if (sms) {
        await sms.sendSms({ to, body })
      }
      outcomes.push({ contactId: contact.id, status: 'sent', detail: null })
      sentCount++
    } catch (err) {
      outcomes.push({
        contactId: contact.id,
        status: 'failed',
        detail: err instanceof Error ? err.message : 'send failed',
      })
    }
  }

  return { ok: true, outcomes, sentCount }
}
