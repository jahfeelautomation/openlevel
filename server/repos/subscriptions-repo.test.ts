import { FakeDatabase } from '../db/fake-database'
import { SubscriptionsRepo } from './subscriptions-repo'

test('list scopes to location and orders by created_at DESC', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', name: 'Monthly Management Retainer' }])
  const repo = new SubscriptionsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get scopes to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA' }])
  const repo = new SubscriptionsRepo(db, 'locA')

  const s = await repo.get('s1')
  expect(s?.id).toBe('s1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 's1'])
})

test('create snapshots fields, starts active, defaults the start date to now()', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'new', location_id: 'locA', status: 'active' }]) // RETURNING
  const repo = new SubscriptionsRepo(db, 'locA')

  const s = await repo.create({
    productId: 'prod1',
    contactId: 'c1',
    name: 'Monthly Management Retainer',
    amountCents: 125_000,
    interval: 'month',
  })
  expect(s).toBeDefined()
  const insert = db.calls[0]
  expect(insert?.sql).toMatch(/INSERT INTO subscriptions/i)
  expect(insert?.sql).toMatch(/'active'/i) // a new subscription begins active
  expect(insert?.sql).toMatch(/COALESCE\(\$9, now\(\)\)/i) // start defaults to now
  // scopedWrite passes [locationId, ...extra]:
  // $1 loc, then id, contact_id, product_id, name, amount_cents, currency, interval, started_at
  expect(insert?.params[0]).toBe('locA')
  expect(insert?.params[2]).toBe('c1') // contact_id
  expect(insert?.params[3]).toBe('prod1') // product_id
  expect(insert?.params[4]).toBe('Monthly Management Retainer') // name snapshot
  expect(insert?.params[5]).toBe(125_000) // amount_cents snapshot
  expect(insert?.params[6]).toBe('usd') // currency defaulted
  expect(insert?.params[7]).toBe('month') // billing_interval snapshot
  expect(insert?.params[8]).toBe(null) // started_at omitted -> COALESCE picks now()
})

test('create defaults currency and lets contact/product be absent', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'new', location_id: 'locA' }])
  const repo = new SubscriptionsRepo(db, 'locA')

  await repo.create({ name: 'Standalone Plan', amountCents: 5_000, interval: 'year' })
  const insert = db.calls[0]
  expect(insert?.params[2]).toBe(null) // contact_id absent
  expect(insert?.params[3]).toBe(null) // product_id absent
  expect(insert?.params[6]).toBe('usd') // currency defaulted
  expect(insert?.params[7]).toBe('year')
})

test('update to canceled stamps canceled_at and pins id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', status: 'canceled' }])
  const repo = new SubscriptionsRepo(db, 'locA')

  const s = await repo.update('s1', { status: 'canceled' })
  expect(s?.status).toBe('canceled')
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/SET status=\$2/i)
  expect(sql).toMatch(/canceled_at=now\(\)/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'canceled', 's1'])
})

test('update to a live status clears canceled_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', status: 'active' }])
  const repo = new SubscriptionsRepo(db, 'locA')

  await repo.update('s1', { status: 'active' })
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/SET status=\$2/i)
  expect(sql).toMatch(/canceled_at=NULL/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'active', 's1'])
})

test('update patches a generic column with correct param numbering', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', location_id: 'locA', amount_cents: 9_900 }])
  const repo = new SubscriptionsRepo(db, 'locA')

  const s = await repo.update('s1', { amountCents: 9_900 })
  expect(s?.amount_cents).toBe(9_900)
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/SET amount_cents=\$2/i)
  expect(sql).not.toMatch(/canceled_at/i) // untouched when status is not patched
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 9_900, 's1'])
})

test('update with an empty patch issues no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new SubscriptionsRepo(db, 'locA')

  const s = await repo.update('s1', {})
  expect(s).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('remove deletes the subscription and reports success', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1' }]) // DELETE ... RETURNING id
  const repo = new SubscriptionsRepo(db, 'locA')

  const ok = await repo.remove('s1')
  expect(ok).toBe(true)
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM subscriptions/i)
  expect(db.calls[0]?.params).toEqual(['locA', 's1'])
})

test('remove returns false when nothing was deleted', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // DELETE RETURNING -> nothing
  const repo = new SubscriptionsRepo(db, 'locA')

  const ok = await repo.remove('missing')
  expect(ok).toBe(false)
})
