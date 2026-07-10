import { FakeDatabase } from '../db/fake-database'
import { ConversationsRepo } from './conversations-repo'

test('upsertByExternal returns existing conversation when external id matches', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'conv1' }]) // single atomic INSERT ... ON CONFLICT DO UPDATE RETURNING
  const repo = new ConversationsRepo(db, 'locA')
  const c = await repo.upsertByExternal({ provider: 'chatwoot', externalId: '55', contactId: 'c1', channel: 'sms' })
  expect(c.id).toBe('conv1')
  expect(db.calls).toHaveLength(1)
})

test('upsertByExternal inserts in one atomic statement, scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'conv2', location_id: 'locA' }]) // one INSERT ... ON CONFLICT RETURNING
  const repo = new ConversationsRepo(db, 'locA')
  const c = await repo.upsertByExternal({ provider: 'chatwoot', externalId: '99', contactId: 'c1', channel: 'sms' })
  expect(c.id).toBe('conv2')
  expect(db.calls).toHaveLength(1) // no SELECT-then-INSERT race window
  expect(db.calls[0]?.params[1]).toBe('locA') // $2 = location_id ($1 is id)
  expect(db.calls[0]?.sql).toMatch(/ON CONFLICT \(location_id, provider, external_id\)/i)
})
