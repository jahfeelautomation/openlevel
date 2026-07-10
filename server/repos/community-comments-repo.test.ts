import { FakeDatabase } from '../db/fake-database'
import { CommunityCommentsRepo } from './community-comments-repo'

test('listByPost scopes to location ($1) and orders oldest-first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', post_id: 'p1' }])
  const repo = new CommunityCommentsRepo(db, 'locA')

  const out = await repo.listByPost('p1')
  expect(out).toEqual([{ id: 'c1', post_id: 'p1' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/post_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('countByPost counts real comments scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 5 }])
  const repo = new CommunityCommentsRepo(db, 'locA')

  const n = await repo.countByPost('p1')
  expect(n).toBe(5)
  expect(db.calls[0]?.sql).toMatch(/COUNT\(\*\)::int AS n/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('countByPost returns an honest zero for an unconversed post', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityCommentsRepo(db, 'locA')

  expect(await repo.countByPost('p1')).toBe(0)
})

test('create sets location $1, post $3, defaults member null', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c_new', post_id: 'p1' }])
  const repo = new CommunityCommentsRepo(db, 'locA')

  await repo.create({ postId: 'p1', body: 'Congrats!' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('p1')
  expect(params).toContain('Congrats!')
  expect(params).toContain(null) // member_id defaults null
})

test('create honors an explicit member', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c_new' }])
  const repo = new CommunityCommentsRepo(db, 'locA')

  await repo.create({ postId: 'p1', memberId: 'm1', body: 'Thanks' })
  expect(db.calls[0]?.params).toContain('m1')
})

test('remove deletes the comment scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityCommentsRepo(db, 'locA')

  await repo.remove('c1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM community_comments WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})
