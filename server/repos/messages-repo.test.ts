import { FakeDatabase } from '../db/fake-database'
import { MessagesRepo } from './messages-repo'

const inbound = {
  conversationId: 'conv1',
  contactId: 'c1',
  channel: 'sms',
  provider: 'chatwoot',
  externalId: '991',
  body: 'hi',
}

test('insertInbound returns the row when inserted', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'm1' }])
  const repo = new MessagesRepo(db, 'locA')
  const m = await repo.insertInbound(inbound)
  expect(m?.id).toBe('m1')
  expect(db.calls[0]?.params[1]).toBe('locA')
})

test('insertInbound returns null when (location, provider, external_id) already exists (dedupe)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // ON CONFLICT (location_id, provider, external_id) DO NOTHING -> no row
  const repo = new MessagesRepo(db, 'locA')
  const m = await repo.insertInbound({ ...inbound, body: 'dup' })
  expect(m).toBeNull()
  // dedupe is per-tenant: the conflict target includes location_id so two Chatwoot
  // instances reusing the same numeric id cannot drop each other's distinct message
  expect(db.calls[0]?.sql).toMatch(/ON CONFLICT \(location_id, provider, external_id\)/i)
})

test('insertOutbound persists an outbound message scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'm2', direction: 'outbound' }])
  const repo = new MessagesRepo(db, 'locA')
  const m = await repo.insertOutbound({
    conversationId: 'conv1',
    contactId: 'c1',
    channel: 'sms',
    body: 'reply',
    authorType: 'operator',
    authorId: 'op1',
  })
  expect(m.id).toBe('m2')
  expect(db.calls[0]?.params[1]).toBe('locA')
})
