import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { ContactsRepo } from '../repos/contacts-repo'
import { LessonCompletionsRepo } from '../repos/lesson-completions-repo'
import { coursesRoute } from './courses'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location + a real contact, behind a middleware that sets the operator
// context the way operatorAuth + locationAccess do in production. Every assertion
// runs against real Postgres (pglite) so the derived aggregates, the unique-slug
// index, and the cascade are all exercised, not mocked.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query('INSERT INTO locations (id, name, slug, branding) VALUES ($1,$2,$3,$4)', [
    loc,
    'Alex — Cash Offers',
    'Alex',
    { color: '#4f46e5' },
  ])
  const contact = await new ContactsRepo(db, loc).upsertByMatch(
    { name: 'Sam Smith', phone: '+16785550142' },
    'seed',
  )

  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', loc)
    await next()
  })
  app.route('/', coursesRoute({ db }))
  return { db, loc, app, contactId: contact.id }
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function createCourse(app: Hono<AppEnv>, body: Record<string, unknown>) {
  const res = await jsonReq(app, '/', 'POST', body)
  return (await res.json()) as { course: { id: string; slug: string; status: string; lessonCount: number } }
}

async function addLesson(app: Hono<AppEnv>, courseId: string, body: Record<string, unknown>) {
  const res = await jsonReq(app, `/${courseId}/lessons`, 'POST', body)
  return (await res.json()) as { lesson: { id: string; position: number; title: string } }
}

test('POST / creates a draft course and derives a slug from the title', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/', 'POST', { title: 'Wholesaling Playbook' })

  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    ok: boolean
    course: { slug: string; status: string; lessonCount: number; summary: { enrollments: number; averagePercent: number; completed: number } }
  }
  expect(body.ok).toBe(true)
  expect(body.course.slug).toBe('wholesaling-playbook')
  expect(body.course.status).toBe('draft') // unpublished until the operator says so
  expect(body.course.lessonCount).toBe(0)
  expect(body.course.summary).toEqual({ enrollments: 0, averagePercent: 0, completed: 0 })
})

test('POST / keeps slugs unique within the location', async () => {
  const { app } = await setup()
  const a = await createCourse(app, { title: 'Wholesaling Playbook' })
  const b = await createCourse(app, { title: 'Wholesaling Playbook' })
  expect(a.course.slug).toBe('wholesaling-playbook')
  expect(b.course.slug).not.toBe(a.course.slug) // a suffix keeps the public URL collision-free
  expect(b.course.slug.startsWith('wholesaling-playbook-')).toBe(true)
})

test('GET / lists courses with a derived lesson count and an honest zero summary', async () => {
  const { app } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook', status: 'published' })
  await addLesson(app, course.id, { title: 'Find sellers' })
  await addLesson(app, course.id, { title: 'Make the offer' })

  const res = await jsonReq(app, '/', 'GET')
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    courses: { id: string; lessonCount: number; summary: { enrollments: number; averagePercent: number } }[]
  }
  const row = body.courses.find((x) => x.id === course.id)
  expect(row?.lessonCount).toBe(2)
  expect(row?.summary.enrollments).toBe(0)
  expect(row?.summary.averagePercent).toBe(0) // no enrollees → honest 0, not a flattering guess
})

test('GET /:id returns the course, its ordered lessons, and enrollments with derived progress + link', async () => {
  const { app, contactId } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook', status: 'published' })
  await addLesson(app, course.id, { title: 'Find sellers', position: 0 })
  await addLesson(app, course.id, { title: 'Make the offer', position: 1 })
  const enroll = (await (await jsonReq(app, `/${course.id}/enroll`, 'POST', { contactId })).json()) as {
    enrollment: { token: string }
  }

  const res = await jsonReq(app, `/${course.id}`, 'GET')
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    course: { id: string }
    lessons: { title: string; position: number }[]
    enrollments: { progress: { total: number; completed: number; percent: number; complete: boolean }; link: string }[]
  }
  expect(body.course.id).toBe(course.id)
  expect(body.lessons.map((l) => l.title)).toEqual(['Find sellers', 'Make the offer'])
  expect(body.enrollments).toHaveLength(1)
  // fresh enrollment: derived 0%, not a stored figure
  expect(body.enrollments[0]?.progress).toEqual({ total: 2, completed: 0, percent: 0, complete: false })
  expect(body.enrollments[0]?.link).toBe(`/api/public/courses/loc_test/${enroll.enrollment.token}`)
})

test('GET /:id is 404 for an unknown course', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/nope', 'GET')
  expect(res.status).toBe(404)
})

test('PATCH /:id publishes a course', async () => {
  const { app } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook' })
  const res = await jsonReq(app, `/${course.id}`, 'PATCH', { status: 'published' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, course: { status: 'published' } })
})

test('PATCH /:id is 404 for an unknown course', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/nope', 'PATCH', { title: 'x' })
  expect(res.status).toBe(404)
})

test('DELETE /:id removes the course and cascades its lessons + enrollments', async () => {
  const { app, db, contactId } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook', status: 'published' })
  await addLesson(app, course.id, { title: 'Find sellers' })
  await jsonReq(app, `/${course.id}/enroll`, 'POST', { contactId })

  const res = await jsonReq(app, `/${course.id}`, 'DELETE')
  expect(res.status).toBe(200)
  expect((await jsonReq(app, `/${course.id}`, 'GET')).status).toBe(404)

  const lessons = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM lessons WHERE course_id=$1', [course.id])
  const enrolls = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM enrollments WHERE course_id=$1', [course.id])
  expect(lessons[0]?.n).toBe(0)
  expect(enrolls[0]?.n).toBe(0)
})

test('POST /:id/lessons appends at the end (position = current lesson count)', async () => {
  const { app } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook' })
  const a = await addLesson(app, course.id, { title: 'Find sellers' })
  const b = await addLesson(app, course.id, { title: 'Make the offer' })
  expect(a.lesson.position).toBe(0)
  expect(b.lesson.position).toBe(1)
})

test('POST /:id/lessons is 404 for an unknown course', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/nope/lessons', 'POST', { title: 'X' })
  expect(res.status).toBe(404)
})

test('PATCH /:id/lessons/:lessonId edits and reorders by position', async () => {
  const { app } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook' })
  await addLesson(app, course.id, { title: 'Find sellers', position: 0 })
  const b = await addLesson(app, course.id, { title: 'Make the offer', position: 1 })

  const res = await jsonReq(app, `/${course.id}/lessons/${b.lesson.id}`, 'PATCH', { position: 0, title: 'Offer first' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, lesson: { position: 0, title: 'Offer first' } })
})

test('PATCH /:id/lessons/:lessonId is 404 when the lesson belongs to another course', async () => {
  const { app } = await setup()
  const one = await createCourse(app, { title: 'One' })
  const two = await createCourse(app, { title: 'Two' })
  const lessonOfOne = await addLesson(app, one.course.id, { title: 'L' })

  const res = await jsonReq(app, `/${two.course.id}/lessons/${lessonOfOne.lesson.id}`, 'PATCH', { title: 'hijack' })
  expect(res.status).toBe(404)
})

test('DELETE /:id/lessons/:lessonId removes a lesson; cross-course delete 404s', async () => {
  const { app } = await setup()
  const one = await createCourse(app, { title: 'One' })
  const two = await createCourse(app, { title: 'Two' })
  const lesson = await addLesson(app, one.course.id, { title: 'L' })

  // wrong course → 404, lesson untouched
  expect((await jsonReq(app, `/${two.course.id}/lessons/${lesson.lesson.id}`, 'DELETE')).status).toBe(404)
  // right course → removed
  expect((await jsonReq(app, `/${one.course.id}/lessons/${lesson.lesson.id}`, 'DELETE')).status).toBe(200)
  const detail = (await (await jsonReq(app, `/${one.course.id}`, 'GET')).json()) as { lessons: unknown[] }
  expect(detail.lessons).toHaveLength(0)
})

test('POST /:id/enroll mints a token, returns the public link, and logs a timeline event (201)', async () => {
  const { app, db, contactId } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook', status: 'published' })
  const res = await jsonReq(app, `/${course.id}/enroll`, 'POST', { contactId })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: boolean; enrollment: { token: string; contact_id: string | null }; link: string }
  expect(body.ok).toBe(true)
  expect(body.enrollment.contact_id).toBe(contactId)
  expect(body.enrollment.token.length).toBeGreaterThanOrEqual(12) // an unguessable nanoid
  expect(body.link).toBe(`/api/public/courses/loc_test/${body.enrollment.token}`)

  const events = await db.query<{ type: string }>('SELECT type FROM timeline_events WHERE contact_id=$1', [contactId])
  expect(events.some((e) => e.type === 'course_enrolled')).toBe(true)
})

test('POST /:id/enroll without a contact mints a generic link and logs nothing', async () => {
  const { app, db } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook', status: 'published' })
  const res = await jsonReq(app, `/${course.id}/enroll`, 'POST', {})

  expect(res.status).toBe(201)
  const body = (await res.json()) as { link: string }
  expect(body.link).toContain('/api/public/courses/loc_test/')
  const events = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM timeline_events', [])
  expect(events[0]?.n).toBe(0)
})

test('POST /:id/enroll is 404 for an unknown course', async () => {
  const { app, contactId } = await setup()
  const res = await jsonReq(app, '/nope/enroll', 'POST', { contactId })
  expect(res.status).toBe(404)
})

test('the course summary is DERIVED from real completions, never a stored number', async () => {
  const { app, db, loc, contactId } = await setup()
  const { course } = await createCourse(app, { title: 'Wholesaling Playbook', status: 'published' })
  const l1 = await addLesson(app, course.id, { title: 'Find sellers', position: 0 })
  const l2 = await addLesson(app, course.id, { title: 'Make the offer', position: 1 })
  // two enrollees: one real contact, one generic link
  const marcus = (await (await jsonReq(app, `/${course.id}/enroll`, 'POST', { contactId })).json()) as {
    enrollment: { id: string }
  }
  await jsonReq(app, `/${course.id}/enroll`, 'POST', {}) // anonymous, 0% throughout

  const completions = new LessonCompletionsRepo(db, loc)
  // Marcus finishes one of two lessons — the student's real action, not the operator's.
  await completions.add(marcus.enrollment.id, l1.lesson.id)

  let summary = (await (await jsonReq(app, '/', 'GET')).json()) as {
    courses: { id: string; summary: { enrollments: number; averagePercent: number; completed: number } }[]
  }
  let row = summary.courses.find((x) => x.id === course.id)
  expect(row?.summary).toEqual({ enrollments: 2, averagePercent: 25, completed: 0 }) // (50 + 0) / 2

  // Marcus finishes the second lesson → now 100% for him; average and completed re-derive.
  await completions.add(marcus.enrollment.id, l2.lesson.id)
  summary = (await (await jsonReq(app, '/', 'GET')).json()) as typeof summary
  row = summary.courses.find((x) => x.id === course.id)
  expect(row?.summary).toEqual({ enrollments: 2, averagePercent: 50, completed: 1 }) // (100 + 0) / 2
})

test('DELETE /:id/enrollments/:enrollId un-enrolls a student; cross-course 404s', async () => {
  const { app, contactId } = await setup()
  const one = await createCourse(app, { title: 'One', status: 'published' })
  const two = await createCourse(app, { title: 'Two', status: 'published' })
  const enroll = (await (await jsonReq(app, `/${one.course.id}/enroll`, 'POST', { contactId })).json()) as {
    enrollment: { id: string }
  }

  // wrong course → 404
  expect((await jsonReq(app, `/${two.course.id}/enrollments/${enroll.enrollment.id}`, 'DELETE')).status).toBe(404)
  // right course → removed
  expect((await jsonReq(app, `/${one.course.id}/enrollments/${enroll.enrollment.id}`, 'DELETE')).status).toBe(200)
  const detail = (await (await jsonReq(app, `/${one.course.id}`, 'GET')).json()) as { enrollments: unknown[] }
  expect(detail.enrollments).toHaveLength(0)
})

