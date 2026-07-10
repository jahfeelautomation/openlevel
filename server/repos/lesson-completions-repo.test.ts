import { FakeDatabase } from '../db/fake-database'
import { LessonCompletionsRepo } from './lesson-completions-repo'

test('listByEnrollment scopes to location + enrollment', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'lc1', enrollment_id: 'en1', lesson_id: 'le1' }])
  const repo = new LessonCompletionsRepo(db, 'locA')

  await repo.listByEnrollment('en1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND enrollment_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'en1'])
})

test('countByEnrollment returns the integer completion count, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 3 }])
  const repo = new LessonCompletionsRepo(db, 'locA')

  const n = await repo.countByEnrollment('en1')
  expect(n).toBe(3)
  expect(db.calls[0]?.sql).toMatch(/SELECT COUNT\(\*\)::int AS n FROM lesson_completions/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND enrollment_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'en1'])
})

test('add inserts location $1 with an idempotent ON CONFLICT guard', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new LessonCompletionsRepo(db, 'locA')

  await repo.add('en1', 'le1')
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO lesson_completions/i)
  expect(call?.sql).toMatch(/ON CONFLICT \(enrollment_id, lesson_id\) DO NOTHING/i)
  expect(call?.params?.[0]).toBe('locA') // location_id is $1
  expect(call?.params).toContain('en1')
  expect(call?.params).toContain('le1')
})

test('remove deletes one completion scoped to location + enrollment + lesson', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new LessonCompletionsRepo(db, 'locA')

  await repo.remove('en1', 'le1')
  expect(db.calls[0]?.sql).toMatch(
    /DELETE FROM lesson_completions\s+WHERE location_id=\$1 AND enrollment_id=\$2 AND lesson_id=\$3/i,
  )
  expect(db.calls[0]?.params).toEqual(['locA', 'en1', 'le1'])
})
