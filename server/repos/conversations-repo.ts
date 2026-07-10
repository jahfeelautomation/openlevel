import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Conversation {
  id: string
  location_id: string
  contact_id: string | null
  channel: string | null
  provider: string | null
  external_id: string | null
  status: string
  assignee: string | null
  last_message_at: string | null
  created_at: string
}

export interface ConversationInput {
  provider: string
  externalId: string
  contactId: string | null
  channel: string
}

export class ConversationsRepo extends LocationScopedRepo {
  /**
   * Find a conversation by (location, provider, external_id) or create it, in one
   * atomic statement. A plain SELECT-then-INSERT races: two webhook deliveries for
   * the same Chatwoot conversation both miss the SELECT and both INSERT. The
   * ON CONFLICT against conversations_provider_external collapses that to a single
   * row - the no-op DO UPDATE (re-setting external_id to its own value) makes the
   * pre-existing row eligible for RETURNING, so the loser of the race gets the
   * winner's row back instead of a unique-violation error. The existing
   * contact_id/channel are left untouched on conflict.
   */
  async upsertByExternal(input: ConversationInput): Promise<Conversation> {
    const id = nanoid()
    const rows = await this.db.query<Conversation>(
      `INSERT INTO conversations (id, location_id, contact_id, channel, provider, external_id, status, last_message_at)
       VALUES ($1,$2,$3,$4,$5,$6,'open', now())
       ON CONFLICT (location_id, provider, external_id)
       DO UPDATE SET external_id = EXCLUDED.external_id
       RETURNING *`,
      [id, this.locationId, input.contactId, input.channel, input.provider, input.externalId],
    )
    return rows[0]!
  }

  async touch(id: string): Promise<void> {
    await this.db.query('UPDATE conversations SET last_message_at=now() WHERE location_id=$1 AND id=$2', [
      this.locationId,
      id,
    ])
  }

  list(limit = 50): Promise<Conversation[]> {
    return this.scopedSelect<Conversation>(
      'SELECT * FROM conversations ORDER BY last_message_at DESC NULLS LAST LIMIT $2',
      [limit],
    )
  }

  async get(id: string): Promise<Conversation | undefined> {
    const rows = await this.scopedSelect<Conversation>('SELECT * FROM conversations WHERE id=$2', [id])
    return rows[0]
  }
}
