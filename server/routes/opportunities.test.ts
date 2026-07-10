import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { opportunitiesRoute } from './opportunities'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', opportunitiesRoute({ db }))
  return app
}

/** Like `harness`, but captures the workflow events the route dispatches. */
function harnessWithDispatch(db: FakeDatabase, locationId = 'locA') {
  const events: unknown[] = []
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', opportunitiesRoute({ db, dispatch: (e) => void events.push(e) }))
  return { app, events }
}

function patchJson(app: Hono<AppEnv>, path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET /pipelines returns pipelines with nested stages, scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // pipelines
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 }]) // stages
  const res = await harness(db).request('/pipelines')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { pipelines: { id: string; stages: unknown[] }[] }
  expect(body.pipelines[0]?.id).toBe('p1')
  expect(body.pipelines[0]?.stages).toHaveLength(1)
  expect(db.calls.every((call) => call.params[0] === 'locA')).toBe(true)
})

test('GET / requires a pipelineId', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/')
  expect(res.status).toBe(400)
})

test('GET /?pipelineId lists opportunities for that pipeline, scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', pipeline_id: 'p1' }])
  const res = await harness(db).request('/?pipelineId=p1')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ opportunities: [{ id: 'o1', pipeline_id: 'p1' }] })
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('POST / creates an opportunity (201) with location_id set', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales' }]) // pipeline ownership get
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1' }]) // stage ownership get
  db.enqueue([{ id: 'o_new', location_id: 'locA', name: 'Deal' }]) // insert RETURNING
  const res = await harness(db).request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineId: 'p1', stageId: 's1', name: 'Deal', valueCents: 50000 }),
  })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, opportunity: { id: 'o_new' } })
  expect(db.calls[2]?.params[0]).toBe('locA') // insert scoped to location
})

test('POST / dispatches an opportunity_created event carrying the contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales' }]) // pipeline ownership get
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1' }]) // stage ownership get
  db.enqueue([{ id: 'o_new', location_id: 'locA', name: 'Deal', contact_id: 'c7' }])
  const { app, events } = harnessWithDispatch(db)

  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineId: 'p1', stageId: 's1', name: 'Deal', contactId: 'c7' }),
  })

  expect(res.status).toBe(201)
  expect(events).toEqual([
    { locationId: 'locA', triggerType: 'opportunity_created', contactId: 'c7' },
  ])
})

test('POST / rejects a stage that does not belong to the pipeline (400)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales' }]) // pipeline get
  db.enqueue([{ id: 's9', location_id: 'locA', pipeline_id: 'pOTHER' }]) // stage from another pipeline
  const res = await harness(db).request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineId: 'p1', stageId: 's9', name: 'Deal' }),
  })
  expect(res.status).toBe(400)
})

test('POST / rejects a foreign pipeline id (400, no insert)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // pipeline get -> none (foreign/unknown)
  db.enqueue([]) // stage get -> none
  const res = await harness(db).request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineId: 'pX', stageId: 'sX', name: 'Deal' }),
  })
  expect(res.status).toBe(400)
  // only the two ownership lookups ran — no INSERT was attempted
  expect(db.calls.every((call) => /SELECT/i.test(call.sql))).toBe(true)
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineId: 'p1', stageId: 's1', name: '' }),
  })
  expect(res.status).toBe(400)
})

test('PATCH /:id with stageId moves the card', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', pipeline_id: 'p1', stage_id: 's1' }]) // existing opp get
  db.enqueue([{ id: 's2', location_id: 'locA', pipeline_id: 'p1' }]) // target stage get (same pipeline)
  db.enqueue([{ id: 'o1', stage_id: 's2' }]) // move RETURNING
  const res = await patchJson(harness(db), '/o1', { stageId: 's2' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, opportunity: { stage_id: 's2' } })
  expect(db.calls[2]?.params).toEqual(['locA', 's2', 'o1']) // move scoped to location + id
})

test('PATCH /:id rejects moving a card into another pipeline stage (400)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', pipeline_id: 'p1', stage_id: 's1' }]) // existing opp in pipeline p1
  db.enqueue([{ id: 's9', location_id: 'locA', pipeline_id: 'pOTHER' }]) // stage from another pipeline
  const res = await patchJson(harness(db), '/o1', { stageId: 's9' })
  expect(res.status).toBe(400)
})

test('PATCH /:id with status sets won/lost', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', status: 'won' }])
  const res = await patchJson(harness(db), '/o1', { status: 'won' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, opportunity: { status: 'won' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'won', 'o1'])
})

test('PATCH /:id is 404 when the opportunity is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // existing opp get -> none (not in this location)
  const res = await patchJson(harness(db), '/missing', { stageId: 's2' })
  expect(res.status).toBe(404)
})

test('PATCH /:id rejects an invalid status (400)', async () => {
  const db = new FakeDatabase()
  const res = await patchJson(harness(db), '/o1', { status: 'banana' })
  expect(res.status).toBe(400)
})
