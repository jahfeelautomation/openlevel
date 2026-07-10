import { FakeDatabase } from '../db/fake-database'
import { CommunityPostLikesRepo } from './community-post-likes-repo'

test('listByPost scopes to the location ($1) and filters by post', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'l1', post_id: 'p1', member_id: 'm1' }])
  const repo = new CommunityPostLikesRepo(db, 'locA')

  const out = await repo.listByPost('p1')
  expect(out).toEqual([{ id: 'l1', post_id: 'p1', member_id: 'm1' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/post_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('countByPost counts real likes scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 12 }])
  const repo = new CommunityPostLikesRepo(db, 'locA')

  const n = await repo.countByPost('p1')
  expect(n).toBe(12)
  expect(db.calls[0]?.sql).toMatch(/COUNT\(\*\)::int AS n/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('countByPost returns an honest zero for an unliked post', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityPostLikesRepo(db, 'locA')

  expect(await repo.countByPost('p1')).toBe(0)
})

test('add inserts a like with location $1 and is idempotent via ON CONFLICT', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityPostLikesRepo(db, 'locA')

  await repo.add('p1', 'm1')
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO community_post_likes/i)
  expect(call?.sql).toMatch(/ON CONFLICT \(post_id, member_id\) DO NOTHING/i)
  // scopedWrite prepends the location, so params = [location_id, id, post_id, member_id]
  expect(call?.params?.[0]).toBe('locA') // location_id is $1
  expect(call?.params).toContain('p1')
  expect(call?.params).toContain('m1')
})

test('remove deletes the like scoped to location + post + member', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityPostLikesRepo(db, 'locA')

  await repo.remove('p1', 'm1')
  expect(db.calls[0]?.sql).toMatch(
    /DELETE FROM community_post_likes\s+WHERE location_id=\$1 AND post_id=\$2 AND member_id=\$3/i,
  )
  expect(db.calls[0]?.params).toEqual(['locA', 'p1', 'm1'])
})
