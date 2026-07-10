import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { ContactsRepo } from '../repos/contacts-repo'
import { CoursesRepo } from '../repos/courses-repo'
import { EnrollmentsRepo } from '../repos/enrollments-repo'
import { LessonsRepo } from '../repos/lessons-repo'
import { publicCoursesRoute } from './public-courses'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location + published course + two lessons + an enrolled contact, so the
// public GET/complete loop runs against real SQL (the unique completion index,
// the cascade, and the derived-progress contract all in play).
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query('INSERT INTO locations (id, name, slug, branding) VALUES ($1,$2,$3,$4)', [
    loc,
    'Jamal — Cash Offers',
    'jamal',
    { color: '#4f46e5' },
  ])

  const contact = await new ContactsRepo(db, loc).upsertByMatch(
    { name: 'Marcus Webb', phone: '+16785550142' },
    'seed',
  )
  const course = await new CoursesRepo(db, loc).create({
    title: 'Wholesaling Playbook',
    slug: 'wholesaling',
    description: 'Close your first deal.',
    status: 'published',
  })
  const lessonsRepo = new LessonsRepo(db, loc)
  const le1 = await lessonsRepo.create({ courseId: course.id, title: 'Find sellers', content: 'Pull a list.', position: 0 })
  const le2 = await lessonsRepo.create({ courseId: course.id, title: 'Make the offer', content: 'Use the script.', position: 1 })
  const enrollment = await new EnrollmentsRepo(db, loc).create({
    courseId: course.id,
    contactId: contact.id,
    token: 'tok_demo',
  })

  const app = new Hono<AppEnv>()
  app.route('/', publicCoursesRoute({ db }))
  return { db, loc, app, contactId: contact.id, courseId: course.id, le1, le2, enrollmentId: enrollment.id }
}

test('GET /:loc/:token renders the branded player with lessons and 0% progress', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/tok_demo')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('Wholesaling Playbook')
  expect(html).toContain('Jamal — Cash Offers')
  expect(html).toContain('Find sellers')
  expect(html).toContain('Make the offer')
  expect(html).toContain('0%')
  expect(html).toContain('/api/public/courses/loc_test/tok_demo')
})

test('GET /:loc/:token is a styled html 404 for an unknown token', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope')
  expect(res.status).toBe(404)
  expect((await res.text()).toLowerCase()).toContain('not found')
})

test('POST complete records a completion and returns the derived progress', async () => {
  const { app, db, le1 } = await setup()
  const res = await app.request(`/loc_test/tok_demo/lessons/${le1.id}/complete`, { method: 'POST' })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    progress: { total: 2, completed: 1, percent: 50, complete: false },
  })

  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM lesson_completions WHERE enrollment_id IN (SELECT id FROM enrollments WHERE token='tok_demo')",
  )
  expect(rows[0]?.n).toBe(1)
})

test('completing every lesson hits 100% and marks the enrollment completed + logs timeline', async () => {
  const { app, db, le1, le2, contactId } = await setup()
  await app.request(`/loc_test/tok_demo/lessons/${le1.id}/complete`, { method: 'POST' })
  const res = await app.request(`/loc_test/tok_demo/lessons/${le2.id}/complete`, { method: 'POST' })

  expect(await res.json()).toEqual({
    ok: true,
    progress: { total: 2, completed: 2, percent: 100, complete: true },
  })

  const [enr] = await db.query<{ status: string; completed_at: string | null }>(
    "SELECT status, completed_at FROM enrollments WHERE token='tok_demo'",
  )
  expect(enr?.status).toBe('completed')
  expect(enr?.completed_at).toBeTruthy()

  const timeline = await db.query<{ type: string }>('SELECT type FROM timeline_events WHERE contact_id=$1', [contactId])
  expect(timeline.some((t) => t.type === 'course_completed')).toBe(true)
})

test('POST complete is idempotent — re-marking the same lesson never double-counts', async () => {
  const { app, db, le1 } = await setup()
  await app.request(`/loc_test/tok_demo/lessons/${le1.id}/complete`, { method: 'POST' })
  const res = await app.request(`/loc_test/tok_demo/lessons/${le1.id}/complete`, { method: 'POST' })

  expect(await res.json()).toEqual({
    ok: true,
    progress: { total: 2, completed: 1, percent: 50, complete: false },
  })
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM lesson_completions WHERE enrollment_id IN (SELECT id FROM enrollments WHERE token='tok_demo')",
  )
  expect(rows[0]?.n).toBe(1)
})

test('DELETE un-completes a lesson and reopens a finished enrollment', async () => {
  const { app, db, le1, le2 } = await setup()
  await app.request(`/loc_test/tok_demo/lessons/${le1.id}/complete`, { method: 'POST' })
  await app.request(`/loc_test/tok_demo/lessons/${le2.id}/complete`, { method: 'POST' })
  // now fully complete; undo one
  const res = await app.request(`/loc_test/tok_demo/lessons/${le2.id}/complete`, { method: 'DELETE' })

  expect(await res.json()).toEqual({
    ok: true,
    progress: { total: 2, completed: 1, percent: 50, complete: false },
  })
  const [enr] = await db.query<{ status: string; completed_at: string | null }>(
    "SELECT status, completed_at FROM enrollments WHERE token='tok_demo'",
  )
  expect(enr?.status).toBe('active')
  expect(enr?.completed_at).toBeNull()
})

test('POST complete 404s for a lesson that belongs to a different course', async () => {
  const { app, db, loc } = await setup()
  // a second course with its own lesson — not the enrolled one
  const other = await new CoursesRepo(db, loc).create({ title: 'Other', slug: 'other' })
  const otherLesson = await new LessonsRepo(db, loc).create({ courseId: other.id, title: 'X', position: 0 })

  const res = await app.request(`/loc_test/tok_demo/lessons/${otherLesson.id}/complete`, { method: 'POST' })
  expect(res.status).toBe(404)
})

test('POST complete is 404 for an unknown enrollment token', async () => {
  const { app, le1 } = await setup()
  const res = await app.request(`/loc_test/nope/lessons/${le1.id}/complete`, { method: 'POST' })
  expect(res.status).toBe(404)
})

test('a draft (unpublished) course 404s the player and accepts no completions, even with a valid token', async () => {
  const { app, db, courseId, le1 } = await setup()
  await db.query("UPDATE courses SET status='draft' WHERE id=$1", [courseId])

  // the GET player must not render a course still being built
  const view = await app.request('/loc_test/tok_demo')
  expect(view.status).toBe(404)
  expect((await view.text()).toLowerCase()).toContain('not found')

  // and its lessons cannot be marked complete through the public endpoint
  const mark = await app.request(`/loc_test/tok_demo/lessons/${le1.id}/complete`, { method: 'POST' })
  expect(mark.status).toBe(404)

  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM lesson_completions WHERE enrollment_id IN (SELECT id FROM enrollments WHERE token='tok_demo')",
  )
  expect(rows[0]?.n).toBe(0)
})
