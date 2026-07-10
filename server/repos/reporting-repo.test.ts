import { FakeDatabase } from '../db/fake-database'
import { ReportingRepo } from './reporting-repo'

const repo = (db: FakeDatabase) => new ReportingRepo(db, 'locA')

test('constructor enforces the tenancy guard', () => {
  const db = new FakeDatabase()
  expect(() => new ReportingRepo(db, '')).toThrow(/locationId is required/)
})

test('contactCount scopes to the location and coerces to a number', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ count: 3 }])
  expect(await repo(db).contactCount()).toBe(3)
  expect(db.calls[0]?.sql).toMatch(/from contacts/i)
  expect(db.calls[0]?.sql).toMatch(/where location_id = \$1/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('contactCount returns 0 when nothing is queued', async () => {
  const db = new FakeDatabase()
  expect(await repo(db).contactCount()).toBe(0)
})

test('opportunityStatsByStatus keys count+value by status, coercing bigint strings', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { status: 'open', count: 4, value_cents: '70650000' },
    { status: 'won', count: 1, value_cents: '14200000' },
  ])
  const stats = await repo(db).opportunityStatsByStatus()
  expect(stats.open).toEqual({ count: 4, valueCents: 70650000 })
  expect(stats.won).toEqual({ count: 1, valueCents: 14200000 })
  expect(db.calls[0]?.sql).toMatch(/group by status/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('upcomingAppointmentCount filters future + non-cancelled, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ count: 5 }])
  expect(await repo(db).upcomingAppointmentCount()).toBe(5)
  expect(db.calls[0]?.sql).toMatch(/starts_at >= now\(\)/i)
  expect(db.calls[0]?.sql).toMatch(/status <> 'cancelled'/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('sentCampaignStats sums delivered messages over sent campaigns', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ campaigns: 1, messages: 3 }])
  expect(await repo(db).sentCampaignStats()).toEqual({ campaigns: 1, messages: 3 })
  expect(db.calls[0]?.sql).toMatch(/status = 'sent'/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('sentCampaignStats defaults to zeroes when nothing is queued', async () => {
  const db = new FakeDatabase()
  expect(await repo(db).sentCampaignStats()).toEqual({ campaigns: 0, messages: 0 })
})

test('stageBreakdown groups by stage, scoped to location + pipeline', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { stage_id: 'st_new', count: 1, value_cents: '18500000' },
    { stage_id: 'st_won', count: 1, value_cents: '14200000' },
  ])
  const buckets = await repo(db).stageBreakdown('pl1')
  expect(buckets).toEqual([
    { stageId: 'st_new', count: 1, valueCents: 18500000 },
    { stageId: 'st_won', count: 1, valueCents: 14200000 },
  ])
  expect(db.calls[0]?.sql).toMatch(/group by stage_id/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'pl1'])
})
