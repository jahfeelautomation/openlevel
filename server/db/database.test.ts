import { FakeDatabase } from './fake-database'

test('fake records queries and returns canned rows', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: '1' }])
  const rows = await db.query<{ id: string }>('SELECT 1 WHERE x=$1', ['a'])
  expect(rows).toEqual([{ id: '1' }])
  expect(db.calls[0]).toEqual({ sql: 'SELECT 1 WHERE x=$1', params: ['a'] })
})

test('fake returns empty array when nothing enqueued', async () => {
  const db = new FakeDatabase()
  const rows = await db.query('SELECT 1')
  expect(rows).toEqual([])
  expect(db.calls[0]).toEqual({ sql: 'SELECT 1', params: [] })
})
