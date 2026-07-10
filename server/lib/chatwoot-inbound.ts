/**
 * Pure mapping from a Chatwoot webhook payload to our domain event. No I/O —
 * the route does the persistence. Only inbound (incoming) message_created
 * events produce an event; everything else (status changes, outgoing echoes)
 * maps to null so the route can 200-ack and ignore.
 */

export interface ChatwootWebhookPayload {
  event?: string
  message_type?: string
  content?: string
  id?: number | string
  conversation?: { id?: number | string; inbox_id?: number | string }
  inbox?: { id?: number | string }
  sender?: { name?: string; phone_number?: string | null; email?: string | null }
}

export interface ChatwootInboundMessage {
  kind: 'message'
  direction: 'inbound'
  inboxId: string
  externalMessageId: string
  externalConversationId: string
  body: string
  contact: { name?: string; phone?: string; email?: string }
}

export function parseChatwootEvent(payload: ChatwootWebhookPayload): ChatwootInboundMessage | null {
  if (payload.event !== 'message_created') return null
  if (payload.message_type !== 'incoming') return null

  const rawInbox = payload.inbox?.id ?? payload.conversation?.inbox_id
  if (rawInbox === undefined || rawInbox === null) return null

  return {
    kind: 'message',
    direction: 'inbound',
    inboxId: String(rawInbox),
    externalMessageId: String(payload.id ?? ''),
    externalConversationId: String(payload.conversation?.id ?? ''),
    body: payload.content ?? '',
    contact: {
      name: payload.sender?.name || undefined,
      phone: payload.sender?.phone_number || undefined,
      email: payload.sender?.email || undefined,
    },
  }
}
