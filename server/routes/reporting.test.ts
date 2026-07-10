import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { reportingRoute } from './reporting'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', reportingRoute({ db }))
  return app
}

// The route issues queries in a fixed order; enqueue results to match:
//   0 pipelines, 1 stages (listWithStages), 2 contacts, 3 opp-by-status,
//   4 upcoming appts, 5 sent campaigns, 6 stage breakdown.
function seedHappyPath(db: FakeDatabase) {
  db.enqueue([{ id: 'pl1', location_id: 'locA', name: 'Cash Offer Pipeline', position: 0 }])
  db.enqueue([
    { id: 'st_new', pipeline_id: 'pl1', name: 'New Lead', position: 0 },
    { id: 'st_won', pipeline_id: 'pl1', name: 'Closed Won', position: 1 },
  ])
  db.enqueue([{ count: 3 }])
  db.enqueue([
    { status: 'open', count: 4, value_cents: '70650000' },
    { status: 'won', count: 1, value_cents: '14200000' },
  ])
  db.enqueue([{ count: 5 }])
  db.enqueue([{ campaigns: 1, messages: 3 }])
  db.enqueue([
    { stage_id: 'st_new', count: 1, value_cents: '18500000' },
    { stage_id: 'st_won', count: 1, value_cents: '14200000' },
  ])
}

test('GET / assembles the dashboard summary scoped to the location', async () => {
  const db = new FakeDatabase()
  seedHappyPath(db)

  const res = await harness(db).request('/')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { summary: Record<string, unknown> }
  expect(body.summary).toMatchObject({
    contacts: 3,
    openOpportunities: { count: 4, valueCents: 70650000 },
    wonOpportunities: { count: 1, valueCents: 14200000 },
    upcomingAppointments: 5,
    campaignsSent: 1,
    messagesSent: 3,
  })
  // every query is scoped to the location (first param)
  expect(db.calls[0]?.params).toEqual(['locA'])
  expect(db.calls.every((c) => c.params[0] === 'locA')).toBe(true)
})

test('GET / zips stage breakdown onto pipeline stages, filling zero for empties', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'pl1', location_id: 'locA', name: 'P', position: 0 }])
  db.enqueue([
    { id: 's1', pipeline_id: 'pl1', name: 'New', position: 0 },
    { id: 's2', pipeline_id: 'pl1', name: 'Won', position: 1 },
  ])
  db.enqueue([{ count: 0 }])
  db.enqueue([]) // no opportunity stats at all
  db.enqueue([{ count: 0 }])
  db.enqueue([{ campaigns: 0, messages: 0 }])
  db.enqueue([{ stage_id: 's1', count: 2, value_cents: '500' }]) // only s1 has deals

  const res = await harness(db).request('/')
  const body = (await res.json()) as { summary: { openOpportunities: unknown; wonOpportunities: unknown; pipeline: { stages: unknown[] } } }
  expect(body.summary.openOpportunities).toEqual({ count: 0, valueCents: 0 })
  expect(body.summary.wonOpportunities).toEqual({ count: 0, valueCents: 0 })
  expect(body.summary.pipeline.stages).toEqual([
    { id: 's1', name: 'New', count: 2, valueCents: 500 },
    { id: 's2', name: 'Won', count: 0, valueCents: 0 },
  ])
  // stageBreakdown is scoped to location + the primary pipeline id
  expect(db.calls[6]?.params).toEqual(['locA', 'pl1'])
})

test('GET / handles a location with no pipeline (pipeline = null, no breakdown query)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // no pipelines
  db.enqueue([]) // no stages
  db.enqueue([{ count: 0 }])
  db.enqueue([]) // no opp stats
  db.enqueue([{ count: 0 }])
  db.enqueue([{ campaigns: 0, messages: 0 }])

  const res = await harness(db).request('/')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { summary: { pipeline: unknown } }
  expect(body.summary.pipeline).toBeNull()
  // only six queries ran — stageBreakdown is skipped when there is no pipeline
  expect(db.calls).toHaveLength(6)
})
