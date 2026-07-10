import { FakeDatabase } from '../db/fake-database'
import { ContactsRepo } from './contacts-repo'

test('upsertByMatch inserts a new contact in one atomic statement, scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'new', location_id: 'locA' }]) // one INSERT ... ON CONFLICT RETURNING
  const repo = new ContactsRepo(db, 'locA')
  const c = await repo.upsertByMatch({ name: 'Bob', phone: '5035550199' }, 'chatwoot')
  expect(c.id).toBe('new')
  expect(db.calls).toHaveLength(1) // no SELECT-then-INSERT race window
  expect(db.calls[0]?.params[1]).toBe('locA') // $2 = location_id ($1 is id)
  expect(db.calls[0]?.sql).toMatch(/ON CONFLICT \(location_id, match_key\)/i)
})

test('upsertByMatch returns the existing contact when match_key already present', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'existing', location_id: 'locA' }]) // ON CONFLICT DO UPDATE RETURNING hands back the existing row
  const repo = new ContactsRepo(db, 'locA')
  const c = await repo.upsertByMatch({ phone: '5035550199' }, 'chatwoot')
  expect(c.id).toBe('existing')
  expect(db.calls).toHaveLength(1)
})

test('upsertByMatch with no phone/email still inserts (anonymous contact)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'anon', location_id: 'locA' }]) // null match_key never matches the partial index -> always inserts
  const repo = new ContactsRepo(db, 'locA')
  const c = await repo.upsertByMatch({ name: 'No Contact Info' }, 'manual')
  expect(c.id).toBe('anon')
  expect(db.calls).toHaveLength(1)
})

test('listByTag scopes to location and filters on tag membership', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', tags: ['seller'] }])
  const repo = new ContactsRepo(db, 'locA')

  const out = await repo.listByTag('seller')
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND \$2 = ANY\(tags\)/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'seller'])
})

test('addTag appends only when absent (idempotent) and scopes to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', tags: ['vip'] }])
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.addTag('c1', 'vip')
  expect(c?.tags).toEqual(['vip'])
  expect(db.calls[0]?.sql).toMatch(/array_append/i) // guarded so a repeat tag is a no-op
  expect(db.calls[0]?.params).toEqual(['locA', 'vip', 'c1'])
})

test('removeTag strips a tag and scopes to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', tags: [] }])
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.removeTag('c1', 'vip')
  expect(c?.tags).toEqual([])
  expect(db.calls[0]?.sql).toMatch(/array_remove/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'vip', 'c1']) // same param order as addTag
})

test('setCustomField merges a value under its key (json-encoded) scoped to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', custom_fields: { roof_age: '12' } }])
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.setCustomField('c1', 'roof_age', '12')
  expect(c?.custom_fields).toEqual({ roof_age: '12' })
  expect(db.calls[0]?.sql).toMatch(/jsonb_build_object/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'roof_age', '"12"', 'c1']) // value is JSON-encoded
})

test('setCustomField with a null value removes the key from the jsonb bag', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', custom_fields: {} }])
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.setCustomField('c1', 'roof_age', null)
  expect(c?.custom_fields).toEqual({})
  expect(db.calls[0]?.sql).toMatch(/custom_fields - \$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'roof_age', 'c1']) // no value param on removal
})

// --- soft-delete (archive) ------------------------------------------------
// A "Delete" in the UI is a soft delete: it stamps archived_at so the contact
// drops out of the book but is fully restorable, because a hard delete would
// cascade away its notes/tasks/timeline and null out its conversations.

test('archive stamps archived_at = now() scoped to location+id, returns the row', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', archived_at: '2026-06-19T00:00:00Z' }])
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.archive('c1')
  expect(c?.id).toBe('c1')
  expect(db.calls[0]?.sql).toMatch(/archived_at = now\(\)/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id = \$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('archive returns undefined when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // UPDATE ... RETURNING matched no row
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.archive('missing')
  expect(c).toBeUndefined()
})

test('restore clears archived_at (back to live) scoped to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', archived_at: null }])
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.restore('c1')
  expect(c?.archived_at).toBeNull()
  expect(db.calls[0]?.sql).toMatch(/archived_at = NULL/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('listArchived returns only archived rows, newest-archived first, location-scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', archived_at: '2026-06-19T00:00:00Z' }])
  const repo = new ContactsRepo(db, 'locA')

  const out = await repo.listArchived()
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/archived_at IS NOT NULL/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY archived_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA', 200])
})

test('list hides archived contacts (archived_at IS NULL)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA' }])
  const repo = new ContactsRepo(db, 'locA')

  await repo.list()
  expect(db.calls[0]?.sql).toMatch(/archived_at IS NULL/i)
})

test('count excludes archived contacts (archived_at IS NULL)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 3 }])
  const repo = new ContactsRepo(db, 'locA')

  const n = await repo.count()
  expect(n).toBe(3)
  expect(db.calls[0]?.sql).toMatch(/archived_at IS NULL/i)
})

test('search excludes archived contacts (archived_at IS NULL)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA' }])
  const repo = new ContactsRepo(db, 'locA')

  await repo.search('bob')
  expect(db.calls[0]?.sql).toMatch(/archived_at IS NULL/i)
})

test('listByTag excludes archived contacts (archived_at IS NULL)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', tags: ['seller'] }])
  const repo = new ContactsRepo(db, 'locA')

  await repo.listByTag('seller')
  expect(db.calls[0]?.sql).toMatch(/archived_at IS NULL/i)
})

// --- contact state (per-state legal texting hours) -------------------------
// The contact's US state pins which legal texting window the gateway enforces
// (8am-9pm in THAT state's own timezone, DST-aware). setState stores the
// 2-letter code; null clears it back to "not set", which the gateway then
// refuses as unknown_state rather than guessing a timezone. One statement for
// both set and clear (a plain column null is just state = $2), mirroring
// archive/restore — not the two-branch setCustomField shape.

test('setState stores the state code scoped to location+id, returns the row', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', state: 'AZ' }])
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.setState('c1', 'AZ')
  expect(c?.state).toBe('AZ')
  expect(db.calls[0]?.sql).toMatch(/SET state = \$2/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id = \$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'AZ', 'c1'])
})

test('setState with null clears the state (back to not-set)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', state: null }])
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.setState('c1', null)
  expect(c?.state).toBeNull()
  expect(db.calls[0]?.params).toEqual(['locA', null, 'c1']) // same SQL, null param
})

test('setState returns undefined when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // UPDATE ... RETURNING matched no row
  const repo = new ContactsRepo(db, 'locA')

  const c = await repo.setState('missing', 'AZ')
  expect(c).toBeUndefined()
})
