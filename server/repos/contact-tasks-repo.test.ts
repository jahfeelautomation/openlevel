import { FakeDatabase } from '../db/fake-database'
import { ContactTasksRepo } from './contact-tasks-repo'

test('create inserts a task scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', location_id: 'locA', contact_id: 'c1', title: 'Call back about quote' }])
  const repo = new ContactTasksRepo(db, 'locA')

  const task = await repo.create({
    contactId: 'c1',
    title: 'Call back about quote',
    body: 'They asked for a revised number',
    dueAt: '2026-06-05T17:00:00Z',
  })

  expect(task.id).toBe('t1')
  expect(db.calls[0]?.sql).toMatch(/INSERT INTO contact_tasks/i)
  // scopedWrite passes [locationId, ...extra]; VALUES ($2,$1,$3,$4,$5)
  expect(db.calls[0]?.params[0]).toBe('locA') // location_id ($1)
  expect(db.calls[0]?.params[2]).toBe('c1') // contact_id
  expect(db.calls[0]?.params[3]).toBe('Call back about quote') // title
  expect(db.calls[0]?.params[4]).toBe('They asked for a revised number') // body
  expect(db.calls[0]?.params[5]).toBe('2026-06-05T17:00:00Z') // due_at
})

test('create defaults a missing body and due date to null', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't2', location_id: 'locA' }])
  const repo = new ContactTasksRepo(db, 'locA')

  await repo.create({ contactId: 'c1', title: 'Just a title' })

  expect(db.calls[0]?.params[4]).toBeNull() // body
  expect(db.calls[0]?.params[5]).toBeNull() // due_at
})

test('listByContact scopes to location and orders open-first, soonest due, newest', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1' }])
  const repo = new ContactTasksRepo(db, 'locA')

  await repo.listByContact('c1')

  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/location_id = \$1 AND contact_id=\$2/i)
  expect(sql).toMatch(/order by \(completed_at is not null\), due_at asc nulls last, created_at desc/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('listForLocation joins the contact name and orders open-first across contacts', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', contact_name: 'Sam Smith' }])
  const repo = new ContactTasksRepo(db, 'locA')

  const rows = await repo.listForLocation()

  expect(rows[0]?.contact_name).toBe('Sam Smith')
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/FROM contact_tasks t/i)
  expect(sql).toMatch(/JOIN contacts c ON c\.id = t\.contact_id/i)
  expect(sql).toMatch(/c\.name AS contact_name/i)
  // direct db.query (JOIN escape hatch): still location-filtered as $1
  expect(sql).toMatch(/WHERE t\.location_id = \$1/i)
  expect(sql).toMatch(
    /order by \(t\.completed_at is not null\), t\.due_at asc nulls last, t\.created_at desc/i,
  )
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('update patches the provided columns, scopes to location+contact+id, and bumps updated_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', title: 'edited' }])
  const repo = new ContactTasksRepo(db, 'locA')

  const out = await repo.update('c1', 't1', { title: 'edited', dueAt: '2026-06-06T12:00:00Z' })

  expect(out?.id).toBe('t1')
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/UPDATE contact_tasks/i)
  expect(sql).toMatch(/title=\$2/i)
  expect(sql).toMatch(/due_at=\$3/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  // contact_id pinned before id so a task can only be edited through its own contact.
  expect(sql).toMatch(/WHERE location_id=\$1 AND contact_id=\$4 AND id=\$5/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'edited', '2026-06-06T12:00:00Z', 'c1', 't1'])
})

test('update completed=true stamps completed_at=now() as a literal, not a bound param', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', completed_at: '2026-06-03T18:00:00Z' }])
  const repo = new ContactTasksRepo(db, 'locA')

  await repo.update('c1', 't1', { completed: true })

  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/completed_at=now\(\)/i)
  // the completed toggle binds no value, so contact_id ($2) and id ($3) follow the location
  expect(sql).toMatch(/WHERE location_id=\$1 AND contact_id=\$2 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1', 't1'])
})

test('update completed=false clears completed_at to NULL as a literal', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', completed_at: null }])
  const repo = new ContactTasksRepo(db, 'locA')

  await repo.update('c1', 't1', { completed: false })

  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/completed_at=NULL/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND contact_id=\$2 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1', 't1'])
})

test('update mixes a bound column and the completed toggle, numbering contact+id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1' }])
  const repo = new ContactTasksRepo(db, 'locA')

  await repo.update('c1', 't1', { title: 'done deal', completed: true })

  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/title=\$2/i)
  expect(sql).toMatch(/completed_at=now\(\)/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND contact_id=\$3 AND id=\$4/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'done deal', 'c1', 't1'])
})

test('update with an empty patch issues no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new ContactTasksRepo(db, 'locA')

  const out = await repo.update('c1', 't1', {})

  expect(out).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('update through the wrong contact matches nothing and returns undefined', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // contact_id in the WHERE clause matched no row
  const repo = new ContactTasksRepo(db, 'locA')

  const out = await repo.update('c2', 't1', { title: 'hijacked' })

  expect(out).toBeUndefined()
  expect(db.calls[0]?.params).toEqual(['locA', 'hijacked', 'c2', 't1'])
})

test('remove deletes scoped to location+contact+id and returns true when a row came back', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1' }])
  const repo = new ContactTasksRepo(db, 'locA')

  const ok = await repo.remove('c1', 't1')

  expect(ok).toBe(true)
  expect(db.calls[0]?.sql).toMatch(
    /DELETE FROM contact_tasks WHERE location_id=\$1 AND contact_id=\$2 AND id=\$3/i,
  )
  expect(db.calls[0]?.params).toEqual(['locA', 'c1', 't1'])
})

test('remove through the wrong contact matches nothing and returns false', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new ContactTasksRepo(db, 'locA')

  expect(await repo.remove('c2', 't1')).toBe(false)
})

