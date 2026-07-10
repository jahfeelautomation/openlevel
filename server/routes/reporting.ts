import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { PipelinesRepo } from '../repos/pipelines-repo'
import { type CountValue, ReportingRepo } from '../repos/reporting-repo'

const ZERO: CountValue = { count: 0, valueCents: 0 }

/**
 * Dashboard summary for the current location: headline KPIs (contacts, open and
 * won opportunity value, upcoming appointments, campaign delivery) plus a
 * per-stage breakdown of the primary pipeline. Read-only; mounted behind
 * operatorAuth + locationAccess.
 *
 * Every number is a live aggregate over the location's own data — nothing here
 * is fabricated. The stage breakdown is zipped onto the pipeline's ordered
 * stages so empty stages still show (count 0, value 0).
 */
export function reportingRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const reporting = new ReportingRepo(deps.db, loc)

    const pipelines = await new PipelinesRepo(deps.db, loc).listWithStages()
    const primary = pipelines[0] ?? null

    const contacts = await reporting.contactCount()
    const oppStats = await reporting.opportunityStatsByStatus()
    const upcomingAppointments = await reporting.upcomingAppointmentCount()
    const campaignTotals = await reporting.sentCampaignStats()
    const buckets = primary ? await reporting.stageBreakdown(primary.id) : []

    const bucketByStage = new Map(buckets.map((b) => [b.stageId, b]))
    const pipeline = primary
      ? {
          id: primary.id,
          name: primary.name,
          stages: primary.stages.map((s) => {
            const b = bucketByStage.get(s.id)
            return { id: s.id, name: s.name, count: b?.count ?? 0, valueCents: b?.valueCents ?? 0 }
          }),
        }
      : null

    return c.json({
      summary: {
        contacts,
        openOpportunities: oppStats.open ?? ZERO,
        wonOpportunities: oppStats.won ?? ZERO,
        upcomingAppointments,
        campaignsSent: campaignTotals.campaigns,
        messagesSent: campaignTotals.messages,
        pipeline,
      },
    })
  })

  return app
}
