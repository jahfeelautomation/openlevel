import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { resolvePaymentProvider } from '../lib/payments/resolve'
import { resolveReviewSource } from '../lib/reviews/resolve'
import { resolveEmailSender, resolveSmsSender } from '../lib/sending/resolve'
import { resolveSocialPublisher } from '../lib/social/resolve'
import { resolveVoiceProvider } from '../lib/voice/resolve'
import { LocationSettingsRepo } from '../repos/location-settings-repo'

/**
 * The AI Agent settings patch. Every field optional — a PATCH touches only what
 * it sends. The string fields allow empty (clearing persona/instructions reverts
 * the agent to its sane defaults). Facts are trimmed and empties dropped so a
 * trailing blank row from the editor is ignored rather than rejected. The caps
 * are payload-abuse guards on a stored settings blob, not limits on a meaningful
 * business quantity.
 */
const agentPatchSchema = z.object({
  replyMode: z.enum(['approve-first', 'autonomous']).optional(),
  enabled: z.boolean().optional(),
  persona: z.string().trim().max(4000).optional(),
  instructions: z.string().trim().max(8000).optional(),
  facts: z
    .array(z.string().max(1000))
    .max(200)
    .optional()
    .transform((arr) => (arr ? arr.map((f) => f.trim()).filter((f) => f.length > 0) : undefined)),
})

/**
 * AI Agent settings for the current location (GHL "Conversation AI" settings).
 * Mounted behind operatorAuth + locationAccess, so the location is the operator's
 * own. Two safe operations:
 *   - GET  /agent  reads the current reply mode + persona/instructions/facts
 *   - PATCH /agent merges a change atomically (LocationSettingsRepo)
 *
 * The reply mode is the load-bearing safety control: 'approve-first' (the default)
 * makes the agent draft for human approval and withholds all write tools;
 * 'autonomous' lets it act. Changing settings only stores text/flags — it never
 * sends a message or moves money.
 */
/**
 * The Payments settings patch (Module 48). The operator picks WHICH processor
 * the location uses and, for Square, that account's location id. The processor
 * keys themselves are never accepted here — they live in the vault and resolve
 * by name, so a settings write can never leak or store a credential.
 */
const paymentsPatchSchema = z.object({
  provider: z.enum(['stripe', 'square', 'none']).optional(),
  squareLocationId: z.string().trim().max(200).nullish(),
})

/**
 * The Sending settings patch (Module 49). The operator picks WHICH providers
 * carry their campaigns (Brevo email / Twilio SMS) and the sender identity —
 * never the credentials, which live in the vault and resolve by name.
 */
const sendingPatchSchema = z.object({
  emailProvider: z.enum(['brevo', 'none']).optional(),
  fromEmail: z.string().trim().max(320).nullish(),
  fromName: z.string().trim().max(200).nullish(),
  smsProvider: z.enum(['twilio', 'none']).optional(),
  smsFrom: z.string().trim().max(32).nullish(),
})

/**
 * The Social settings patch (Module 50/51). The operator stores WHICH channels
 * the location publishes as — the Facebook page id, Instagram user id, LinkedIn
 * author URN — plus the Google Business Profile account/location ids that
 * review sync reads from. Only these non-secret ids; the page/access tokens
 * are never accepted here — they live in the vault and resolve by name (D-36).
 */
const socialPatchSchema = z.object({
  facebookPageId: z.string().trim().max(200).nullish(),
  instagramUserId: z.string().trim().max(200).nullish(),
  linkedinAuthorUrn: z.string().trim().max(200).nullish(),
  googleAccountId: z.string().trim().max(200).nullish(),
  googleLocationId: z.string().trim().max(200).nullish(),
})

/** The platforms with real publishing adapters; each gets an honest readout. */
const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'x'] as const

/**
 * The Voice settings patch (Module 52). The operator picks WHICH voice provider
 * the location uses — Twilio for plain bridge calls (reusing the SMS account),
 * Vapi for the AI voice agent — plus the non-secret numbers/ids. The Twilio
 * token and Vapi key are never accepted here; they live in the vault and
 * resolve by name (D-36).
 */
const voicePatchSchema = z.object({
  provider: z.enum(['twilio', 'vapi', 'none']).optional(),
  fromNumber: z.string().trim().max(32).nullish(),
  operatorNumber: z.string().trim().max(32).nullish(),
  vapiAssistantId: z.string().trim().max(200).nullish(),
  vapiPhoneNumberId: z.string().trim().max(200).nullish(),
})

export function settingsRoute(deps: {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolvers. */
  resolvePayments?: typeof resolvePaymentProvider
  resolveEmail?: typeof resolveEmailSender
  resolveSms?: typeof resolveSmsSender
  resolveSocial?: typeof resolveSocialPublisher
  resolveReviews?: typeof resolveReviewSource
  resolveVoice?: typeof resolveVoiceProvider
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const resolvePayments = deps.resolvePayments ?? resolvePaymentProvider
  const resolveEmail = deps.resolveEmail ?? resolveEmailSender
  const resolveSms = deps.resolveSms ?? resolveSmsSender
  const resolveSocial = deps.resolveSocial ?? resolveSocialPublisher
  const resolveReviews = deps.resolveReviews ?? resolveReviewSource
  const resolveVoice = deps.resolveVoice ?? resolveVoiceProvider

  /** Per-channel honest readout: connected only when the chosen provider's
   *  keys actually resolve, with the refusal reason when they don't. */
  async function sendingStatus(loc: string) {
    const [email, sms] = await Promise.all([resolveEmail(deps.db, loc), resolveSms(deps.db, loc)])
    return {
      email: email.ok ? { connected: true } : { connected: false, reason: email.reason },
      sms: sms.ok ? { connected: true } : { connected: false, reason: sms.reason },
    }
  }

  app.get('/agent', async (c) => {
    const loc = c.get('locationId')
    const view = await new LocationSettingsRepo(deps.db, loc).getAgentSettings()
    return c.json(view)
  })

  app.patch('/agent', zValidator('json', agentPatchSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const view = await new LocationSettingsRepo(deps.db, loc).updateAgentSettings(input)
    return c.json({ ok: true, ...view })
  })

  // Payments (Module 48): which processor this location connected. `connected`
  // is the honest readout — true only when the chosen provider's keys actually
  // resolve, so the UI can say "connected" without lying about missing keys.
  app.get('/payments', async (c) => {
    const loc = c.get('locationId')
    const view = await new LocationSettingsRepo(deps.db, loc).getPaymentsSettings()
    const resolved = await resolvePayments(deps.db, loc)
    return c.json({ ...view, connected: resolved.ok, ...(resolved.ok ? {} : { reason: resolved.reason }) })
  })

  app.patch('/payments', zValidator('json', paymentsPatchSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const view = await new LocationSettingsRepo(deps.db, loc).updatePaymentsSettings(input)
    const resolved = await resolvePayments(deps.db, loc)
    return c.json({ ok: true, ...view, connected: resolved.ok, ...(resolved.ok ? {} : { reason: resolved.reason }) })
  })

  // Sending (Module 49): which providers carry this location's campaigns.
  app.get('/sending', async (c) => {
    const loc = c.get('locationId')
    const view = await new LocationSettingsRepo(deps.db, loc).getSendingSettings()
    return c.json({ ...view, ...(await sendingStatus(loc)) })
  })

  app.patch('/sending', zValidator('json', sendingPatchSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const view = await new LocationSettingsRepo(deps.db, loc).updateSendingSettings(input)
    return c.json({ ok: true, ...view, ...(await sendingStatus(loc)) })
  })

  /** Per-platform honest readout: connected only when the channel's ids +
   *  vault key actually build a working publisher, with the refusal reason
   *  when they don't. google_business has no publish adapter — its readout
   *  comes from the review-sync resolver instead (Module 51). */
  async function socialStatus(loc: string) {
    const entries = await Promise.all([
      ...SOCIAL_PLATFORMS.map(async (platform) => {
        const r = await resolveSocial(deps.db, loc, platform)
        return [platform, r.ok ? { connected: true } : { connected: false, reason: r.reason }] as const
      }),
      (async () => {
        const r = await resolveReviews(deps.db, loc, 'google')
        return ['google_business', r.ok ? { connected: true } : { connected: false, reason: r.reason }] as const
      })(),
    ])
    return Object.fromEntries(entries)
  }

  // Social (Module 50): the channel ids this location publishes as.
  app.get('/social', async (c) => {
    const loc = c.get('locationId')
    const view = await new LocationSettingsRepo(deps.db, loc).getSocialSettings()
    return c.json({ ...view, channels: await socialStatus(loc) })
  })

  app.patch('/social', zValidator('json', socialPatchSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const view = await new LocationSettingsRepo(deps.db, loc).updateSocialSettings(input)
    return c.json({ ok: true, ...view, channels: await socialStatus(loc) })
  })

  // Voice (Module 52): which voice provider this location connected. Same
  // honest readout as payments — connected only when the chosen provider's
  // keys + numbers actually resolve into a working adapter.
  app.get('/voice', async (c) => {
    const loc = c.get('locationId')
    const view = await new LocationSettingsRepo(deps.db, loc).getVoiceSettings()
    const resolved = await resolveVoice(deps.db, loc)
    return c.json({ ...view, connected: resolved.ok, ...(resolved.ok ? {} : { reason: resolved.reason }) })
  })

  app.patch('/voice', zValidator('json', voicePatchSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const view = await new LocationSettingsRepo(deps.db, loc).updateVoiceSettings(input)
    const resolved = await resolveVoice(deps.db, loc)
    return c.json({ ok: true, ...view, connected: resolved.ok, ...(resolved.ok ? {} : { reason: resolved.reason }) })
  })

  return app
}
