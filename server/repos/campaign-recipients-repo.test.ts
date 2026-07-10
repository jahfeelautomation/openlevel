import { FakeDatabase } from '../db/fake-database'
import { CampaignRecipientsRepo } from './campaign-recipients-repo'

test('bulkInsert builds one value group per contact, reusing $1/$2', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'r1' }, { id: 'r2' }])
  const repo = new CampaignRecipientsRepo(db, 'locA')

  await repo.bulkInsert('cmp1', ['c1', 'c2'])
  const call = db.calls[0]!
  // location is $1, campaign is $2, then (id, contact) pairs from $3 up.
  expect(call.params[0]).toBe('locA')
  expect(call.params[1]).toBe('cmp1')
  expect(call.params).toContain('c1')
  expect(call.params).toContain('c2')
  expect(call.sql).toContain('($3,$1,$2,$4)')
  expect(call.sql).toContain('($5,$1,$2,$6)')
})

test('bulkInsert is a no-op on an empty audience (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new CampaignRecipientsRepo(db, 'locA')

  const out = await repo.bulkInsert('cmp1', [])
  expect(out).toEqual([])
  expect(db.calls).toHaveLength(0)
})

test('bulkInsertOutcomes records each contact with its real delivery status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'r1' }, { id: 'r2' }])
  const repo = new CampaignRecipientsRepo(db, 'locA')

  await repo.bulkInsertOutcomes('cmp1', [
    { contactId: 'c1', status: 'sent' },
    { contactId: 'c2', status: 'skipped' },
  ])
  const call = db.calls[0]!
  // location is $1, campaign is $2, then (id, contact, status) triples from $3 up.
  expect(call.params[0]).toBe('locA')
  expect(call.params[1]).toBe('cmp1')
  expect(call.params).toContain('c1')
  expect(call.params).toContain('skipped')
  expect(call.sql).toContain('($3,$1,$2,$4,$5)')
  expect(call.sql).toContain('($6,$1,$2,$7,$8)')
})

test('bulkInsertOutcomes is a no-op on an empty outcome list (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new CampaignRecipientsRepo(db, 'locA')

  const out = await repo.bulkInsertOutcomes('cmp1', [])
  expect(out).toEqual([])
  expect(db.calls).toHaveLength(0)
})

test('listByCampaign scopes to location + campaign', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'r1' }])
  const repo = new CampaignRecipientsRepo(db, 'locA')

  await repo.listByCampaign('cmp1')
  expect(db.calls[0]?.params).toEqual(['locA', 'cmp1'])
})
