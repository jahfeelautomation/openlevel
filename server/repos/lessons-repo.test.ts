import { FakeDatabase } from '../db/fake-database'
import { LessonsRepo } from './lessons-repo'

test('listByCourse scopes to location + course, ordered by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'le1', course_id: 'co1' }])
  const repo = new LessonsRepo(db, 'locA')

  await repo.listByCourse('co1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND course_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY position/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'co1'])
})

test('get reads one lesson scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'le1' }])
  const repo = new LessonsRepo(db, 'locA')

  await repo.get('le1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'le1'])
})

test('countByCourse returns the integer lesson count, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 4 }])
  const repo = new LessonsRepo(db, 'locA')

  const n = await repo.countByCourse('co1')
  expect(n).toBe(4)
  expect(db.calls[0]?.sql).toMatch(/SELECT COUNT\(\*\)::int AS n FROM lessons/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND course_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'co1'])
})

test('create sets location $1, course $3, defaults position 0 + nulls', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'le_new', location_id: 'locA' }])
  const repo = new LessonsRepo(db, 'locA')

  await repo.create({ courseId: 'co1', title: 'Find motivated sellers' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO lessons/i)
  expect(call?.params?.[0]).toBe('locA') // location_id is $1
  expect(call?.params).toContain('co1')
  expect(call?.params).toContain('Find motivated sellers')
  expect(call?.params).toContain(0) // default position
})

test('update patches only supplied fields, scoped, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'le1' }])
  const repo = new LessonsRepo(db, 'locA')

  await repo.update('le1', { title: 'New title', position: 2 })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE lessons SET title=\$2, position=\$3/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1 AND id=\$4/i)
  expect(call?.params).toEqual(['locA', 'New title', 2, 'le1'])
})

test('update maps videoUrl to the video_url column', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'le1' }])
  const repo = new LessonsRepo(db, 'locA')

  await repo.update('le1', { videoUrl: 'https://v/x' })
  expect(db.calls[0]?.sql).toMatch(/SET video_url=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'https://v/x', 'le1'])
})

test('update with no fields makes no query and returns undefined', async () => {
  const db = new FakeDatabase()
  const repo = new LessonsRepo(db, 'locA')

  const out = await repo.update('le1', {})
  expect(out).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('remove deletes scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new LessonsRepo(db, 'locA')

  await repo.remove('le1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM lessons WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'le1'])
})
