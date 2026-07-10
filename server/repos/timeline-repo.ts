import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface TimelineEvent {
  id: string
  location_id: string
  contact_id: string | null
  type: string
  ref_table: string | null
  ref_id: string | null
  payload: Record<string, unknown>
  occurred_at: string
}

export interface TimelineInput {
  contactId: string | null
  type: string
  refTable?: string
  refId?: string
  payload?: Record<string, unknown>
}

export class TimelineRepo extends LocationScopedRepo {
  async add(input: TimelineInput): Promise<TimelineEvent> {
    const id = nanoid()
    const rows = await this.db.query<TimelineEvent>(
      `INSERT INTO timeline_events (id, location_id, contact_id, type, ref_table, ref_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, this.locationId, input.contactId, input.type, input.refTable ?? null, input.refId ?? null, input.payload ?? {}],
    )
    return rows[0]!
  }

  listByContact(contactId: string, limit = 100): Promise<TimelineEvent[]> {
    return this.scopedSelect<TimelineEvent>(
      'SELECT * FROM timeline_events WHERE contact_id=$2 ORDER BY occurred_at DESC LIMIT $3',
      [contactId, limit],
    )
  }
}
