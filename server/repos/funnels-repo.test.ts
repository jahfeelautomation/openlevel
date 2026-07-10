import { FakeDatabase } from '../db/fake-database'
import { FunnelsRepo } from './funnels-repo'

test('list scopes the read to the location ($1)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', location_id: 'locA' }])
  const repo = new FunnelsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'fn1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single funnel scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1' }])
  const repo = new FunnelsRepo(db, 'locA')

  await repo.get('fn1')
  expect(db.calls[0]?.params).toEqual(['locA', 'fn1'])
})

test('getBySlug looks a funnel up by location + slug (public capture path)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', slug: 'sell-fast' }])
  const repo = new FunnelsRepo(db, 'locA')

  const out = await repo.getBySlug('sell-fast')
  expect(out).toEqual({ id: 'fn1', slug: 'sell-fast' })
  expect(db.calls[0]?.sql).toMatch(/slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'sell-fast'])
})

test('create sets location $1 and defaults status to draft', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn_new', location_id: 'locA', status: 'draft' }])
  const repo = new FunnelsRepo(db, 'locA')

  await repo.create({ name: 'Sell your house fast', slug: 'sell-fast' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('Sell your house fast')
  expect(params).toContain('sell-fast')
  expect(params).toContain('draft')
})

test('create honors an explicit status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn_new' }])
  const repo = new FunnelsRepo(db, 'locA')

  await repo.create({ name: 'Live one', slug: 'live-one', status: 'published' })
  expect(db.calls[0]?.params).toContain('published')
})

test('setStatus flips publish state scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', status: 'published' }])
  const repo = new FunnelsRepo(db, 'locA')

  const out = await repo.setStatus('fn1', 'published')
  expect(out).toEqual({ id: 'fn1', status: 'published' })
  expect(db.calls[0]?.sql).toMatch(/UPDATE funnels SET status=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'published', 'fn1'])
})

test('update builds a dynamic SET of only provided columns, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', name: 'Renamed' }])
  const repo = new FunnelsRepo(db, 'locA')

  await repo.update('fn1', { name: 'Renamed', slug: 'renamed' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE funnels SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params?.[call.params.length - 1]).toBe('fn1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new FunnelsRepo(db, 'locA')

  const out = await repo.update('fn1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})
