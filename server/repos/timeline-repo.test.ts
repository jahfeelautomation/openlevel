import { FakeDatabase } from '../db/fake-database'
import { TimelineRepo } from './timeline-repo'

test('add inserts a timeline event scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', type: 'message' }])
  const repo = new TimelineRepo(db, 'locA')
  const e = await repo.add({ contactId: 'c1', type: 'message', refTable: 'messages', refId: 'm1', payload: { body: 'hi' } })
  expect(e.id).toBe('t1')
  expect(db.calls[0]?.params[1]).toBe('locA')
})

test('listByContact filters by location_id and contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1' }])
  await new TimelineRepo(db, 'locA').listByContact('c1')
  expect(db.calls[0]?.sql.toLowerCase()).toContain('location_id = $1')
  expect(db.calls[0]?.params[0]).toBe('locA')
})
