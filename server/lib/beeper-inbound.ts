/**
 * Pure mapping from the gateway's Beeper inbound payload to our domain event. No
 * I/O — the route does the lead match + persistence. The gateway (which already
 * reads Beeper for the portal — we do NOT reconnect Beeper here) has ALREADY
 * filtered to genuine inbound text via beeper-reader.toInboundMessages (dropped
 * our-own / deleted / non-text), so this layer only validates shape: a message we
 * can dedup (messageId) that carries the phone we match against an existing lead.
 * Anything unmatchable maps to null so the route can 200-ack and ignore.
 *
 * Scope (Admin, 2026-06-19): we only ingest threads whose number is already a
 * lead — so the route does a find-by-phone (NOT upsert) and skips on no match.
 * The phone rides through untrimmed-normalized here; ContactsRepo normalizes it
 * at match time, exactly as the Chatwoot path does.
 */

export interface BeeperInboundPayload {
  /** Beeper chat id — external conversation id, the per-thread dedup/group key. */
  chatId?: string
  /** E.164 the chat was opened with — matched against an existing lead (find-only). */
  phone?: string
  /** Beeper message id — external message id, the per-message dedup key. */
  messageId?: string
  text?: string
  /** ISO timestamp. */
  timestamp?: string
  senderName?: string
}

export interface BeeperInboundMessage {
  kind: 'message'
  direction: 'inbound'
  chatId: string
  externalMessageId: string
  body: string
  timestamp?: string
  contact: { phone: string; name?: string }
}

export function parseBeeperInbound(payload: BeeperInboundPayload): BeeperInboundMessage | null {
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : ''
  if (!phone) return null
  const externalMessageId = typeof payload.messageId === 'string' ? payload.messageId.trim() : ''
  if (!externalMessageId) return null
  const body = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (!body) return null

  const msg: BeeperInboundMessage = {
    kind: 'message',
    direction: 'inbound',
    chatId: typeof payload.chatId === 'string' ? payload.chatId : '',
    externalMessageId,
    body,
    contact: { phone, name: payload.senderName || undefined },
  }
  if (payload.timestamp) msg.timestamp = payload.timestamp
  return msg
}

