import { FakeDatabase } from '../db/fake-database'
import { SocialAccountsRepo } from './social-accounts-repo'

test('list scopes the read to the location ($1), oldest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sa1', location_id: 'locA' }])
  const repo = new SocialAccountsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'sa1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single account scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sa1' }])
  const repo = new SocialAccountsRepo(db, 'locA')

  await repo.get('sa1')
  expect(db.calls[0]?.params).toEqual(['locA', 'sa1'])
})

test('countConnected counts only connected accounts in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 2 }])
  const repo = new SocialAccountsRepo(db, 'locA')

  const n = await repo.countConnected()
  expect(n).toBe(2)
  expect(db.calls[0]?.sql).toMatch(/COUNT\(\*\)/i)
  expect(db.calls[0]?.sql).toMatch(/connected=true/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('create sets location $1 and defaults connected false (honest: not linked yet)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sa_new', location_id: 'locA', connected: false }])
  const repo = new SocialAccountsRepo(db, 'locA')

  await repo.create({ platform: 'facebook', handle: '@cashoffers' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('facebook')
  expect(params).toContain('@cashoffers')
  expect(params).toContain(false) // connected default false
})

test('setConnected flips the flag scoped to location + id, refreshing updated_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sa1', connected: true }])
  const repo = new SocialAccountsRepo(db, 'locA')

  await repo.setConnected('sa1', true)
  expect(db.calls[0]?.sql).toMatch(/UPDATE social_accounts SET connected=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/updated_at=now\(\)/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', true, 'sa1'])
})

test('update builds a dynamic SET of only provided columns, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sa1' }])
  const repo = new SocialAccountsRepo(db, 'locA')

  await repo.update('sa1', { handle: '@renamed' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE social_accounts SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('@renamed')
  expect(call?.params?.[call.params.length - 1]).toBe('sa1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new SocialAccountsRepo(db, 'locA')

  const out = await repo.update('sa1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('remove deletes the account scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new SocialAccountsRepo(db, 'locA')

  await repo.remove('sa1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM social_accounts WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'sa1'])
})
