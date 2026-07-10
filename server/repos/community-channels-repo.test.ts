import { FakeDatabase } from '../db/fake-database'
import { CommunityChannelsRepo } from './community-channels-repo'

test('listByCommunity scopes to the location ($1) and orders by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ch1', community_id: 'cm1', position: 0 }])
  const repo = new CommunityChannelsRepo(db, 'locA')

  const out = await repo.listByCommunity('cm1')
  expect(out).toEqual([{ id: 'ch1', community_id: 'cm1', position: 0 }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/community_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY position/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1'])
})

test('get reads a single channel scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ch1' }])
  const repo = new CommunityChannelsRepo(db, 'locA')

  await repo.get('ch1')
  expect(db.calls[0]?.params).toEqual(['locA', 'ch1'])
})

test('getBySlug resolves a channel within its community scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ch1', slug: 'wins' }])
  const repo = new CommunityChannelsRepo(db, 'locA')

  await repo.getBySlug('cm1', 'wins')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND community_id=\$2 AND slug=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1', 'wins'])
})

test('countByCommunity counts channels for the community scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 3 }])
  const repo = new CommunityChannelsRepo(db, 'locA')

  const n = await repo.countByCommunity('cm1')
  expect(n).toBe(3)
  expect(db.calls[0]?.sql).toMatch(/COUNT\(\*\)::int AS n/i)
  expect(db.calls[0]?.sql).toMatch(/community_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cm1'])
})

test('countByCommunity returns an honest zero when there are no channels', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityChannelsRepo(db, 'locA')

  expect(await repo.countByCommunity('cm1')).toBe(0)
})

test('create sets location $1, community $3, position $4, name/slug', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ch_new', community_id: 'cm1' }])
  const repo = new CommunityChannelsRepo(db, 'locA')

  await repo.create({ communityId: 'cm1', name: 'Wins', slug: 'wins', position: 2 })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('cm1')
  expect(params).toContain('Wins')
  expect(params).toContain('wins')
  expect(params).toContain(2)
})

test('create defaults position to 0 when not supplied', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ch_new' }])
  const repo = new CommunityChannelsRepo(db, 'locA')

  await repo.create({ communityId: 'cm1', name: 'General', slug: 'general' })
  expect(db.calls[0]?.params).toContain(0)
})

test('update builds a dynamic SET of only provided columns, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ch1' }])
  const repo = new CommunityChannelsRepo(db, 'locA')

  await repo.update('ch1', { name: 'Renamed', position: 5 })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE community_channels SET/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('Renamed')
  expect(call?.params).toContain(5)
  expect(call?.params?.[call.params.length - 1]).toBe('ch1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new CommunityChannelsRepo(db, 'locA')

  const out = await repo.update('ch1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('remove deletes the channel scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CommunityChannelsRepo(db, 'locA')

  await repo.remove('ch1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM community_channels WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'ch1'])
})
