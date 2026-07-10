import { FakeDatabase } from '../db/fake-database'
import { WorkflowsRepo } from './workflows-repo'

test('list scopes the read to the location ($1)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1', location_id: 'locA' }])
  const repo = new WorkflowsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'wf1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single workflow scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1' }])
  const repo = new WorkflowsRepo(db, 'locA')

  await repo.get('wf1')
  expect(db.calls[0]?.params).toEqual(['locA', 'wf1'])
})

test('create sets location $1, defaults status draft, json-encodes trigger_config', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf_new', location_id: 'locA', status: 'draft' }])
  const repo = new WorkflowsRepo(db, 'locA')

  await repo.create({ name: 'New lead welcome', triggerType: 'contact_created' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('New lead welcome')
  expect(params).toContain('contact_created')
  expect(params).toContain('{}') // trigger_config defaults to an encoded empty object
})

test('create encodes a provided trigger_config object as json', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf_new' }])
  const repo = new WorkflowsRepo(db, 'locA')

  await repo.create({
    name: 'Tagged only',
    triggerType: 'inbound_message',
    triggerConfig: { tag: 'seller' },
  })
  expect(db.calls[0]?.params).toContain(JSON.stringify({ tag: 'seller' }))
})

test('update builds a dynamic SET of only provided columns, scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1', status: 'live' }])
  const repo = new WorkflowsRepo(db, 'locA')

  const out = await repo.update('wf1', { status: 'live' })
  expect(out).toEqual({ id: 'wf1', status: 'live' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE workflows SET/i)
  expect(call?.sql).toMatch(/status=\$2/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(call?.params).toEqual(['locA', 'live', 'wf1'])
})

test('update json-encodes trigger_config and orders params by SET then id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1' }])
  const repo = new WorkflowsRepo(db, 'locA')

  await repo.update('wf1', { name: 'Renamed', triggerConfig: { tag: 'lead' } })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA')
  expect(params).toContain('Renamed')
  expect(params).toContain(JSON.stringify({ tag: 'lead' }))
  expect(params?.[params.length - 1]).toBe('wf1') // id is the last param
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new WorkflowsRepo(db, 'locA')

  const out = await repo.update('wf1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('listLiveByTrigger filters to live workflows for one trigger, scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1', status: 'live', trigger_type: 'contact_created' }])
  const repo = new WorkflowsRepo(db, 'locA')

  const out = await repo.listLiveByTrigger('contact_created')
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/status\s*=\s*'live'/i) // only live ones fire
  expect(db.calls[0]?.sql).toMatch(/trigger_type\s*=\s*\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'contact_created'])
})
