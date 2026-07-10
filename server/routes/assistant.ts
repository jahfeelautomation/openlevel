import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { ClaudeClient } from '../jobs/agent-reply'
import { runOperatorAssistant } from '../lib/operator-assistant'
import { confirmOperatorWrite, type SendTextFn } from '../lib/operator-tools'
import { resolveSecret } from '../lib/vault'

/**
 * The operator assistant route — OpenLevel's "AI front door". Two POST endpoints:
 *   - /messages: the chat page sends the running operator↔assistant history plus
 *     the new message; it returns the assistant's reply AND any changes the agent
 *     PREPARED for confirmation (proposals). The chat turn never mutates.
 *   - /confirm: performs ONE prepared change ({verb, params}) — the only write path
 *     in the whole assistant. locationId comes from the trusted context, never the
 *     body, so a confirm can never reach another tenant.
 * Mounted behind operatorAuth + locationAccess, so the locationId on the context is
 * already the operator's own tenant. This route never sends a customer message and
 * never touches money — no such tool exists (D-36).
 */
export interface AssistantRouteDeps {
  db: Database
  /** Claude client. When unset, the endpoint is 501 (assistant not configured). */
  claude?: ClaudeClient
  /** Injectable for tests — defaults to the env/Vaultwarden secret resolver. */
  resolveSecret?: typeof resolveSecret
  /** The gateway text rail, passed through to /confirm's send_text. Absent =
   *  texting not wired up; confirming a send_text honestly reports "not set up". */
  sendText?: SendTextFn
}

const turnSchema = z.object({ role: z.enum(['operator', 'assistant']), content: z.string() })
const sendSchema = z.object({ history: z.array(turnSchema).default([]), message: z.string().min(1) })
// The confirm body is deliberately loose: confirmOperatorWrite re-validates the
// verb against the write allowlist and re-resolves params against the live DB, so
// the route only has to ensure a verb is present.
const confirmSchema = z.object({ verb: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) })

export function assistantRoute(deps: AssistantRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/messages', zValidator('json', sendSchema), async (c) => {
    if (!deps.claude) return c.json({ error: 'assistant is not configured' }, 501)
    const loc = c.get('locationId')
    const { history, message } = c.req.valid('json')
    const result = await runOperatorAssistant(
      { db: deps.db, claude: deps.claude, resolveSecret: deps.resolveSecret },
      loc,
      history,
      message,
    )
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json({ reply: result.reply, proposals: result.proposals ?? [] })
  })

  // Perform one prepared change. No model call, so it does NOT require deps.claude.
  // The tenant is the context's locationId (set by locationAccess), never the body.
  app.post('/confirm', zValidator('json', confirmSchema), async (c) => {
    const loc = c.get('locationId')
    const { verb, params } = c.req.valid('json')
    const result = await confirmOperatorWrite({ db: deps.db, locationId: loc, sendText: deps.sendText }, { verb, params })
    if (!result.ok) return c.json({ error: result.message }, result.status)
    return c.json({ message: result.message })
  })

  return app
}
