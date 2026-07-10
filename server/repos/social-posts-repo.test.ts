import { FakeDatabase } from '../db/fake-database'
import { SocialPostsRepo } from './social-posts-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sp1', location_id: 'locA' }])
  const repo = new SocialPostsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'sp1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('listTargets reads the post fan-out scoped to location + post', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', post_id: 'sp1', account_id: 'sa1' }])
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.listTargets('sp1')
  expect(db.calls[0]?.sql).toMatch(/FROM social_post_targets WHERE location_id = \$1 AND post_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'sp1'])
})

test('create sets location $1 and defaults status draft with no schedule', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sp_new', location_id: 'locA', status: 'draft' }])
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.create({ body: 'New listing just dropped' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('New listing just dropped')
  expect(params).toContain('draft') // status default
  expect(params).toContain(null) // scheduled_at default null
})

test('create with accountIds inserts the post then replaces its targets (delete + one insert each)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sp_new', location_id: 'locA' }]) // INSERT post
  db.enqueue([]) // DELETE targets
  db.enqueue([{ id: 'sa1' }, { id: 'sa2' }]) // SELECT owned accounts (both belong to this location)
  db.enqueue([]) // INSERT target sa1
  db.enqueue([]) // INSERT target sa2
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.create({ body: 'Multi-channel', accountIds: ['sa1', 'sa2'] })
  expect(db.calls[0]?.sql).toMatch(/INSERT INTO social_posts/i)
  expect(db.calls[1]?.sql).toMatch(/DELETE FROM social_post_targets WHERE location_id=\$1 AND post_id=\$2/i)
  expect(db.calls[2]?.sql).toMatch(/SELECT id FROM social_accounts/i) // ownership gate before fan-out
  expect(db.calls[3]?.sql).toMatch(/INSERT INTO social_post_targets/i)
  expect(db.calls[3]?.params?.[0]).toBe('locA')
  expect(db.calls[3]?.params).toContain('sa1')
  expect(db.calls[4]?.params).toContain('sa2')
  expect(db.calls.length).toBe(5)
})

test('replaceTargets dedupes account ids so the unique index is never tripped', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // DELETE
  db.enqueue([{ id: 'sa1' }]) // SELECT owned accounts → sa1 belongs to this location
  db.enqueue([]) // INSERT sa1 (only once despite the duplicate)
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.replaceTargets('sp1', ['sa1', 'sa1'])
  expect(db.calls.length).toBe(3) // delete + owned-accounts select + a single insert
  expect(db.calls[1]?.sql).toMatch(/SELECT id FROM social_accounts/i)
  expect(db.calls[2]?.params).toContain('sa1')
})

test('replaceTargets drops account ids this location does not own (no cross-tenant fan-out)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // DELETE
  db.enqueue([{ id: 'sa1' }]) // SELECT owned accounts → only sa1 belongs to this location
  db.enqueue([]) // INSERT sa1
  const repo = new SocialPostsRepo(db, 'locA')

  // 'sa_foreign' is a real account in another tenant; it satisfies the FK but
  // must never be fanned out to from this location's post.
  await repo.replaceTargets('sp1', ['sa1', 'sa_foreign'])
  expect(db.calls.length).toBe(3) // delete + select + exactly one insert (sa1 only)
  expect(db.calls[2]?.sql).toMatch(/INSERT INTO social_post_targets/i)
  expect(db.calls[2]?.params).toContain('sa1')
  expect(db.calls[2]?.params).not.toContain('sa_foreign')
})

test('create stores the media url when one is attached', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sp_new', location_id: 'locA', media_url: 'https://img.example/open-house.jpg' }])
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.create({ body: 'Open house Saturday', mediaUrl: 'https://img.example/open-house.jpg' })
  expect(db.calls[0]?.sql).toMatch(/media_url/i)
  expect(db.calls[0]?.params).toContain('https://img.example/open-house.jpg')
})

test('update can set and clear the media url', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sp1' }])
  db.enqueue([{ id: 'sp1' }])
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.update('sp1', { mediaUrl: 'https://img.example/new.jpg' })
  expect(db.calls[0]?.sql).toMatch(/media_url=\$2/i)
  expect(db.calls[0]?.params).toContain('https://img.example/new.jpg')

  await repo.update('sp1', { mediaUrl: null })
  expect(db.calls[1]?.sql).toMatch(/media_url=\$2/i)
  expect(db.calls[1]?.params).toContain(null)
})

test('recordTargetOutcomes writes each channel result scoped to location + post + account', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // UPDATE target accFb
  db.enqueue([]) // UPDATE target accIg
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.recordTargetOutcomes('sp1', [
    { accountId: 'accFb', status: 'published', detail: null, externalId: 'fb_123' },
    { accountId: 'accIg', status: 'failed', detail: 'instagram needs an image — add an image URL to this post', externalId: null },
  ])
  expect(db.calls.length).toBe(2)
  expect(db.calls[0]?.sql).toMatch(/UPDATE social_post_targets SET status=\$2, detail=\$3, external_id=\$4/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND post_id=\$5 AND account_id=\$6/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'published', null, 'fb_123', 'sp1', 'accFb'])
  expect(db.calls[1]?.params).toEqual([
    'locA',
    'failed',
    'instagram needs an image — add an image URL to this post',
    null,
    'sp1',
    'accIg',
  ])
})

test('schedule sets status scheduled + scheduled_at, scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sp1', status: 'scheduled' }])
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.schedule('sp1', '2026-06-10T15:00:00Z')
  const call = db.calls[0]
  expect(call?.sql).toMatch(/status='scheduled'/i)
  expect(call?.sql).toMatch(/scheduled_at=\$2/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(call?.params).toEqual(['locA', '2026-06-10T15:00:00Z', 'sp1'])
})

test('publish records an honest published_at in our ledger, scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sp1', status: 'published' }])
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.publish('sp1', '2026-06-03T12:00:00Z')
  const call = db.calls[0]
  expect(call?.sql).toMatch(/status='published'/i)
  expect(call?.sql).toMatch(/published_at=\$2/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(call?.params).toEqual(['locA', '2026-06-03T12:00:00Z', 'sp1'])
})

test('update patches only provided columns, refreshes updated_at, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sp1' }])
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.update('sp1', { body: 'Edited copy' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE social_posts SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('Edited copy')
  expect(call?.params?.[call.params.length - 1]).toBe('sp1') // id is last
})

test('update with no fields is a no-op returning undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new SocialPostsRepo(db, 'locA')

  const out = await repo.update('sp1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('remove deletes the post scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new SocialPostsRepo(db, 'locA')

  await repo.remove('sp1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM social_posts WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'sp1'])
})
