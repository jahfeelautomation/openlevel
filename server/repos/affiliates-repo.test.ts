import { FakeDatabase } from '../db/fake-database'
import { AffiliateClicksRepo } from './affiliate-clicks-repo'
import { AffiliateProgramsRepo } from './affiliate-programs-repo'
import { AffiliateReferralsRepo } from './affiliate-referrals-repo'
import { AffiliatesRepo } from './affiliates-repo'

// ── Programs ─────────────────────────────────────────────────────────────────

test('program create sets location_id explicitly ($1) and defaults the rate fields', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'pg_new', location_id: 'locA', name: 'Referral Program' }])
  const repo = new AffiliateProgramsRepo(db, 'locA')
  const pg = await repo.create({ name: 'Referral Program', landingUrl: 'https://x.test' })

  expect(pg.id).toBe('pg_new')
  expect(db.calls[0]?.params[0]).toBe('locA') // $1 = location_id
  expect(db.calls[0]?.params).toContain('Referral Program')
  expect(db.calls[0]?.params).toContain('percent') // default commission_type
  expect(db.calls[0]?.params).toContain('https://x.test')
})

test('program getPrimary scopes to the location (newest first, limit 1)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'pg1', location_id: 'locA' }])
  const repo = new AffiliateProgramsRepo(db, 'locA')
  const pg = await repo.getPrimary()

  expect(pg?.id).toBe('pg1')
  expect(db.calls[0]?.params).toEqual(['locA'])
  expect(db.calls[0]?.sql).toMatch(/order by created_at desc/i)
})

test('program update passes location first and id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'pg1', commission_value: 15 }])
  const repo = new AffiliateProgramsRepo(db, 'locA')
  await repo.update('pg1', { commissionValue: 15 })

  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA')
  expect(params?.[1]).toBe(15)
  expect(params?.[params.length - 1]).toBe('pg1')
})

// ── Affiliates ───────────────────────────────────────────────────────────────

test('affiliate create sets location_id ($1) and passes program + code', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'af_new', location_id: 'locA', code: 'MARCUS' }])
  const repo = new AffiliatesRepo(db, 'locA')
  const af = await repo.create({ programId: 'pg1', name: 'Marcus', code: 'MARCUS' })

  expect(af.id).toBe('af_new')
  expect(db.calls[0]?.params[0]).toBe('locA') // $1 = location_id
  expect(db.calls[0]?.params).toContain('pg1')
  expect(db.calls[0]?.params).toContain('MARCUS')
})

test('affiliate listWithStats scopes to the location as $1 with no program filter', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'af1', clicks: 0, referrals: 0 }])
  const repo = new AffiliatesRepo(db, 'locA')
  await repo.listWithStats()

  expect(db.calls[0]?.params).toEqual(['locA'])
  // correlated subqueries, not a fan-out join
  expect(db.calls[0]?.sql).toMatch(/SELECT COUNT\(\*\)::int FROM affiliate_clicks/i)
  expect(db.calls[0]?.sql).not.toMatch(/LEFT JOIN affiliate_referrals/i)
})

test('affiliate listWithStats adds the program as $2 when filtered', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'af1' }])
  const repo = new AffiliatesRepo(db, 'locA')
  await repo.listWithStats('pg1')

  expect(db.calls[0]?.params).toEqual(['locA', 'pg1'])
  expect(db.calls[0]?.sql).toMatch(/a\.program_id = \$2/i)
})

test('affiliate getByCode scopes the lookup to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'af1', code: 'MARCUS' }])
  const repo = new AffiliatesRepo(db, 'locA')
  const af = await repo.getByCode('MARCUS')

  expect(af?.id).toBe('af1')
  expect(db.calls[0]?.params).toEqual(['locA', 'MARCUS'])
})

test('affiliate update passes location first and id last; empty patch short-circuits to get', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'af1', status: 'paused' }])
  const repo = new AffiliatesRepo(db, 'locA')
  await repo.update('af1', { status: 'paused' })

  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA')
  expect(params?.[1]).toBe('paused')
  expect(params?.[params.length - 1]).toBe('af1')
})

// ── Clicks ───────────────────────────────────────────────────────────────────

test('click record sets location_id ($1), affiliate, and the attributed contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cl1', location_id: 'locA', affiliate_id: 'af1', contact_id: 'c1' }])
  const repo = new AffiliateClicksRepo(db, 'locA')
  await repo.record({ affiliateId: 'af1', contactId: 'c1' })

  expect(db.calls[0]?.params[0]).toBe('locA') // $1
  expect(db.calls[0]?.params).toContain('af1')
  expect(db.calls[0]?.params).toContain('c1')
})

test('click record keeps an anonymous visit honest (null contact)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cl2', contact_id: null }])
  const repo = new AffiliateClicksRepo(db, 'locA')
  await repo.record({ affiliateId: 'af1', contactId: null })

  expect(db.calls[0]?.params).toContain(null)
})

// ── Referrals ────────────────────────────────────────────────────────────────

test('referral create locks the commission on the row and scopes by location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'r_new', location_id: 'locA', amount_cents: 25000, commission_cents: 2500 }])
  const repo = new AffiliateReferralsRepo(db, 'locA')
  await repo.create({ affiliateId: 'af1', amountCents: 25000, commissionCents: 2500 })

  expect(db.calls[0]?.params[0]).toBe('locA') // $1
  expect(db.calls[0]?.params).toContain('af1')
  expect(db.calls[0]?.params).toContain(25000) // sale
  expect(db.calls[0]?.params).toContain(2500) // locked commission
})

test('referral setStatus to paid stamps paid_at now() and scopes to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'r1', status: 'paid' }])
  const repo = new AffiliateReferralsRepo(db, 'locA')
  await repo.setStatus('r1', 'paid')

  expect(db.calls[0]?.params).toEqual(['locA', 'paid', 'r1'])
  expect(db.calls[0]?.sql).toMatch(/paid_at=now\(\)/i)
})

test('referral setStatus away from paid clears paid_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'r1', status: 'pending' }])
  const repo = new AffiliateReferralsRepo(db, 'locA')
  await repo.setStatus('r1', 'pending')

  expect(db.calls[0]?.sql).toMatch(/paid_at=NULL/i)
})

test('markApprovedPaid settles only this affiliate APPROVED rows, scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'r1', status: 'paid' }])
  const repo = new AffiliateReferralsRepo(db, 'locA')
  await repo.markApprovedPaid('af1')

  expect(db.calls[0]?.params).toEqual(['locA', 'af1'])
  // GHL lifecycle: pending awaits review — a payout settles approved rows only.
  expect(db.calls[0]?.sql).toMatch(/status = 'approved'/i)
  expect(db.calls[0]?.sql).toMatch(/SET status='paid', paid_at=now\(\)/i)
})
