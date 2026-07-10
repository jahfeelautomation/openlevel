import { FakeDatabase } from '../db/fake-database'
import { CustomValuesRepo } from './custom-values-repo'

test('list scopes to location and orders by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1', location_id: 'locA', key: 'business_name', position: 0 }])
  const repo = new CustomValuesRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY position/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get scopes to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1', location_id: 'locA' }])
  const repo = new CustomValuesRepo(db, 'locA')

  const v = await repo.get('v1')
  expect(v?.id).toBe('v1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'v1'])
})

test('getByKey scopes to location and matches on key', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1', location_id: 'locA', key: 'business_name', value: 'Acme' }])
  const repo = new CustomValuesRepo(db, 'locA')

  const v = await repo.getByKey('business_name')
  expect(v?.value).toBe('Acme')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND key=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'business_name'])
})

test('map returns a key to value record for the renderer', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { id: 'v1', location_id: 'locA', key: 'business_name', value: 'Acme', position: 0 },
    { id: 'v2', location_id: 'locA', key: 'support_phone', value: '555-0100', position: 1 },
  ])
  const repo = new CustomValuesRepo(db, 'locA')

  const m = await repo.map()
  expect(m).toEqual({ business_name: 'Acme', support_phone: '555-0100' })
})

test('create slugifies the name into a key and inserts last by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'business_name', position: 0 }]) // existing keys + positions
  db.enqueue([{ id: 'new', location_id: 'locA', key: 'booking_link', position: 1 }]) // insert RETURNING
  const repo = new CustomValuesRepo(db, 'locA')

  const v = await repo.create({ name: 'Booking Link', value: 'https://book.test' })
  expect(v.key).toBe('booking_link')
  expect(db.calls).toHaveLength(2)
  const insert = db.calls[1]
  expect(insert?.sql).toMatch(/INSERT INTO custom_values/i)
  // scopedWrite passes [locationId, ...extra]: $1 loc, then id,key,name,value,position
  expect(insert?.params[0]).toBe('locA')
  expect(insert?.params[2]).toBe('booking_link') // computed key
  expect(insert?.params[3]).toBe('Booking Link') // name
  expect(insert?.params[4]).toBe('https://book.test') // value
  expect(insert?.params[5]).toBe(1) // position = max(0) + 1
})

test('create defaults a missing value to an empty string', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // no existing values
  db.enqueue([{ id: 'new', location_id: 'locA', key: 'tagline', position: 0 }])
  const repo = new CustomValuesRepo(db, 'locA')

  await repo.create({ name: 'Tagline' })
  expect(db.calls[1]?.params[4]).toBe('') // value defaulted
  expect(db.calls[1]?.params[5]).toBe(0) // first value -> position 0
})

test('create de-duplicates a colliding key with a numeric suffix', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ key: 'business_name', position: 2 }]) // 'business_name' already taken
  db.enqueue([{ id: 'new', location_id: 'locA', key: 'business_name_2', position: 3 }])
  const repo = new CustomValuesRepo(db, 'locA')

  const v = await repo.create({ name: 'Business Name' })
  expect(db.calls[1]?.params[2]).toBe('business_name_2') // key bumped past the collision
  expect(db.calls[1]?.params[5]).toBe(3) // position = max(2) + 1
  expect(v).toBeDefined()
})

test('update patches only provided columns, bumps updated_at, pins id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1', location_id: 'locA', value: 'Acme Roofing' }])
  const repo = new CustomValuesRepo(db, 'locA')

  const v = await repo.update('v1', { value: 'Acme Roofing' })
  expect(v?.value).toBe('Acme Roofing')
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/SET value=\$2/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'Acme Roofing', 'v1'])
})

test('update with an empty patch issues no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new CustomValuesRepo(db, 'locA')

  const v = await repo.update('v1', {})
  expect(v).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('remove deletes the value and reports success', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'v1' }]) // DELETE ... RETURNING id
  const repo = new CustomValuesRepo(db, 'locA')

  const ok = await repo.remove('v1')
  expect(ok).toBe(true)
  expect(db.calls).toHaveLength(1) // no per-contact fan-out to clean up
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM custom_values/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'v1'])
})

test('remove returns false when nothing was deleted', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // DELETE RETURNING -> nothing
  const repo = new CustomValuesRepo(db, 'locA')

  const ok = await repo.remove('missing')
  expect(ok).toBe(false)
})
