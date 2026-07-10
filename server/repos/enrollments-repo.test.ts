import { FakeDatabase } from '../db/fake-database'
import { EnrollmentsRepo } from './enrollments-repo'

test('listByCourse scopes to location + course, newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'en1', course_id: 'co1' }])
  const repo = new EnrollmentsRepo(db, 'locA')

  await repo.listByCourse('co1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND course_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'co1'])
})

test('getByToken finds an enrollment scoped to location + token', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'en1', token: 'tok_abc' }])
  const repo = new EnrollmentsRepo(db, 'locA')

  await repo.getByToken('tok_abc')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND token=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'tok_abc'])
})

test('create sets location $1, course $3, starts active + stamps enrolled_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'en_new', location_id: 'locA', status: 'active' }])
  const repo = new EnrollmentsRepo(db, 'locA')

  await repo.create({ courseId: 'co1', contactId: 'c1', token: 'tok_xyz' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO enrollments/i)
  expect(call?.sql).toMatch(/'active'/i)
  expect(call?.sql).toMatch(/enrolled_at/i)
  expect(call?.params?.[0]).toBe('locA') // location_id is $1
  expect(call?.params).toContain('co1')
  expect(call?.params).toContain('c1')
  expect(call?.params).toContain('tok_xyz')
})

test('create allows a contactless enrollment (generic link)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'en_new' }])
  const repo = new EnrollmentsRepo(db, 'locA')

  await repo.create({ courseId: 'co1', token: 't' })
  expect(db.calls[0]?.params).toContain(null) // contact_id defaults to null
})

test('markCompleted flips to completed and stamps completed_at, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'en1', status: 'completed' }])
  const repo = new EnrollmentsRepo(db, 'locA')

  await repo.markCompleted('en1')
  expect(db.calls[0]?.sql).toMatch(/SET status='completed'/i)
  expect(db.calls[0]?.sql).toMatch(/completed_at=now\(\)/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'en1'])
})

test('markActive reopens and clears completed_at, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'en1', status: 'active' }])
  const repo = new EnrollmentsRepo(db, 'locA')

  await repo.markActive('en1')
  expect(db.calls[0]?.sql).toMatch(/SET status='active'/i)
  expect(db.calls[0]?.sql).toMatch(/completed_at=NULL/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'en1'])
})

test('remove deletes one enrollment scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new EnrollmentsRepo(db, 'locA')

  await repo.remove('en1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM enrollments WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'en1'])
})
