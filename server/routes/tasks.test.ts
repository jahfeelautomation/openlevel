import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { tasksRoute } from './tasks'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', tasksRoute({ db }))
  return app
}

test('lists every task in the location with a live KPI summary', async () => {
  const db = new FakeDatabase()
  // Two open + one completed. open/completed are clock-independent, so the test
  // is deterministic regardless of when it runs.
  db.enqueue([
    { id: 't1', contact_name: 'Marcus Webb', due_at: '2026-06-01T00:00:00Z', completed_at: null },
    { id: 't2', contact_name: 'Dana Cole', due_at: null, completed_at: null },
    { id: 't3', contact_name: 'Marcus Webb', due_at: null, completed_at: '2026-06-02T00:00:00Z' },
  ])

  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    tasks: unknown[]
    summary: { open: number; overdue: number; dueToday: number; upcoming: number; completed: number }
  }
  expect(body.tasks).toHaveLength(3)
  expect(body.summary.open).toBe(2)
  expect(body.summary.completed).toBe(1)
  // The three open buckets always reconcile to open, whatever "today" is.
  expect(body.summary.overdue + body.summary.dueToday + body.summary.upcoming).toBe(2)
  // Location scoped as $1.
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('an empty location is an honest all-zero summary', async () => {
  const db = new FakeDatabase()
  db.enqueue([])

  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    tasks: [],
    summary: { open: 0, overdue: 0, dueToday: 0, upcoming: 0, completed: 0 },
  })
})
