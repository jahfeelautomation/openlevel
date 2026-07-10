import type { Database } from '../db/database'

export interface ResolvedChannel {
  locationId: string
  inboxId: string
  config: Record<string, unknown>
}

/**
 * NOT location-scoped — this repo is the single tenancy ENTRY POINT. An inbound
 * channel event (e.g. a Chatwoot webhook) arrives with no location; this resolves
 * which location owns the inbox, and every other repo is then constructed with
 * the locationId it returns.
 */
export class ChannelLinksRepo {
  constructor(private db: Database) {}

  async resolveLocation(provider: string, inboxId: string): Promise<ResolvedChannel | undefined> {
    const rows = await this.db.query<{ location_id: string; inbox_id: string; config: Record<string, unknown> }>(
      'SELECT location_id, inbox_id, config FROM channel_links WHERE provider=$1 AND inbox_id=$2',
      [provider, inboxId],
    )
    const row = rows[0]
    if (!row) return undefined
    return { locationId: row.location_id, inboxId: row.inbox_id, config: row.config ?? {} }
  }

  /**
   * Find a provider's channel link within an ALREADY-verified location (the
   * outbound path). `resolveLocation` maps an unknown inbox -> location for
   * inbound; this fetches the send config (baseUrl / accountId / token-secret
   * name) once the location is known and the operator's access is checked.
   */
  async getForLocation(provider: string, locationId: string): Promise<ResolvedChannel | undefined> {
    const rows = await this.db.query<{ location_id: string; inbox_id: string; config: Record<string, unknown> }>(
      'SELECT location_id, inbox_id, config FROM channel_links WHERE provider=$1 AND location_id=$2 LIMIT 1',
      [provider, locationId],
    )
    const row = rows[0]
    if (!row) return undefined
    return { locationId: row.location_id, inboxId: row.inbox_id, config: row.config ?? {} }
  }
}
