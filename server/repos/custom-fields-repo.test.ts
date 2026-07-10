import { FakeDatabase } from '../db/fake-database'
import { CustomFieldsRepo } from './custom-fields-repo'

test('list scopes to location and orders by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', location_id: 'locA', key: 'roof_age', position: 0 }])
  const repo = new CustomFieldsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY position/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get scopes to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', location_id: 'locA' }])
  const repo = new CustomFieldsRepo(db, 'locA')

  const f = await repo.get('f1')
  expect(f?.id).toBe('f1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'f1'])
})

test('getByKey scopes to location and matches on key', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', location_id: 'locA', key: 'roof_age', type: 'number' }])
  const repo = new CustomFieldsRepo(db, 'locA')

  const f = await repo.getByKey('roof_age')
  expect(f?.type).toBe('number')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND key=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'roof_age'])
})

test('create slugifies the label into a key and inserts last by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'roof_age', position: 0 }]) // existing keys + positions
  db.enqueue([{ id: 'new', location_id: 'locA', key: 'year_built', position: 1 }]) // insert RETURNING
  const repo = new CustomFieldsRepo(db, 'locA')

  const f = await repo.create({ label: 'Year Built', type: 'number' })
  expect(f.key).toBe('year_built')
  expect(db.calls).toHaveLength(2)
  const insert = db.calls[1]
  expect(insert?.sql).toMatch(/INSERT INTO custom_fields/i)
  // scopedWrite passes [locationId, ...extra]: $1 loc, then id,key,label,type,options,placeholder,position
  expect(insert?.params[0]).toBe('locA')
  expect(insert?.params[2]).toBe('year_built') // computed key
  expect(insert?.params[3]).toBe('Year Built') // label
  expect(insert?.params[4]).toBe('number') // type
  expect(insert?.params[5]).toBe('[]') // options json-encoded
  expect(insert?.params[7]).toBe(1) // position = max(0) + 1
})

test('create de-duplicates a colliding key with a numeric suffix', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'status', position: 2 }]) // 'status' already taken
  db.enqueue([{ id: 'new', location_id: 'locA', key: 'status_2', position: 3 }])
  const repo = new CustomFieldsRepo(db, 'locA')

  const f = await repo.create({ label: 'Status' })
  expect(db.calls[1]?.params[2]).toBe('status_2') // key bumped past the collision
  expect(db.calls[1]?.params[7]).toBe(3) // position = max(2) + 1
  expect(f).toBeDefined()
})

test('create retries on a concurrent unique-key collision (23505) and re-slugs the key', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'status', position: 0 }]) // attempt 1: existing keys (priority free)
  db.enqueueError({ code: '23505' }) // attempt 1 INSERT loses the race to a concurrent create
  db.enqueue([{ key: 'status', position: 0 }, { key: 'priority', position: 1 }]) // attempt 2: re-read shows the winner
  db.enqueue([{ id: 'new', location_id: 'locA', key: 'priority_2', position: 2 }]) // attempt 2 INSERT wins
  const repo = new CustomFieldsRepo(db, 'locA')

  const f = await repo.create({ label: 'Priority' })
  expect(f.id).toBe('new')
  expect(db.calls).toHaveLength(4) // select, failed insert, re-select, successful insert
  // the retry recomputed the slug against the now-committed key set, so the second
  // insert does not reuse the slug that just collided
  expect(db.calls[3]?.params[2]).not.toBe(db.calls[1]?.params[2])
})

test('create surfaces a non-unique-violation error instead of retrying', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // existing keys
  db.enqueueError({ code: '23502' }) // not_null_violation is not a race; must propagate
  const repo = new CustomFieldsRepo(db, 'locA')

  await expect(repo.create({ label: 'X' })).rejects.toMatchObject({ code: '23502' })
  expect(db.calls).toHaveLength(2) // no retry on a non-race error
})

test('update patches only provided columns, bumps updated_at, pins id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', location_id: 'locA', label: 'Roof Age (yrs)' }])
  const repo = new CustomFieldsRepo(db, 'locA')

  const f = await repo.update('f1', { label: 'Roof Age (yrs)' })
  expect(f?.label).toBe('Roof Age (yrs)')
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/SET label=\$2/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'Roof Age (yrs)', 'f1'])
})

test('update serializes options as json', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', location_id: 'locA' }])
  const repo = new CustomFieldsRepo(db, 'locA')

  await repo.update('f1', { options: ['Buyer', 'Seller'] })
  expect(db.calls[0]?.params).toEqual(['locA', '["Buyer","Seller"]', 'f1'])
})

test('update with an empty patch issues no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new CustomFieldsRepo(db, 'locA')

  const f = await repo.update('f1', {})
  expect(f).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('remove deletes the definition and strips its key from every contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'roof_age' }]) // DELETE ... RETURNING key
  db.enqueue([]) // UPDATE contacts sweep
  const repo = new CustomFieldsRepo(db, 'locA')

  const ok = await repo.remove('f1')
  expect(ok).toBe(true)
  expect(db.calls).toHaveLength(2)
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM custom_fields/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'f1'])
  expect(db.calls[1]?.sql).toMatch(/UPDATE contacts SET custom_fields = custom_fields - \$2/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'roof_age'])
})

test('remove returns false and skips the contact sweep when nothing was deleted', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // DELETE RETURNING -> nothing
  const repo = new CustomFieldsRepo(db, 'locA')

  const ok = await repo.remove('missing')
  expect(ok).toBe(false)
  expect(db.calls).toHaveLength(1) // no contact sweep
})
