import { FakeDatabase } from '../db/fake-database'
import { CommunityMembersRepo } from './community-members-repo'

test('listByCommunity scopes to the location ($1) and orders newest-joined first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'm1', community_id: 'cm1' }])
  const repo = new CommunityMembersRepo(db, 'locA')

  const out = await repo.listByCommunity('cm1')
  expect(out).toEqual([{ id: 'm1', community_id: 'cm1' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/community_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY joined_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1'])
})

test('get reads a single member scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'm1' }])
  const repo = new CommunityMembersRepo(db, 'locA')

  await repo.get('m1')
  expect(db.calls[0]?.params).toEqual(['locA', 'm1'])
})

test('countByCommunity counts real members scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 128 }])
  const repo = new CommunityMembersRepo(db, 'locA')

  const n = await repo.countByCommunity('cm1')
  expect(n).toBe(128)
  expect(db.calls[0]?.sql).toMatch(/COUNT\(\*\)::int AS n/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1'])
})

test('countByCommunity returns an honest zero for an empty community', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityMembersRepo(db, 'locA')

  expect(await repo.countByCommunity('cm1')).toBe(0)
})

test('create sets location $1, community $3, defaults role to member and nulls', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'm_new', community_id: 'cm1', role: 'member' }])
  const repo = new CommunityMembersRepo(db, 'locA')

  await repo.create({ communityId: 'cm1', name: 'Alex Mercer' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('cm1')
  expect(params).toContain('Alex Mercer')
  expect(params).toContain('member') // default role
  expect(params).toContain(null) // contact_id + email default null
})

test('create honors an explicit contactId, email and role', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'm_new' }])
  const repo = new CommunityMembersRepo(db, 'locA')

  await repo.create({
    communityId: 'cm1',
    name: 'Dana',
    email: 'dana@example.com',
    contactId: 'c1',
    role: 'moderator',
  })
  const params = db.calls[0]?.params
  expect(params).toContain('dana@example.com')
  expect(params).toContain('c1')
  expect(params).toContain('moderator')
})

test('update builds a dynamic SET of only provided columns, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'm1' }])
  const repo = new CommunityMembersRepo(db, 'locA')

  await repo.update('m1', { role: 'admin' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE community_members SET/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('admin')
  expect(call?.params?.[call.params.length - 1]).toBe('m1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new CommunityMembersRepo(db, 'locA')

  const out = await repo.update('m1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('remove deletes the member scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityMembersRepo(db, 'locA')

  await repo.remove('m1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM community_members WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'm1'])
})

