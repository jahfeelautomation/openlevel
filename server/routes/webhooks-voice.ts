import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { resolveVoiceProvider } from '../lib/voice/resolve'
import { CallsRepo } from '../repos/calls-repo'

/**
 * The URL the provider actually signed over. Twilio signs the PUBLIC https URL
 * it was told to call, but behind Traefik the node server sees http://, so we
 * restore the scheme from X-Forwarded-Proto before verification.
 */
function deliveredUrl(c: Context<AppEnv>): string {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto')
  if (proto) url.protocol = `${proto}:`
  return url.toString()
}

/**
 * Public voice-provider webhooks (Module 52). Mounted under /api/public/voice
 * with NO session auth — the provider's signature (Twilio HMAC) or echoed
 * server secret (Vapi) is the only credential, verified over the RAW body
 * before anything is parsed. The URL names the location, so the right
 * per-location secret resolves and every DB access is scoped to it:
 *
 *   POST /webhook/:provider/:locationId   call status / end-of-call delivery
 *
 * A verified event upserts the call log row by the provider's own call id —
 * idempotent, so retried and out-of-order deliveries can't duplicate a call or
 * drag a finished one back to 'ringing' (see CallsRepo.upsertExternal).
 */
export function voiceWebhookRoute(deps: {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolver. */
  resolveVoice?: typeof resolveVoiceProvider
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const resolveVoice = deps.resolveVoice ?? resolveVoiceProvider

  app.post('/webhook/:provider/:locationId', async (c) => {
    const providerName = c.req.param('provider')
    const locationId = c.req.param('locationId')
    const rawBody = await c.req.text()

    // The location must exist AND have this provider connected — anything else
    // is indistinguishable from a probe, so it gets a plain 404.
    const resolved = await resolveVoice(deps.db, locationId)
    if (!resolved.ok || resolved.provider.name !== providerName) return c.json({ error: 'not found' }, 404)

    const headers: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(c.req.header())) headers[k.toLowerCase()] = v
    if (!resolved.provider.verifyWebhook({ rawBody, headers, url: deliveredUrl(c) })) {
      return c.json({ error: 'invalid signature' }, 401)
    }

    const event = resolved.provider.parseEvent(rawBody)
    if (event.type !== 'call_update') return c.json({ ok: true, ignored: true })

    const { inserted } = await new CallsRepo(deps.db, locationId).upsertExternal({
      provider: providerName,
      externalId: event.externalId,
      direction: event.direction,
      status: event.status,
      fromNumber: event.from ?? null,
      toNumber: event.to ?? null,
      durationSeconds: event.durationSeconds ?? null,
      recordingUrl: event.recordingUrl ?? null,
      transcript: event.transcript ?? null,
      summary: event.summary ?? null,
    })
    return c.json({ ok: true, applied: true, inserted })
  })

  return app
}
