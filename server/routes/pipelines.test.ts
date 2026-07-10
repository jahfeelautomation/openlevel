import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { pipelinesRoute } from './pipelines'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', pipelinesRoute({ db }))
  return app
}

function sendJson(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists pipelines (with nested stages) scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // pipelines
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 }]) // stages
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { pipelines: { id: string; stages: { id: string }[] }[] }
  expect(body.pipelines[0]?.id).toBe('p1')
  expect(body.pipelines[0]?.stages.map((s) => s.id)).toEqual(['s1'])
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a pipeline with a default stage (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p_new', location_id: 'locA', name: 'Onboarding', position: 1 }]) // pipeline insert
  db.enqueue([{ id: 's_new', location_id: 'locA', pipeline_id: 'p_new', name: 'New Stage', position: 0 }]) // default stage
  const res = await sendJson(harness(db), '/', 'POST', { name: 'Onboarding' })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({
    ok: true,
    pipeline: { id: 'p_new', name: 'Onboarding', stages: [{ id: 's_new', name: 'New Stage' }] },
  })
})

test('POST / rejects an empty name (400, no query)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), '/', 'POST', { name: '   ' })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /:id renames a pipeline (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Renamed', position: 0 }]) // update RETURNING
  const res = await sendJson(harness(db), '/p1', 'PATCH', { name: 'Renamed' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, pipeline: { id: 'p1', name: 'Renamed' } })
  expect(db.calls[0]?.sql).toMatch(/UPDATE pipelines SET name/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'Renamed', 'p1'])
})

test('PATCH /:id is 404 when the pipeline is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // update RETURNING -> none
  const res = await sendJson(harness(db), '/missing', 'PATCH', { name: 'X' })
  expect(res.status).toBe(404)
})

test('DELETE /:id removes a safe pipeline (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // get
  db.enqueue([{ id: 'p1' }, { id: 'p2' }]) // listAll
  db.enqueue([]) // no opportunities
  db.enqueue([]) // delete
  const res = await harness(db).request('/p1', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(db.calls.find((c) => /DELETE FROM pipelines/i.test(c.sql))?.params).toEqual(['locA', 'p1'])
})

test('DELETE /:id refuses the only pipeline (409)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // get
  db.enqueue([{ id: 'p1' }]) // listAll -> only one
  const res = await harness(db).request('/p1', { method: 'DELETE' })

  expect(res.status).toBe(409)
  expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('at least one pipeline') })
})

test('DELETE /:id refuses a pipeline that still holds opportunities (409)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // get
  db.enqueue([{ id: 'p1' }, { id: 'p2' }]) // listAll
  db.enqueue([{ id: 'o1' }]) // an opportunity exists
  const res = await harness(db).request('/p1', { method: 'DELETE' })

  expect(res.status).toBe(409)
  expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('Move or close') })
})

test('DELETE /:id is 404 for an unknown pipeline', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})

test('POST /:id/stages adds a stage to the pipeline (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // pipeline existence
  db.enqueue([{ id: 's_new', location_id: 'locA', pipeline_id: 'p1', name: 'Won', position: 3 }]) // addStage
  const res = await sendJson(harness(db), '/p1/stages', 'POST', { name: 'Won' })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, stage: { id: 's_new', name: 'Won' } })
  expect(db.calls[1]?.sql).toMatch(/INSERT INTO pipeline_stages/i)
})

test('POST /:id/stages is 404 when the pipeline is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // pipeline existence -> none
  const res = await sendJson(harness(db), '/missing/stages', 'POST', { name: 'Won' })
  expect(res.status).toBe(404)
})

test('POST /:id/stages-reorder persists a new order (200) — distinct from /:id/stages', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // pipeline existence
  db.enqueue([]) // update s_b -> 0
  db.enqueue([]) // update s_a -> 1
  db.enqueue([
    { id: 's_b', location_id: 'locA', pipeline_id: 'p1', name: 'B', position: 0 },
    { id: 's_a', location_id: 'locA', pipeline_id: 'p1', name: 'A', position: 1 },
  ]) // listStages
  const res = await sendJson(harness(db), '/p1/stages-reorder', 'POST', { orderedIds: ['s_b', 's_a'] })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; stages: { id: string }[] }
  expect(body.stages.map((s) => s.id)).toEqual(['s_b', 's_a'])
  expect(db.calls[1]?.sql).toMatch(/UPDATE pipeline_stages SET position/i)
})

test('PATCH /stages/:stageId renames a stage (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'Renamed', position: 0 }]) // update RETURNING
  const res = await sendJson(harness(db), '/stages/s1', 'PATCH', { name: 'Renamed' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, stage: { id: 's1', name: 'Renamed' } })
  expect(db.calls[0]?.sql).toMatch(/UPDATE pipeline_stages SET name/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'Renamed', 's1'])
})

test('PATCH /stages/:stageId is 404 when the stage is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // update RETURNING -> none
  const res = await sendJson(harness(db), '/stages/missing', 'PATCH', { name: 'X' })
  expect(res.status).toBe(404)
})

test('DELETE /stages/:stageId removes a safe stage (200) — resolves to the stage handler, not /:id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 }]) // getStage
  db.enqueue([{ id: 's1' }, { id: 's2' }]) // siblings
  db.enqueue([]) // no opportunities
  db.enqueue([]) // delete
  const res = await harness(db).request('/stages/s1', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  // proves routing hit removeStage (pipeline_stages), never removePipeline (pipelines)
  expect(db.calls.find((c) => /DELETE FROM pipeline_stages/i.test(c.sql))?.params).toEqual(['locA', 's1'])
  expect(db.calls.some((c) => /DELETE FROM pipelines\b/i.test(c.sql))).toBe(false)
})

test('DELETE /stages/:stageId refuses the last stage in a pipeline (409)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'Only', position: 0 }]) // getStage
  db.enqueue([{ id: 's1' }]) // siblings -> only one
  const res = await harness(db).request('/stages/s1', { method: 'DELETE' })

  expect(res.status).toBe(409)
  expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('at least one stage') })
})

test('DELETE /stages/:stageId refuses a stage that still holds opportunities (409)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 }]) // getStage
  db.enqueue([{ id: 's1' }, { id: 's2' }]) // siblings
  db.enqueue([{ id: 'o1' }]) // an opportunity sits here
  const res = await harness(db).request('/stages/s1', { method: 'DELETE' })

  expect(res.status).toBe(409)
  expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('Move or close') })
})
