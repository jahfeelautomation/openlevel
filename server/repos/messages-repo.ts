import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Message {
  id: string
  location_id: string
  conversation_id: string | null
  contact_id: string | null
  direction: 'inbound' | 'outbound'
  channel: string | null
  provider: string | null
  external_id: string | null
  body: string | null
  attachments: unknown[]
  author_type: string | null
  author_id: string | null
  status: string
  created_at: string
}

export interface InboundInput {
  conversationId: string
  contactId: string | null
  channel: string
  provider: string
  externalId: string
  body: string
  attachments?: unknown[]
  authorType?: string
}

export interface OutboundInput {
  conversationId: string
  contactId: string | null
  channel: string
  body: string
  authorType: string
  authorId: string | null
  status?: string
  provider?: string
  externalId?: string | null
}

export class MessagesRepo extends LocationScopedRepo {
  /**
   * Insert an inbound message. Returns the row, or null if a row with the same
   * (location, provider, external_id) already exists — the webhook dedupe guard.
   * The conflict target is location-scoped: two federated Chatwoot instances can
   * hand out the same numeric message id, and a global (provider, external_id)
   * guard would silently drop tenant B's distinct message as a "duplicate" of
   * tenant A's. Matching messages_provider_external keeps dedupe per-tenant.
   */
  async insertInbound(input: InboundInput): Promise<Message | null> {
    const id = nanoid()
    const rows = await this.db.query<Message>(
      `INSERT INTO messages (id, location_id, conversation_id, contact_id, direction, channel, provider, external_id, body, attachments, author_type, status)
       VALUES ($1,$2,$3,$4,'inbound',$5,$6,$7,$8,$9,$10,'received')
       ON CONFLICT (location_id, provider, external_id) DO NOTHING
       RETURNING *`,
      [
        id,
        this.locationId,
        input.conversationId,
        input.contactId,
        input.channel,
        input.provider,
        input.externalId,
        input.body,
        JSON.stringify(input.attachments ?? []),
        input.authorType ?? 'contact',
      ],
    )
    return rows[0] ?? null
  }

  async insertOutbound(input: OutboundInput): Promise<Message> {
    const id = nanoid()
    const rows = await this.db.query<Message>(
      `INSERT INTO messages (id, location_id, conversation_id, contact_id, direction, channel, provider, external_id, body, author_type, author_id, status)
       VALUES ($1,$2,$3,$4,'outbound',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        id,
        this.locationId,
        input.conversationId,
        input.contactId,
        input.channel,
        input.provider ?? null,
        input.externalId ?? null,
        input.body,
        input.authorType,
        input.authorId,
        input.status ?? 'sent',
      ],
    )
    return rows[0]!
  }

  listByConversation(conversationId: string): Promise<Message[]> {
    return this.scopedSelect<Message>(
      'SELECT * FROM messages WHERE conversation_id=$2 ORDER BY created_at ASC',
      [conversationId],
    )
  }
}
