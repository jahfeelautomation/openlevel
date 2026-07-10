import { FakeDatabase } from '../db/fake-database'
import { ReviewRequestsRepo } from './review-requests-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rq1', location_id: 'locA' }])
  const repo = new ReviewRequestsRepo(db, 'locA')

  await repo.list()
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('getByToken finds a request scoped to location + token', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rq1', token: 'tok_abc' }])
  const repo = new ReviewRequestsRepo(db, 'locA')

  await repo.getByToken('tok_abc')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND token=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'tok_abc'])
})

test('create sets location $1, defaults channel, starts pending + stamps sent_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rq_new', location_id: 'locA', status: 'pending' }])
  const repo = new ReviewRequestsRepo(db, 'locA')

  await repo.create({ contactId: 'c1', token: 'tok_xyz' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO review_requests/i)
  expect(call?.sql).toMatch(/'pending'/i)
  expect(call?.sql).toMatch(/sent_at/i)
  expect(call?.params?.[0]).toBe('locA') // location_id is $1
  expect(call?.params).toContain('c1')
  expect(call?.params).toContain('sms') // default channel
  expect(call?.params).toContain('tok_xyz')
})

test('create honors an explicit channel (e.g. email)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rq_new' }])
  const repo = new ReviewRequestsRepo(db, 'locA')

  await repo.create({ contactId: 'c1', channel: 'email', token: 't' })
  expect(db.calls[0]?.params).toContain('email')
})

test('markCompleted flips to completed and stamps completed_at, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'rq1', status: 'completed' }])
  const repo = new ReviewRequestsRepo(db, 'locA')

  await repo.markCompleted('rq1')
  expect(db.calls[0]?.sql).toMatch(/SET status='completed'/i)
  expect(db.calls[0]?.sql).toMatch(/completed_at=now\(\)/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'rq1'])
})
