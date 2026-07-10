import { FakeDatabase } from '../db/fake-database'
import { FormsRepo } from './forms-repo'

test('list scopes the read to the location ($1)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', location_id: 'locA' }])
  const repo = new FormsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'fm1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single form scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1' }])
  const repo = new FormsRepo(db, 'locA')

  await repo.get('fm1')
  expect(db.calls[0]?.params).toEqual(['locA', 'fm1'])
})

test('getBySlug looks a form up by location + slug (public capture path)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', slug: 'cash-offer' }])
  const repo = new FormsRepo(db, 'locA')

  const out = await repo.getBySlug('cash-offer')
  expect(out).toEqual({ id: 'fm1', slug: 'cash-offer' })
  expect(db.calls[0]?.sql).toMatch(/slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cash-offer'])
})

test('create sets location $1, defaults status to draft, json-encodes content', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm_new', location_id: 'locA', status: 'draft' }])
  const repo = new FormsRepo(db, 'locA')

  await repo.create({ name: 'Cash offer', slug: 'cash-offer', content: { headline: 'Get an offer' } })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('Cash offer')
  expect(params).toContain('cash-offer')
  expect(params).toContain('draft')
  expect(params).toContain(JSON.stringify({ headline: 'Get an offer' }))
})

test('create honors an explicit status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm_new' }])
  const repo = new FormsRepo(db, 'locA')

  await repo.create({ name: 'Live one', slug: 'live-one', status: 'published' })
  expect(db.calls[0]?.params).toContain('published')
})

test('setStatus flips publish state scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', status: 'published' }])
  const repo = new FormsRepo(db, 'locA')

  const out = await repo.setStatus('fm1', 'published')
  expect(out).toEqual({ id: 'fm1', status: 'published' })
  expect(db.calls[0]?.sql).toMatch(/UPDATE forms SET status=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'published', 'fm1'])
})

test('update builds a dynamic SET of only provided columns, id last, content encoded', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', name: 'Renamed' }])
  const repo = new FormsRepo(db, 'locA')

  await repo.update('fm1', { name: 'Renamed', content: { headline: 'New' } })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE forms SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain(JSON.stringify({ headline: 'New' }))
  expect(call?.params?.[call.params.length - 1]).toBe('fm1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new FormsRepo(db, 'locA')

  const out = await repo.update('fm1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('incrementSubmissions bumps the honest counter scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fm1', submissions: 1 }])
  const repo = new FormsRepo(db, 'locA')

  await repo.incrementSubmissions('fm1')
  expect(db.calls[0]?.sql).toMatch(/submissions = submissions \+ 1/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'fm1'])
})
