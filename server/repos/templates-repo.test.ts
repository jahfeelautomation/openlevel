import { FakeDatabase } from '../db/fake-database'
import { TemplatesRepo } from './templates-repo'

test('create inserts a template scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1', location_id: 'locA', name: 'Welcome email' }])
  const repo = new TemplatesRepo(db, 'locA')

  const tpl = await repo.create({
    name: 'Welcome email',
    channel: 'email',
    subject: 'Welcome, {{first_name}}',
    body: 'Hi {{first_name}}, thanks for reaching out.',
  })

  expect(tpl.id).toBe('tpl1')
  expect(db.calls[0]?.sql).toMatch(/INSERT INTO templates/i)
  // scopedWrite passes [locationId, ...extra]; VALUES ($2,$1,$3,$4,$5,$6)
  expect(db.calls[0]?.params[0]).toBe('locA') // location_id ($1)
  expect(db.calls[0]?.params[2]).toBe('Welcome email') // name
  expect(db.calls[0]?.params[3]).toBe('email') // channel
  expect(db.calls[0]?.params[4]).toBe('Welcome, {{first_name}}') // subject
  expect(db.calls[0]?.params[5]).toBe('Hi {{first_name}}, thanks for reaching out.') // body
})

test('create defaults channel to email and a missing subject to null', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl2', location_id: 'locA' }])
  const repo = new TemplatesRepo(db, 'locA')

  await repo.create({ name: 'Quick SMS', body: 'On my way!' })

  expect(db.calls[0]?.params[3]).toBe('email') // channel default
  expect(db.calls[0]?.params[4]).toBeNull() // subject
})

test('list scopes to the location and orders newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1' }])
  const repo = new TemplatesRepo(db, 'locA')

  await repo.list()

  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/SELECT \* FROM templates/i)
  expect(sql).toMatch(/order by created_at desc/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get scopes to location and id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1', name: 'Welcome' }])
  const repo = new TemplatesRepo(db, 'locA')

  const tpl = await repo.get('tpl1')

  expect(tpl?.id).toBe('tpl1')
  expect(db.calls[0]?.sql).toMatch(/location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'tpl1'])
})

test('update patches the provided columns, scopes to location+id, and bumps updated_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1', name: 'edited' }])
  const repo = new TemplatesRepo(db, 'locA')

  const out = await repo.update('tpl1', { name: 'edited', body: 'new body' })

  expect(out?.id).toBe('tpl1')
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/UPDATE templates/i)
  expect(sql).toMatch(/name=\$2/i)
  expect(sql).toMatch(/body=\$3/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=\$4/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'edited', 'new body', 'tpl1'])
})

test('update can clear the subject to null (switching a template to SMS)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1', subject: null }])
  const repo = new TemplatesRepo(db, 'locA')

  await repo.update('tpl1', { channel: 'sms', subject: null })

  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/channel=\$2/i)
  expect(sql).toMatch(/subject=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'sms', null, 'tpl1'])
})

test('update with an empty patch issues no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new TemplatesRepo(db, 'locA')

  const out = await repo.update('tpl1', {})

  expect(out).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('remove deletes scoped to location+id and returns true when a row came back', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'tpl1' }])
  const repo = new TemplatesRepo(db, 'locA')

  const ok = await repo.remove('tpl1')

  expect(ok).toBe(true)
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM templates WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'tpl1'])
})

test('remove returns false when no row matched', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new TemplatesRepo(db, 'locA')

  expect(await repo.remove('nope')).toBe(false)
})
