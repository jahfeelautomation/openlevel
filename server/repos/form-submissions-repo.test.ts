import { FakeDatabase } from '../db/fake-database'
import { FormSubmissionsRepo } from './form-submissions-repo'

test('create sets location $1, json-encodes values, pins the form + contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sub1', location_id: 'locA', form_id: 'fm1' }])
  const repo = new FormSubmissionsRepo(db, 'locA')

  await repo.create({ formId: 'fm1', contactId: 'ct1', values: { email: 'a@b.com' } })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('fm1')
  expect(params).toContain('ct1')
  expect(params).toContain(JSON.stringify({ email: 'a@b.com' }))
})

test('create tolerates a null contact (anonymous submission)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sub1' }])
  const repo = new FormSubmissionsRepo(db, 'locA')

  await repo.create({ formId: 'fm1', contactId: null, values: {} })
  expect(db.calls[0]?.params).toContain(null)
})

test('listByForm reads submissions scoped to location + form, newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sub1', form_id: 'fm1' }])
  const repo = new FormSubmissionsRepo(db, 'locA')

  const out = await repo.listByForm('fm1')
  expect(out).toEqual([{ id: 'sub1', form_id: 'fm1' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND form_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'fm1'])
})
