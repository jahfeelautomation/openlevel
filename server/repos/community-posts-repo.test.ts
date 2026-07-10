import { FakeDatabase } from '../db/fake-database'
import { CommunityPostsRepo } from './community-posts-repo'

test('listByChannel scopes to location ($1) and orders pinned-first then newest', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', channel_id: 'ch1', pinned: true }])
  const repo = new CommunityPostsRepo(db, 'locA')

  const out = await repo.listByChannel('ch1')
  expect(out).toEqual([{ id: 'p1', channel_id: 'ch1', pinned: true }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/channel_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY pinned DESC, created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'ch1'])
})

test('listByCommunity scopes to location and orders pinned-first then newest', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', community_id: 'cm1' }])
  const repo = new CommunityPostsRepo(db, 'locA')

  await repo.listByCommunity('cm1')
  expect(db.calls[0]?.sql).toMatch(/community_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY pinned DESC, created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1'])
})

test('get reads a single post scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1' }])
  const repo = new CommunityPostsRepo(db, 'locA')

  await repo.get('p1')
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('countByCommunity counts posts for the community scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 42 }])
  const repo = new CommunityPostsRepo(db, 'locA')

  const n = await repo.countByCommunity('cm1')
  expect(n).toBe(42)
  expect(db.calls[0]?.sql).toMatch(/COUNT\(\*\)::int AS n/i)
  expect(db.calls[0]?.sql).toMatch(/community_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1'])
})

test('countByChannel counts posts for one channel scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 9 }])
  const repo = new CommunityPostsRepo(db, 'locA')

  const n = await repo.countByChannel('ch1')
  expect(n).toBe(9)
  expect(db.calls[0]?.sql).toMatch(/channel_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'ch1'])
})

test('count helpers return an honest zero when empty', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  db.enqueue([])
  const repo = new CommunityPostsRepo(db, 'locA')

  expect(await repo.countByCommunity('cm1')).toBe(0)
  expect(await repo.countByChannel('ch1')).toBe(0)
})

test('create sets location $1, community $3, channel $4, defaults member/title null + unpinned', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p_new', pinned: false }])
  const repo = new CommunityPostsRepo(db, 'locA')

  await repo.create({ communityId: 'cm1', channelId: 'ch1', body: 'Welcome to the group!' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('cm1')
  expect(params).toContain('ch1')
  expect(params).toContain('Welcome to the group!')
  expect(params).toContain(null) // member_id + title default null
  expect(params).toContain(false) // pinned defaults false
})

test('create honors an explicit member, title and pinned', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p_new' }])
  const repo = new CommunityPostsRepo(db, 'locA')

  await repo.create({
    communityId: 'cm1',
    channelId: 'ch1',
    memberId: 'm1',
    title: 'Pinned rules',
    body: 'Read me',
    pinned: true,
  })
  const params = db.calls[0]?.params
  expect(params).toContain('m1')
  expect(params).toContain('Pinned rules')
  expect(params).toContain(true)
})

test('update builds a dynamic SET of only provided columns, refreshes updated_at, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1' }])
  const repo = new CommunityPostsRepo(db, 'locA')

  await repo.update('p1', { body: 'Edited body' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE community_posts SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('Edited body')
  expect(call?.params?.[call.params.length - 1]).toBe('p1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new CommunityPostsRepo(db, 'locA')

  const out = await repo.update('p1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('setPinned flips the pinned flag scoped to location + id and refreshes updated_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', pinned: true }])
  const repo = new CommunityPostsRepo(db, 'locA')

  await repo.setPinned('p1', true)
  expect(db.calls[0]?.sql).toMatch(/SET pinned=\$2, updated_at=now\(\)/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', true, 'p1'])
})

test('remove deletes the post scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityPostsRepo(db, 'locA')

  await repo.remove('p1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM community_posts WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})
