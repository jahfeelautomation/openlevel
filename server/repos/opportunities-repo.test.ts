import { FakeDatabase } from '../db/fake-database'
import { OpportunitiesRepo } from './opportunities-repo'

test('listByPipeline scopes to the location with pipeline as $2', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1' }])
  const repo = new OpportunitiesRepo(db, 'locA')
  await repo.listByPipeline('p1')

  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('create sets location_id explicitly ($1) and returns the row', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o_new', location_id: 'locA', name: 'Deal' }])
  const repo = new OpportunitiesRepo(db, 'locA')
  const o = await repo.create({ pipelineId: 'p1', stageId: 's1', name: 'Deal', valueCents: 25000 })

  expect(o.id).toBe('o_new')
  expect(db.calls[0]?.params[0]).toBe('locA') // $1 = location_id
  expect(db.calls[0]?.params).toContain('p1')
  expect(db.calls[0]?.params).toContain(25000)
})

test('move sets stage and scopes the update to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', stage_id: 's2' }])
  const repo = new OpportunitiesRepo(db, 'locA')
  const o = await repo.move('o1', 's2')

  expect(o?.stage_id).toBe('s2')
  expect(db.calls[0]?.params).toEqual(['locA', 's2', 'o1'])
})

test('setStatus scopes the update to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', status: 'won' }])
  const repo = new OpportunitiesRepo(db, 'locA')
  const o = await repo.setStatus('o1', 'won')

  expect(o?.status).toBe('won')
  expect(db.calls[0]?.params).toEqual(['locA', 'won', 'o1'])
})

test('update writes only the provided column, bumps updated_at, pins id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', name: 'Renamed' }])
  const repo = new OpportunitiesRepo(db, 'locA')
  await repo.update('o1', { name: 'Renamed' })

  const call = db.calls[0]
  // dynamic SET: only `name` is touched, so an unset column is absent from the
  // statement entirely (not sent as null), location is $1, id is pinned last
  expect(call?.params).toEqual(['locA', 'Renamed', 'o1'])
  expect(call?.sql).toMatch(/SET name=\$2, updated_at=now\(\)/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
})

test('update with contactId null clears the column (detach) instead of keeping it', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', contact_id: null }])
  const repo = new OpportunitiesRepo(db, 'locA')
  await repo.update('o1', { contactId: null })

  const call = db.calls[0]
  // null is a real parameter here, so the column is set to NULL — the old COALESCE
  // form silently ignored this and kept the prior contact
  expect(call?.params).toEqual(['locA', null, 'o1'])
  expect(call?.sql).toMatch(/SET contact_id=\$2/i)
})

test('update with an empty patch still issues a touch that bumps updated_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1' }])
  const repo = new OpportunitiesRepo(db, 'locA')
  await repo.update('o1', {})

  const call = db.calls[0]
  expect(call?.params).toEqual(['locA', 'o1'])
  expect(call?.sql).toMatch(/SET updated_at=now\(\) WHERE location_id=\$1 AND id=\$2/i)
})

test('get scopes the lookup to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'o1', location_id: 'locA' }])
  const repo = new OpportunitiesRepo(db, 'locA')
  const o = await repo.get('o1')

  expect(o?.id).toBe('o1')
  expect(db.calls[0]?.params).toEqual(['locA', 'o1'])
})
