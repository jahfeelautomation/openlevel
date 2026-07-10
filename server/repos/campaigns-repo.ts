import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Campaign {
  id: string
  location_id: string
  name: string
  channel: string
  subject: string | null
  body: string
  audience_tag: string | null
  status: string
  recipient_count: number
  sent_count: number
  created_at: string
  updated_at: string
  sent_at: string | null
}

export interface CampaignInput {
  name: string
  channel?: string
  subject?: string | null
  body: string
  audienceTag?: string | null
}

export class CampaignsRepo extends LocationScopedRepo {
  list(): Promise<Campaign[]> {
    return this.scopedSelect<Campaign>('SELECT * FROM campaigns ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Campaign | undefined> {
    const rows = await this.scopedSelect<Campaign>('SELECT * FROM campaigns WHERE id=$2', [id])
    return rows[0]
  }

  async create(input: CampaignInput): Promise<Campaign> {
    const id = nanoid()
    const rows = await this.scopedWrite<Campaign>(
      `INSERT INTO campaigns (id, location_id, name, channel, subject, body, audience_tag)
       VALUES ($2,$1,$3,$4,$5,$6,$7) RETURNING *`,
      [id, input.name, input.channel ?? 'sms', input.subject ?? null, input.body, input.audienceTag ?? null],
    )
    return rows[0]!
  }

  /** Flip a draft to sent, stamping the recipient/sent counts and sent_at. */
  async markSent(id: string, recipientCount: number, sentCount: number): Promise<Campaign | undefined> {
    const rows = await this.scopedWrite<Campaign>(
      `UPDATE campaigns
         SET status='sent', recipient_count=$2, sent_count=$3, sent_at=now(), updated_at=now()
       WHERE location_id=$1 AND id=$4 RETURNING *`,
      [recipientCount, sentCount, id],
    )
    return rows[0]
  }
}
