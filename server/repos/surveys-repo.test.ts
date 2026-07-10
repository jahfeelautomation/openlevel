import { FakeDatabase } from '../db/fake-database'
import { SurveysRepo } from './surveys-repo'

test('list scopes the read to the location ($1)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', location_id: 'locA' }])
  const repo = new SurveysRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'sv1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single survey scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1' }])
  const repo = new SurveysRepo(db, 'locA')

  await repo.get('sv1')
  expect(db.calls[0]?.params).toEqual(['locA', 'sv1'])
})

test('getBySlug looks a survey up by location + slug (public capture path)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', slug: 'seller-intake' }])
  const repo = new SurveysRepo(db, 'locA')

  const out = await repo.getBySlug('seller-intake')
  expect(out).toEqual({ id: 'sv1', slug: 'seller-intake' })
  expect(db.calls[0]?.sql).toMatch(/slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'seller-intake'])
})

test('create sets location $1, defaults status to draft, json-encodes content', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv_new', location_id: 'locA', status: 'draft' }])
  const repo = new SurveysRepo(db, 'locA')

  await repo.create({
    name: 'Seller intake',
    slug: 'seller-intake',
    content: { steps: [{ id: 's1', title: 'About you', fields: [] }] },
  })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('Seller intake')
  expect(params).toContain('seller-intake')
  expect(params).toContain('draft')
  expect(params).toContain(JSON.stringify({ steps: [{ id: 's1', title: 'About you', fields: [] }] }))
})

test('create honors an explicit status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv_new' }])
  const repo = new SurveysRepo(db, 'locA')

  await repo.create({ name: 'Live one', slug: 'live-one', status: 'published' })
  expect(db.calls[0]?.params).toContain('published')
})

test('setStatus flips publish state scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', status: 'published' }])
  const repo = new SurveysRepo(db, 'locA')

  const out = await repo.setStatus('sv1', 'published')
  expect(out).toEqual({ id: 'sv1', status: 'published' })
  expect(db.calls[0]?.sql).toMatch(/UPDATE surveys SET status=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'published', 'sv1'])
})

test('update builds a dynamic SET of only provided columns, id last, content encoded', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', name: 'Renamed' }])
  const repo = new SurveysRepo(db, 'locA')

  await repo.update('sv1', { name: 'Renamed', content: { steps: [] } })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE surveys SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain(JSON.stringify({ steps: [] }))
  expect(call?.params?.[call.params.length - 1]).toBe('sv1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new SurveysRepo(db, 'locA')

  const out = await repo.update('sv1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('incrementSubmissions bumps the honest counter scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', submissions: 1 }])
  const repo = new SurveysRepo(db, 'locA')

  await repo.incrementSubmissions('sv1')
  expect(db.calls[0]?.sql).toMatch(/submissions = submissions \+ 1/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'sv1'])
})
