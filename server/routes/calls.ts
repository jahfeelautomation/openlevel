import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { callStats } from '../lib/call-math'
import { resolveVoiceProvider } from '../lib/voice/resolve'
import { CallsRepo } from '../repos/calls-repo'
import { ContactsRepo } from '../repos/contacts-repo'

const placeCallSchema = z.object({
  contactId: z.string().min(1),
})

/** The public origin as the outside world sees it — behind Traefik the node
 *  server sees http://, so restore the scheme from X-Forwarded-Proto. Twilio
 *  signs its status callbacks over this exact URL. */
function publicOrigin(c: Context<AppEnv>): string {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto')
  if (proto) url.protocol = `${proto}:`
  return url.origin
}

/**
 * The call log + click-to-call (Module 52). Mounted behind operatorAuth +
 * locationAccess. Calls happen inside the location's OWN provider account
 * (their Twilio number and rates, or their Vapi assistant) — OpenLevel only
 * asks for the call and records what the provider reports back:
 *
 *   GET  /        the call log, newest first, plus derived stats
 *   POST /        place a call to a contact (twilio: bridge to the operator's
 *                 phone; vapi: the AI assistant makes the call)
 *
 * This is an OPERATOR action only — the AI conversation agent has no tool that
 * can reach this route, so it can never place a call on its own.
 */
export function callsRoute(deps: {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolver. */
  resolveVoice?: typeof resolveVoiceProvider
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const resolveVoice = deps.resolveVoice ?? resolveVoiceProvider

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const calls = await new CallsRepo(deps.db, loc).list()
    return c.json({ calls, stats: callStats(calls) })
  })

  app.post('/', zValidator('json', placeCallSchema), async (c) => {
    const loc = c.get('locationId')
    const { contactId } = c.req.valid('json')

    const contact = await new ContactsRepo(deps.db, loc).get(contactId)
    if (!contact) return c.json({ error: 'contact not found' }, 404)
    const to = contact.phones[0]
    if (!to) return c.json({ error: 'contact has no phone number' }, 422)

    // Only the Twilio adapter consumes the callback URL; it points at the
    // signature-verified public webhook so the log follows the live call.
    const resolved = await resolveVoice(deps.db, loc, {
      statusCallbackUrl: `${publicOrigin(c)}/api/public/voice/webhook/twilio/${loc}`,
    })
    if (!resolved.ok) return c.json({ error: resolved.reason }, 409)

    let placed
    try {
      placed = await resolved.provider.placeCall({ to })
    } catch (err) {
      // Adapter errors carry the HTTP status, never the key — safe to surface.
      return c.json({ error: err instanceof Error ? err.message : 'call failed' }, 502)
    }

    const call = await new CallsRepo(deps.db, loc).create({
      contactId,
      direction: 'outbound',
      fromNumber: placed.from ?? null,
      toNumber: to,
      provider: placed.provider,
      externalId: placed.externalId,
    })
    return c.json({ ok: true, call })
  })

  return app
}
