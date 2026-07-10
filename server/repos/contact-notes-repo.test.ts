import { FakeDatabase } from '../db/fake-database'
import { ContactNotesRepo } from './contact-notes-repo'

test('create inserts a note scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1', location_id: 'locA', contact_id: 'c1', body: 'Called, left a voicemail' }])
  const repo = new ContactNotesRepo(db, 'locA')

  const note = await repo.create({ contactId: 'c1', body: 'Called, left a voicemail', author: 'AL' })

  expect(note.id).toBe('n1')
  expect(db.calls[0]?.sql).toMatch(/INSERT INTO contact_notes/i)
  // scopedWrite passes [locationId, ...extra]; calendars-style VALUES ($2,$1,...)
  expect(db.calls[0]?.params[0]).toBe('locA') // location_id ($1)
  expect(db.calls[0]?.params[2]).toBe('c1') // contact_id
  expect(db.calls[0]?.params[3]).toBe('Called, left a voicemail') // body
  expect(db.calls[0]?.params[4]).toBe('AL') // author
})

test('create defaults a missing author to null', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n2', location_id: 'locA' }])
  const repo = new ContactNotesRepo(db, 'locA')

  await repo.create({ contactId: 'c1', body: 'No author given' })

  expect(db.calls[0]?.params[4]).toBeNull()
})

test('listByContact scopes to location and orders pinned first then newest', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1', pinned: true }])
  const repo = new ContactNotesRepo(db, 'locA')

  await repo.listByContact('c1')

  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/location_id = \$1 AND contact_id=\$2/i)
  expect(sql).toMatch(/order by pinned desc, created_at desc/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('update patches the provided columns, scopes to location+contact+id, and bumps updated_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1', body: 'edited', pinned: true }])
  const repo = new ContactNotesRepo(db, 'locA')

  const out = await repo.update('c1', 'n1', { body: 'edited', pinned: true })

  expect(out?.id).toBe('n1')
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/UPDATE contact_notes/i)
  expect(sql).toMatch(/body=\$2/i)
  expect(sql).toMatch(/pinned=\$3/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  // contact_id is pinned before id so a note can only be edited through the
  // contact it belongs to — reaching it via another contact's URL won't match.
  expect(sql).toMatch(/WHERE location_id=\$1 AND contact_id=\$4 AND id=\$5/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'edited', true, 'c1', 'n1'])
})

test('update with a single column numbers the contact+id params correctly', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1', pinned: true }])
  const repo = new ContactNotesRepo(db, 'locA')

  await repo.update('c1', 'n1', { pinned: true })

  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/pinned=\$2/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND contact_id=\$3 AND id=\$4/i)
  expect(db.calls[0]?.params).toEqual(['locA', true, 'c1', 'n1'])
})

test('update with an empty patch issues no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new ContactNotesRepo(db, 'locA')

  const out = await repo.update('c1', 'n1', {})

  expect(out).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('update through the wrong contact matches nothing and returns undefined', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // contact_id in the WHERE clause matched no row
  const repo = new ContactNotesRepo(db, 'locA')

  // note n1 belongs to c1; editing it via c2's URL finds nothing.
  const out = await repo.update('c2', 'n1', { body: 'hijacked' })

  expect(out).toBeUndefined()
  expect(db.calls[0]?.params).toEqual(['locA', 'hijacked', 'c2', 'n1'])
})

test('remove deletes scoped to location+contact+id and returns true when a row came back', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1' }])
  const repo = new ContactNotesRepo(db, 'locA')

  const ok = await repo.remove('c1', 'n1')

  expect(ok).toBe(true)
  expect(db.calls[0]?.sql).toMatch(
    /DELETE FROM contact_notes WHERE location_id=\$1 AND contact_id=\$2 AND id=\$3/i,
  )
  expect(db.calls[0]?.params).toEqual(['locA', 'c1', 'n1'])
})

test('remove through the wrong contact matches nothing and returns false', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new ContactNotesRepo(db, 'locA')

  expect(await repo.remove('c2', 'n1')).toBe(false)
})

