import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import type { Database } from '../db/database'
import { ChannelLinksRepo } from '../repos/channel-links-repo'
import { ContactsRepo } from '../repos/contacts-repo'
import { ConversationsRepo } from '../repos/conversations-repo'
import { MessagesRepo } from '../repos/messages-repo'
import { TimelineRepo } from '../repos/timeline-repo'
import { parseChatwootEvent } from '../lib/chatwoot-inbound'

/**
 * Constant-time secret check. A plain `a !== b` short-circuits on the first
 * differing byte, so how long the rejection takes leaks how many leading bytes
 * matched - enough, in principle, for a remote attacker to recover the secret one
 * byte at a time. Hashing both sides to a fixed 32-byte digest first means
 * timingSafeEqual always compares equal-length buffers (it throws on a length
 * mismatch) without leaking the secret's length, and the compare itself runs in
 * time independent of where the inputs first differ.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export interface InboundEvent {
  locationId: string
  conversationId: string
  contactId: string
  messageId: string
  /** Best-effort display name for a push title; falls back to the webhook sender's name. */
  contactName?: string
  /** Raw inbound text, used only for a push body preview. */
  preview?: string
}

export interface ChatwootWebhookDeps {
  db: Database
  webhookSecret: string
  /** Optional hook (Phase E): enqueue agent.reply.dispatch after a fresh inbound. */
  onInbound?: (e: InboundEvent) => void | Promise<void>
}

export function chatwootWebhookRoute(deps: ChatwootWebhookDeps): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    // Prefer the header: a query-string secret rides in the URL and can land in
    // reverse-proxy access logs. We still accept ?secret= because Chatwoot's
    // generic webhook cannot send a custom header, so the URL is its only channel.
    const provided = c.req.header('x-webhook-secret') ?? c.req.query('secret') ?? ''
    if (!secretsMatch(provided, deps.webhookSecret)) return c.json({ error: 'unauthorized' }, 401)

    const payload = await c.req.json().catch(() => null)
    const event = payload ? parseChatwootEvent(payload) : null
    if (!event) return c.json({ ignored: true }, 200)

    const channel = await new ChannelLinksRepo(deps.db).resolveLocation('chatwoot', event.inboxId)
    if (!channel) return c.json({ ignored: 'no channel link' }, 200)
    const loc = channel.locationId

    const contact = await new ContactsRepo(deps.db, loc).upsertByMatch(event.contact, 'chatwoot')
    const conversations = new ConversationsRepo(deps.db, loc)
    const conversation = await conversations.upsertByExternal({
      provider: 'chatwoot',
      externalId: event.externalConversationId,
      contactId: contact.id,
      channel: 'chatwoot',
    })
    const message = await new MessagesRepo(deps.db, loc).insertInbound({
      conversationId: conversation.id,
      contactId: contact.id,
      channel: 'chatwoot',
      provider: 'chatwoot',
      externalId: event.externalMessageId,
      body: event.body,
    })
    if (!message) return c.json({ ok: true, deduped: true }, 200)

    await new TimelineRepo(deps.db, loc).add({
      contactId: contact.id,
      type: 'message',
      refTable: 'messages',
      refId: message.id,
      payload: { direction: 'inbound', body: event.body, channel: 'chatwoot' },
    })
    await conversations.touch(conversation.id)

    if (deps.onInbound) {
      await deps.onInbound({
        locationId: loc,
        conversationId: conversation.id,
        contactId: contact.id,
        messageId: message.id,
        contactName: contact.name ?? event.contact.name,
        preview: event.body,
      })
    }

    return c.json(
      { ok: true, contactId: contact.id, conversationId: conversation.id, messageId: message.id },
      200,
    )
  })

  return app
}
