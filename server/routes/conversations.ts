import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { ClaudeClient } from '../jobs/agent-reply'
import { sendChatwootMessage } from '../lib/chatwoot-client'
import { draftConversationReply } from '../lib/draft'
import { sendOutboundMessage } from '../lib/outbound'
import { resolveSecret } from '../lib/vault'
import { ConversationsRepo } from '../repos/conversations-repo'
import { MessagesRepo } from '../repos/messages-repo'

export interface ConversationsDeps {
  db: Database
  /** Injectable for tests — defaults to the real Chatwoot HTTP adapter. */
  sendMessage?: typeof sendChatwootMessage
  /** Injectable for tests — defaults to the env/Vaultwarden secret resolver. */
  resolveSecret?: typeof resolveSecret
  /** Claude client for the "Draft from agent" button. When unset, /draft is 501. */
  claude?: ClaudeClient
}

const sendSchema = z.object({ body: z.string().min(1) })

/**
 * Conversations for the current location. Mounted behind operatorAuth +
 * locationAccess. The send path delegates to the shared sendOutboundMessage
 * helper (lib/outbound), which federates out through Chatwoot and persists the
 * outbound message + timeline event.
 */
export function conversationsRoute(deps: ConversationsDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const conversations = await new ConversationsRepo(deps.db, loc).list(100)
    return c.json({ conversations })
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const conversation = await new ConversationsRepo(deps.db, loc).get(id)
    if (!conversation) return c.json({ error: 'not found' }, 404)
    const messages = await new MessagesRepo(deps.db, loc).listByConversation(id)
    return c.json({ conversation, messages })
  })

  app.post('/:id/messages', zValidator('json', sendSchema), async (c) => {
    const loc = c.get('locationId')
    const operatorId = c.get('operatorId')
    const id = c.req.param('id')
    const { body } = c.req.valid('json')
    const result = await sendOutboundMessage(
      deps.db,
      loc,
      { conversationId: id, body, authorType: 'operator', authorId: operatorId },
      { sendMessage: deps.sendMessage, resolveSecret: deps.resolveSecret },
    )
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json({ ok: true, message: result.message })
  })

  // "Draft from agent" — generate an AI reply for the operator to review/edit.
  // Does NOT persist or send; the operator approves by sending normally.
  app.post('/:id/draft', async (c) => {
    if (!deps.claude) return c.json({ error: 'drafting is not configured' }, 501)
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const result = await draftConversationReply(
      { db: deps.db, claude: deps.claude, resolveSecret: deps.resolveSecret },
      loc,
      id,
    )
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json({ text: result.text })
  })

  return app
}
