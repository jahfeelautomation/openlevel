import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface CampaignRecipient {
  id: string
  location_id: string
  campaign_id: string
  contact_id: string | null
  status: string
  created_at: string
}

export class CampaignRecipientsRepo extends LocationScopedRepo {
  /**
   * Insert one recipient row per contact in a single multi-row INSERT. Every row
   * reuses $1 (location) and $2 (campaign); each contact contributes an id + a
   * contact_id placeholder. status falls back to the column default ('sent').
   */
  async bulkInsert(campaignId: string, contactIds: string[]): Promise<CampaignRecipient[]> {
    if (contactIds.length === 0) return []
    const extra: unknown[] = [campaignId]
    const groups: string[] = []
    contactIds.forEach((cid, i) => {
      const idIdx = 3 + i * 2 // $3, $5, $7, ...
      const contactIdx = 4 + i * 2 // $4, $6, $8, ...
      extra.push(nanoid(), cid)
      groups.push(`($${idIdx},$1,$2,$${contactIdx})`)
    })
    return this.scopedWrite<CampaignRecipient>(
      `INSERT INTO campaign_recipients (id, location_id, campaign_id, contact_id)
       VALUES ${groups.join(',')} RETURNING *`,
      extra,
    )
  }

  /**
   * Status-aware variant for the real send path (Module 49): one row per
   * contact carrying its actual delivery outcome ('sent' | 'skipped' |
   * 'failed'), so the recipients list never claims a send that didn't happen.
   */
  async bulkInsertOutcomes(
    campaignId: string,
    outcomes: { contactId: string; status: string }[],
  ): Promise<CampaignRecipient[]> {
    if (outcomes.length === 0) return []
    const extra: unknown[] = [campaignId]
    const groups: string[] = []
    outcomes.forEach((o, i) => {
      const idIdx = 3 + i * 3 // $3, $6, $9, ...
      extra.push(nanoid(), o.contactId, o.status)
      groups.push(`($${idIdx},$1,$2,$${idIdx + 1},$${idIdx + 2})`)
    })
    return this.scopedWrite<CampaignRecipient>(
      `INSERT INTO campaign_recipients (id, location_id, campaign_id, contact_id, status)
       VALUES ${groups.join(',')} RETURNING *`,
      extra,
    )
  }

  listByCampaign(campaignId: string): Promise<CampaignRecipient[]> {
    return this.scopedSelect<CampaignRecipient>(
      'SELECT * FROM campaign_recipients WHERE campaign_id=$2 ORDER BY created_at',
      [campaignId],
    )
  }
}
