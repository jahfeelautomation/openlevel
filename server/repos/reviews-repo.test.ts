import { FakeDatabase } from '../db/fake-database'
import { ReviewsRepo } from './reviews-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv1', location_id: 'locA' }])
  const repo = new ReviewsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'rv1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single review scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv1' }])
  const repo = new ReviewsRepo(db, 'locA')

  await repo.get('rv1')
  expect(db.calls[0]?.params).toEqual(['locA', 'rv1'])
})

test('create sets location $1, links request + contact, keeps the rating', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv_new', location_id: 'locA', status: 'published' }])
  const repo = new ReviewsRepo(db, 'locA')

  await repo.create({
    contactId: 'c1',
    requestId: 'rq1',
    rating: 5,
    body: 'Fast and fair.',
    reviewerName: 'Sam Smith',
  })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('c1')
  expect(params).toContain('rq1')
  expect(params).toContain(5)
  expect(params).toContain('Fast and fair.')
  expect(params).toContain('Sam Smith')
  expect(params).toContain('direct') // default source
  expect(params).toContain('published') // default status
})

test('create tolerates an unlinked, body-less review (direct / imported)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv_new' }])
  const repo = new ReviewsRepo(db, 'locA')

  await repo.create({ rating: 4 })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA')
  expect(params).toContain(4)
  expect(params).toContain(null) // contact/request/body/name default to null
})

test('upsertExternal inserts scoped to the location, deduping on (location_id, source, external_id)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv_new', location_id: 'locA', source: 'google', external_id: 'gr_1', inserted: true }])
  const repo = new ReviewsRepo(db, 'locA')

  const out = await repo.upsertExternal({
    source: 'google',
    externalId: 'gr_1',
    rating: 5,
    body: 'Fast closing, fair price.',
    reviewerName: 'Sam Smith',
    createdAt: '2026-05-30T18:04:00Z',
  })

  expect(out.inserted).toBe(true)
  expect(out.review.id).toBe('rv_new')
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO reviews/i)
  expect(call?.sql).toMatch(/ON CONFLICT \(location_id, source, external_id\)/i)
  // a re-sync refreshes what the platform reported...
  expect(call?.sql).toMatch(/DO UPDATE SET rating=EXCLUDED\.rating/i)
  // ...but never the moderation status — a hidden import stays hidden.
  expect(call?.sql).not.toMatch(/status\s*=\s*EXCLUDED/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('gr_1')
  expect(call?.params).toContain('google')
  expect(call?.params).toContain(5)
  expect(call?.params).toContain('2026-05-30T18:04:00Z') // the platform's own timestamp
})

test('upsertExternal reports an update (not an insert) when the row already existed', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv_old', location_id: 'locA', inserted: false }])
  const repo = new ReviewsRepo(db, 'locA')

  const out = await repo.upsertExternal({ source: 'facebook', externalId: 'og_551', rating: 4 })
  expect(out.inserted).toBe(false)
  expect(out.review.id).toBe('rv_old')
  expect(db.calls[0]?.params).toContain(null) // body/name/createdAt default to null
})

test('setStatus hides or restores a review scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rv1', status: 'hidden' }])
  const repo = new ReviewsRepo(db, 'locA')

  await repo.setStatus('rv1', 'hidden')
  expect(db.calls[0]?.sql).toMatch(/UPDATE reviews SET status=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'hidden', 'rv1'])
})

