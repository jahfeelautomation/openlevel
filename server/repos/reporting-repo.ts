import { LocationScopedRepo } from './base-repo'

export interface CountValue {
  count: number
  valueCents: number
}

export interface StageBucket {
  stageId: string
  count: number
  valueCents: number
}

export interface CampaignTotals {
  /** How many campaigns have been sent. */
  campaigns: number
  /** Sum of delivered messages across those sent campaigns. */
  messages: number
}

/**
 * Read-only dashboard aggregates for one location.
 *
 * These queries use GROUP BY / aggregate functions, whose shape the base-repo
 * `scopedSelect` rewrite does not fit (it would inject a second WHERE at the
 * wrong place). So they go through `this.db.query` directly while still honoring
 * the tenancy invariant: every query filters on `location_id = $1` explicitly
 * and passes `this.locationId` as the first param.
 *
 * `count(*)` returns int4 (a JS number) but `sum(...)` returns numeric/bigint,
 * which the pg driver hands back as a string — so every result is coerced with
 * `Number(...)` to give callers clean numbers regardless of column type.
 */
export class ReportingRepo extends LocationScopedRepo {
  async contactCount(): Promise<number> {
    const rows = await this.db.query<{ count: number | string }>(
      'SELECT count(*)::int AS count FROM contacts WHERE location_id = $1',
      [this.locationId],
    )
    return Number(rows[0]?.count ?? 0)
  }

  /** Opportunity count + summed value, keyed by status (open/won/lost/...). */
  async opportunityStatsByStatus(): Promise<Record<string, CountValue>> {
    const rows = await this.db.query<{
      status: string
      count: number | string
      value_cents: number | string
    }>(
      `SELECT status, count(*)::int AS count, COALESCE(sum(value_cents),0)::bigint AS value_cents
         FROM opportunities WHERE location_id = $1 GROUP BY status`,
      [this.locationId],
    )
    const out: Record<string, CountValue> = {}
    for (const r of rows) {
      out[r.status] = { count: Number(r.count), valueCents: Number(r.value_cents) }
    }
    return out
  }

  /** Appointments still ahead of now and not cancelled. */
  async upcomingAppointmentCount(): Promise<number> {
    const rows = await this.db.query<{ count: number | string }>(
      `SELECT count(*)::int AS count FROM appointments
        WHERE location_id = $1 AND starts_at >= now() AND status <> 'cancelled'`,
      [this.locationId],
    )
    return Number(rows[0]?.count ?? 0)
  }

  /** How many campaigns went out and how many messages they delivered. */
  async sentCampaignStats(): Promise<CampaignTotals> {
    const rows = await this.db.query<{ campaigns: number | string; messages: number | string }>(
      `SELECT count(*)::int AS campaigns, COALESCE(sum(sent_count),0)::int AS messages
         FROM campaigns WHERE location_id = $1 AND status = 'sent'`,
      [this.locationId],
    )
    const row = rows[0]
    return { campaigns: Number(row?.campaigns ?? 0), messages: Number(row?.messages ?? 0) }
  }

  /** Per-stage deal count + value for one pipeline (all statuses). */
  async stageBreakdown(pipelineId: string): Promise<StageBucket[]> {
    const rows = await this.db.query<{
      stage_id: string
      count: number | string
      value_cents: number | string
    }>(
      `SELECT stage_id, count(*)::int AS count, COALESCE(sum(value_cents),0)::bigint AS value_cents
         FROM opportunities WHERE location_id = $1 AND pipeline_id = $2 GROUP BY stage_id`,
      [this.locationId, pipelineId],
    )
    return rows.map((r) => ({
      stageId: r.stage_id,
      count: Number(r.count),
      valueCents: Number(r.value_cents),
    }))
  }
}
