import { FakeDatabase } from '../db/fake-database'
import { ProductsRepo } from './products-repo'

test('list scopes to location and orders by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Roof Inspection', position: 0 }])
  const repo = new ProductsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY position/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get scopes to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA' }])
  const repo = new ProductsRepo(db, 'locA')

  const p = await repo.get('p1')
  expect(p?.id).toBe('p1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('create inserts a one-time product last by position with a null interval', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ position: 0 }]) // existing positions
  db.enqueue([{ id: 'new', location_id: 'locA', name: 'Roof Inspection', position: 1 }]) // RETURNING
  const repo = new ProductsRepo(db, 'locA')

  const p = await repo.create({ name: 'Roof Inspection', priceCents: 19900 })
  expect(p).toBeDefined()
  expect(db.calls).toHaveLength(2)
  const insert = db.calls[1]
  expect(insert?.sql).toMatch(/INSERT INTO products/i)
  // scopedWrite passes [locationId, ...extra]: $1 loc, then id,name,desc,price,currency,type,interval,position
  expect(insert?.params[0]).toBe('locA')
  expect(insert?.params[2]).toBe('Roof Inspection') // name
  expect(insert?.params[3]).toBe(null) // description defaulted
  expect(insert?.params[4]).toBe(19900) // price_cents
  expect(insert?.params[5]).toBe('usd') // currency defaulted
  expect(insert?.params[6]).toBe('one_time') // type defaulted
  expect(insert?.params[7]).toBe(null) // a one-time product has no interval
  expect(insert?.params[8]).toBe(1) // position = max(0) + 1
})

test('create defaults a recurring product to a monthly interval', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // no existing products
  db.enqueue([{ id: 'new', location_id: 'locA', position: 0 }])
  const repo = new ProductsRepo(db, 'locA')

  await repo.create({ name: 'Care Plan', type: 'recurring', priceCents: 9900 })
  expect(db.calls[1]?.params[6]).toBe('recurring')
  expect(db.calls[1]?.params[7]).toBe('month') // interval defaulted when recurring
  expect(db.calls[1]?.params[8]).toBe(0) // first product -> position 0
})

test('create honours an explicit recurring interval', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  db.enqueue([{ id: 'new', location_id: 'locA', position: 0 }])
  const repo = new ProductsRepo(db, 'locA')

  await repo.create({
    name: 'Annual License',
    type: 'recurring',
    recurringInterval: 'year',
    priceCents: 120000,
  })
  expect(db.calls[1]?.params[7]).toBe('year')
})

test('create forces a one-time product to drop any stray interval', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  db.enqueue([{ id: 'new', location_id: 'locA', position: 0 }])
  const repo = new ProductsRepo(db, 'locA')

  await repo.create({ name: 'Setup Fee', type: 'one_time', recurringInterval: 'month' })
  expect(db.calls[1]?.params[6]).toBe('one_time')
  expect(db.calls[1]?.params[7]).toBe(null)
})

test('update patches only provided columns, bumps updated_at, pins id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', price_cents: 22000 }])
  const repo = new ProductsRepo(db, 'locA')

  const p = await repo.update('p1', { priceCents: 22000 })
  expect(p?.price_cents).toBe(22000)
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/SET price_cents=\$2/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 22000, 'p1'])
})

test('update can archive a product via its status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', status: 'archived' }])
  const repo = new ProductsRepo(db, 'locA')

  const p = await repo.update('p1', { status: 'archived' })
  expect(p?.status).toBe('archived')
  expect(db.calls[0]?.sql).toMatch(/SET status=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'archived', 'p1'])
})

test('update normalises a recurring->one_time switch by clearing the interval', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA', type: 'one_time', recurring_interval: null }])
  const repo = new ProductsRepo(db, 'locA')

  await repo.update('p1', { type: 'one_time' })
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/type=\$2/i)
  expect(sql).toMatch(/recurring_interval=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'one_time', null, 'p1'])
})

test('update with an empty patch issues no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new ProductsRepo(db, 'locA')

  const p = await repo.update('p1', {})
  expect(p).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('remove deletes the product and reports success', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1' }]) // DELETE ... RETURNING id
  const repo = new ProductsRepo(db, 'locA')

  const ok = await repo.remove('p1')
  expect(ok).toBe(true)
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM products/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('remove returns false when nothing was deleted', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // DELETE RETURNING -> nothing
  const repo = new ProductsRepo(db, 'locA')

  const ok = await repo.remove('missing')
  expect(ok).toBe(false)
})
