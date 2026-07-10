import { FakeDatabase } from '../db/fake-database'
import { PipelinesRepo } from './pipelines-repo'

test('listWithStages scopes both queries to the location and nests stages', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // pipelines
  db.enqueue([
    { id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 },
    { id: 's2', location_id: 'locA', pipeline_id: 'p1', name: 'Won', position: 1 },
  ]) // stages
  const repo = new PipelinesRepo(db, 'locA')
  const result = await repo.listWithStages()

  expect(result).toHaveLength(1)
  expect(result[0]?.stages.map((s) => s.id)).toEqual(['s1', 's2'])
  expect(db.calls[0]?.params[0]).toBe('locA') // pipelines query scoped
  expect(db.calls[1]?.params[0]).toBe('locA') // stages query scoped
})

test('listWithStages only nests stages belonging to each pipeline', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { id: 'p1', location_id: 'locA', name: 'A', position: 0 },
    { id: 'p2', location_id: 'locA', name: 'B', position: 1 },
  ])
  db.enqueue([
    { id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 },
    { id: 's2', location_id: 'locA', pipeline_id: 'p2', name: 'New', position: 0 },
  ])
  const repo = new PipelinesRepo(db, 'locA')
  const result = await repo.listWithStages()

  expect(result[0]?.stages.map((s) => s.id)).toEqual(['s1'])
  expect(result[1]?.stages.map((s) => s.id)).toEqual(['s2'])
})

test('get scopes the lookup to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales' }])
  const repo = new PipelinesRepo(db, 'locA')
  const p = await repo.get('p1')

  expect(p?.id).toBe('p1')
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

// --- management: pipelines -------------------------------------------------

test('createPipeline scopes the insert, positions via MAX subquery, and seeds a default stage', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 2 }]) // pipeline insert
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New Stage', position: 0 }]) // default stage
  const repo = new PipelinesRepo(db, 'locA')
  const result = await repo.createPipeline('Sales')

  expect(result.id).toBe('p1')
  expect(result.stages.map((s) => s.name)).toEqual(['New Stage'])
  expect(db.calls[0]?.sql).toMatch(/INSERT INTO pipelines/i)
  expect(db.calls[0]?.sql).toMatch(/MAX\(position\)\s*\+\s*1/i)
  expect(db.calls[0]?.params[0]).toBe('locA') // location scoped
  // default stage insert is scoped and tied to the just-created pipeline id
  // (the local nanoid used for the pipeline insert, not the fake's echoed row)
  expect(db.calls[1]?.sql).toMatch(/INSERT INTO pipeline_stages/i)
  expect(db.calls[1]?.params[0]).toBe('locA')
  expect(db.calls[1]?.params[2]).toBe(db.calls[0]?.params[1]) // stage.pipeline_id === pipeline.id
})

test('renamePipeline scopes the update to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Renamed', position: 0 }])
  const repo = new PipelinesRepo(db, 'locA')
  const p = await repo.renamePipeline('p1', 'Renamed')

  expect(p?.name).toBe('Renamed')
  expect(db.calls[0]?.sql).toMatch(/UPDATE pipelines SET name/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'Renamed', 'p1'])
})

test('removePipeline reports not_found for an unknown id', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const repo = new PipelinesRepo(db, 'locA')
  const r = await repo.removePipeline('nope')

  expect(r).toEqual({ ok: false, reason: 'not_found' })
})

test('removePipeline refuses to delete the only pipeline', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // get
  db.enqueue([{ id: 'p1' }]) // listAll -> only one
  const repo = new PipelinesRepo(db, 'locA')
  const r = await repo.removePipeline('p1')

  expect(r).toEqual({ ok: false, reason: 'last_pipeline' })
  expect(db.calls.some((c) => /DELETE FROM pipelines/i.test(c.sql))).toBe(false)
})

test('removePipeline refuses when the pipeline still holds opportunities', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // get
  db.enqueue([{ id: 'p1' }, { id: 'p2' }]) // listAll -> not last
  db.enqueue([{ id: 'o1' }]) // an opportunity exists
  const repo = new PipelinesRepo(db, 'locA')
  const r = await repo.removePipeline('p1')

  expect(r).toEqual({ ok: false, reason: 'has_opportunities' })
  expect(db.calls.some((c) => /DELETE FROM pipelines/i.test(c.sql))).toBe(false)
})

test('removePipeline deletes when it is safe, scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // get
  db.enqueue([{ id: 'p1' }, { id: 'p2' }]) // listAll
  db.enqueue([]) // no opportunities
  db.enqueue([]) // delete
  const repo = new PipelinesRepo(db, 'locA')
  const r = await repo.removePipeline('p1')

  expect(r).toEqual({ ok: true })
  const del = db.calls.find((c) => /DELETE FROM pipelines/i.test(c.sql))
  expect(del?.params).toEqual(['locA', 'p1'])
})

// --- management: stages ----------------------------------------------------

test('addStage scopes the insert and positions after existing stages', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's3', location_id: 'locA', pipeline_id: 'p1', name: 'Won', position: 2 }])
  const repo = new PipelinesRepo(db, 'locA')
  const s = await repo.addStage('p1', 'Won')

  expect(s.name).toBe('Won')
  expect(db.calls[0]?.sql).toMatch(/INSERT INTO pipeline_stages/i)
  expect(db.calls[0]?.sql).toMatch(/MAX\(position\)\s*\+\s*1/i)
  expect(db.calls[0]?.params[0]).toBe('locA')
  expect(db.calls[0]?.params[2]).toBe('p1') // pipeline_id param
})

test('renameStage scopes the update to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'Renamed', position: 0 }])
  const repo = new PipelinesRepo(db, 'locA')
  const s = await repo.renameStage('s1', 'Renamed')

  expect(s?.name).toBe('Renamed')
  expect(db.calls[0]?.sql).toMatch(/UPDATE pipeline_stages SET name/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'Renamed', 's1'])
})

test('reorderStages writes each position by index, scoped and pipeline-bound', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // update s_b -> pos 0
  db.enqueue([]) // update s_a -> pos 1
  db.enqueue([
    { id: 's_b', location_id: 'locA', pipeline_id: 'p1', name: 'B', position: 0 },
    { id: 's_a', location_id: 'locA', pipeline_id: 'p1', name: 'A', position: 1 },
  ]) // listStages after
  const repo = new PipelinesRepo(db, 'locA')
  const result = await repo.reorderStages('p1', ['s_b', 's_a'])

  expect(result.map((s) => s.id)).toEqual(['s_b', 's_a'])
  expect(db.calls[0]?.sql).toMatch(/UPDATE pipeline_stages SET position/i)
  expect(db.calls[0]?.params).toEqual(['locA', 0, 's_b', 'p1'])
  expect(db.calls[1]?.params).toEqual(['locA', 1, 's_a', 'p1'])
})

test('removeStage reports not_found for an unknown id', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // getStage -> none
  const repo = new PipelinesRepo(db, 'locA')
  const r = await repo.removeStage('nope')

  expect(r).toEqual({ ok: false, reason: 'not_found' })
})

test('removeStage refuses to delete the last stage in a pipeline', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'Only', position: 0 }]) // getStage
  db.enqueue([{ id: 's1' }]) // siblings -> only one
  const repo = new PipelinesRepo(db, 'locA')
  const r = await repo.removeStage('s1')

  expect(r).toEqual({ ok: false, reason: 'last_stage' })
  expect(db.calls.some((c) => /DELETE FROM pipeline_stages/i.test(c.sql))).toBe(false)
})

test('removeStage refuses when the stage still holds opportunities', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 }]) // getStage
  db.enqueue([{ id: 's1' }, { id: 's2' }]) // siblings
  db.enqueue([{ id: 'o1' }]) // an opportunity sits in this stage
  const repo = new PipelinesRepo(db, 'locA')
  const r = await repo.removeStage('s1')

  expect(r).toEqual({ ok: false, reason: 'has_opportunities' })
  expect(db.calls.some((c) => /DELETE FROM pipeline_stages/i.test(c.sql))).toBe(false)
})

test('removeStage deletes a safe stage, scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 }]) // getStage
  db.enqueue([{ id: 's1' }, { id: 's2' }]) // siblings
  db.enqueue([]) // no opportunities
  db.enqueue([]) // delete
  const repo = new PipelinesRepo(db, 'locA')
  const r = await repo.removeStage('s1')

  expect(r).toEqual({ ok: true })
  const del = db.calls.find((c) => /DELETE FROM pipeline_stages/i.test(c.sql))
  expect(del?.params).toEqual(['locA', 's1'])
})
