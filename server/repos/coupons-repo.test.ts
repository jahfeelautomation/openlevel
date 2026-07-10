import { FakeDatabase } from '../db/fake-database'
import { CouponsRepo } from './coupons-repo'

test('list scopes to location and orders newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', code: 'SUMMER25' }])
  const repo = new CouponsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get scopes to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA' }])
  const repo = new CouponsRepo(db, 'locA')

  const c = await repo.get('c1')
  expect(c?.id).toBe('c1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('getByCode normalises the code before the lookup', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', code: 'SUMMER25' }])
  const repo = new CouponsRepo(db, 'locA')

  const c = await repo.getByCode('  summer 25 ')
  expect(c?.id).toBe('c1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND code=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'SUMMER25'])
})

test('create normalises the code and defaults type, redemptions and expiry', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'new', location_id: 'locA', code: 'SAVE10' }]) // RETURNING
  const repo = new CouponsRepo(db, 'locA')

  const c = await repo.create({ code: 'save 10', discountValue: 10 })
  expect(c).toBeDefined()
  const insert = db.calls[0]
  expect(insert?.sql).toMatch(/INSERT INTO coupons/i)
  // scopedWrite passes [locationId, ...extra]: $1 loc, then id,code,desc,type,value,maxRedemptions,expiresAt
  expect(insert?.params[0]).toBe('locA')
  expect(insert?.params[2]).toBe('SAVE10') // code normalised
  expect(insert?.params[3]).toBe(null) // description defaulted
  expect(insert?.params[4]).toBe('percent') // discount_type defaulted
  expect(insert?.params[5]).toBe(10) // discount_value
  expect(insert?.params[6]).toBe(null) // max_redemptions defaulted (unlimited)
  expect(insert?.params[7]).toBe(null) // expires_at defaulted (never)
})

test('create carries a fixed discount, cap and expiry through', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'new', location_id: 'locA', code: 'FIFTYOFF' }])
  const repo = new CouponsRepo(db, 'locA')

  await repo.create({
    code: 'FIFTYOFF',
    description: 'Launch week',
    discountType: 'fixed',
    discountValue: 5_000,
    maxRedemptions: 100,
    expiresAt: '2026-12-31T00:00:00.000Z',
  })
  const insert = db.calls[0]
  expect(insert?.params[3]).toBe('Launch week')
  expect(insert?.params[4]).toBe('fixed')
  expect(insert?.params[5]).toBe(5_000)
  expect(insert?.params[6]).toBe(100)
  expect(insert?.params[7]).toBe('2026-12-31T00:00:00.000Z')
})

test('update patches only provided columns, normalises code, bumps updated_at, pins id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', code: 'WINTER30' }])
  const repo = new CouponsRepo(db, 'locA')

  const c = await repo.update('c1', { code: 'winter 30', discountValue: 30 })
  expect(c?.code).toBe('WINTER30')
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/SET code=\$2/i)
  expect(sql).toMatch(/discount_value=\$3/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=\$4/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'WINTER30', 30, 'c1'])
})

test('update can archive a coupon via its status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', status: 'archived' }])
  const repo = new CouponsRepo(db, 'locA')

  const c = await repo.update('c1', { status: 'archived' })
  expect(c?.status).toBe('archived')
  expect(db.calls[0]?.sql).toMatch(/SET status=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'archived', 'c1'])
})

test('update can clear the expiry and cap by setting them null', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA' }])
  const repo = new CouponsRepo(db, 'locA')

  await repo.update('c1', { expiresAt: null, maxRedemptions: null })
  expect(db.calls[0]?.params).toEqual(['locA', null, null, 'c1'])
})

test('update with an empty patch issues no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new CouponsRepo(db, 'locA')

  const c = await repo.update('c1', {})
  expect(c).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('incrementRedeemed advances the counter for the scoped coupon', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', times_redeemed: 4 }])
  const repo = new CouponsRepo(db, 'locA')

  const c = await repo.incrementRedeemed('c1')
  expect(c?.times_redeemed).toBe(4)
  const sql = db.calls[0]?.sql ?? ''
  expect(sql).toMatch(/times_redeemed = times_redeemed \+ 1/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('remove deletes the coupon and reports success', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1' }]) // DELETE ... RETURNING id
  const repo = new CouponsRepo(db, 'locA')

  const ok = await repo.remove('c1')
  expect(ok).toBe(true)
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM coupons/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('remove returns false when nothing was deleted', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // DELETE RETURNING -> nothing
  const repo = new CouponsRepo(db, 'locA')

  const ok = await repo.remove('missing')
  expect(ok).toBe(false)
})
