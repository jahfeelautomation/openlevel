import { FakeDatabase } from '../db/fake-database'
import { CallsRepo } from './calls-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'call1', location_id: 'locA' }])
  const repo = new CallsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'call1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single call scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'call1' }])
  const repo = new CallsRepo(db, 'locA')

  await repo.get('call1')
  expect(db.calls[0]?.params).toEqual(['locA', 'call1'])
})

test('create records a placed call with location $1 and the provider call id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'call_new', location_id: 'locA', status: 'queued' }])
  const repo = new CallsRepo(db, 'locA')

  await repo.create({
    contactId: 'c1',
    direction: 'outbound',
    fromNumber: '+14805550111',
    toNumber: '+16025550123',
    provider: 'twilio',
    externalId: 'CA_1',
  })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA')
  expect(params).toContain('c1')
  expect(params).toContain('outbound')
  expect(params).toContain('+14805550111')
  expect(params).toContain('+16025550123')
  expect(params).toContain('queued') // honest default — nothing has happened yet
  expect(params).toContain('twilio')
  expect(params).toContain('CA_1')
})

test('upsertExternal dedupes on (location_id, provider, external_id) and reports insert vs update', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'call_new', location_id: 'locA', provider: 'vapi', external_id: 'cv_1', inserted: true }])
  const repo = new CallsRepo(db, 'locA')

  const out = await repo.upsertExternal({
    provider: 'vapi',
    externalId: 'cv_1',
    direction: 'inbound',
    status: 'ringing',
    fromNumber: '+16025550123',
  })

  expect(out.inserted).toBe(true)
  expect(out.call.id).toBe('call_new')
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO calls/i)
  expect(call?.sql).toMatch(/ON CONFLICT \(location_id, provider, external_id\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('cv_1')
  expect(call?.params).toContain('vapi')
  expect(call?.params).toContain('ringing')
})

test('upsertExternal refuses to drag a terminal status back and keeps known facts', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'call_old', location_id: 'locA', inserted: false }])
  const repo = new CallsRepo(db, 'locA')

  const out = await repo.upsertExternal({
    provider: 'twilio',
    externalId: 'CA_1',
    direction: 'outbound',
    status: 'ringing', // a late, out-of-order delivery
  })

  expect(out.inserted).toBe(false)
  const sql = db.calls[0]?.sql
  // Terminal statuses win over any later/replayed delivery...
  expect(sql).toMatch(/CASE WHEN calls\.status IN \('completed','failed','busy','no-answer'\)/i)
  // ...and an event with no news never erases what the log already knows.
  expect(sql).toMatch(/duration_seconds = COALESCE\(EXCLUDED\.duration_seconds, calls\.duration_seconds\)/i)
  expect(sql).toMatch(/transcript = COALESCE\(EXCLUDED\.transcript, calls\.transcript\)/i)
  expect(sql).toMatch(/recording_url = COALESCE\(EXCLUDED\.recording_url, calls\.recording_url\)/i)
  expect(sql).toMatch(/summary = COALESCE\(EXCLUDED\.summary, calls\.summary\)/i)
  // Placement-time facts (contact link, direction, numbers) are never overwritten.
  expect(sql).not.toMatch(/contact_id\s*=\s*EXCLUDED/i)
  expect(sql).not.toMatch(/direction\s*=\s*EXCLUDED/i)
})
