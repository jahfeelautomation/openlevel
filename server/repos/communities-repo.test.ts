import { FakeDatabase } from '../db/fake-database'
import { CommunitiesRepo } from './communities-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cm1', location_id: 'locA' }])
  const repo = new CommunitiesRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'cm1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single community scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cm1' }])
  const repo = new CommunitiesRepo(db, 'locA')

  await repo.get('cm1')
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1'])
})

test('getBySlug resolves the public slug scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cm1', slug: 'inner-circle' }])
  const repo = new CommunitiesRepo(db, 'locA')

  await repo.getBySlug('inner-circle')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'inner-circle'])
})

test('create sets location $1, defaults description null and status draft', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cm_new', location_id: 'locA', status: 'draft' }])
  const repo = new CommunitiesRepo(db, 'locA')

  await repo.create({ name: 'Inner Circle', slug: 'inner-circle' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('Inner Circle')
  expect(params).toContain('inner-circle')
  expect(params).toContain(null) // description default null
  expect(params).toContain('draft') // status default draft
})

test('create honors an explicit description and status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cm_new' }])
  const repo = new CommunitiesRepo(db, 'locA')

  await repo.create({
    name: 'VIP',
    slug: 'vip',
    description: 'Members-only space',
    status: 'published',
  })
  const params = db.calls[0]?.params
  expect(params).toContain('Members-only space')
  expect(params).toContain('published')
})

test('update builds a dynamic SET of only provided columns, refreshes updated_at, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cm1' }])
  const repo = new CommunitiesRepo(db, 'locA')

  await repo.update('cm1', { name: 'Renamed', status: 'published' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE communities SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('Renamed')
  expect(call?.params).toContain('published')
  expect(call?.params?.[call.params.length - 1]).toBe('cm1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new CommunitiesRepo(db, 'locA')

  const out = await repo.update('cm1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('remove deletes the community scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunitiesRepo(db, 'locA')

  await repo.remove('cm1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM communities WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1'])
})
