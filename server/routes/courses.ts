import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { courseProgressSummary, enrollmentProgress } from '../lib/course-math'
import { CoursesRepo } from '../repos/courses-repo'
import { EnrollmentsRepo } from '../repos/enrollments-repo'
import { LessonCompletionsRepo } from '../repos/lesson-completions-repo'
import { LessonsRepo } from '../repos/lessons-repo'
import { TimelineRepo } from '../repos/timeline-repo'

// Where the public course player is served (see index.ts: app.route('/api/public/courses', ...)).
// The operator UI shows this per enrollment as the link to send a student.
const PUBLIC_COURSE_BASE = '/api/public/courses'

const createCourseSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().nullish(),
  status: z.enum(['draft', 'published']).optional(),
})

const patchCourseSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().nullish(),
  status: z.enum(['draft', 'published']).optional(),
})

const createLessonSchema = z.object({
  title: z.string().min(1),
  content: z.string().nullish(),
  videoUrl: z.string().nullish(),
  position: z.number().int().min(0).optional(),
})

const patchLessonSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().nullish(),
  videoUrl: z.string().nullish(),
  position: z.number().int().min(0).optional(),
})

const enrollSchema = z.object({
  contactId: z.string().min(1).nullish(),
})

/** A URL-safe slug from a title: lowercased, non-alphanumerics collapsed to a
 *  single dash, trimmed, capped. Falls back to 'course' for an all-symbol title. */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'course'
}

/**
 * Memberships / Courses for the current location. Mounted behind operatorAuth +
 * locationAccess. The Memberships UI reads GET / for the course list — each row
 * carries a `lessonCount` and a `summary` (enrollment count, average percent,
 * completed count) that are DERIVED from real lesson_completions in
 * course-math.ts, never stored. An empty course is an honest zero. GET /:id opens
 * the editor: the course, its ordered lessons, and its enrollments each with the
 * same derived progress and the student's tokenized player link.
 *
 *   POST /                              create a course (draft unless told otherwise)
 *   PATCH /:id                          edit title / slug / description / status
 *   DELETE /:id                         remove a course (cascades its lessons + enrollments)
 *   POST /:id/lessons                   append a lesson (or insert at a position)
 *   PATCH /:id/lessons/:lessonId        edit a lesson / reorder by position
 *   DELETE /:id/lessons/:lessonId       remove a lesson
 *   POST /:id/enroll                    enroll a contact → mint a public player link
 *   DELETE /:id/enrollments/:enrollId   un-enroll a student
 *
 * The operator never marks a lesson finished here — completions only ever come
 * from the student on the public player — so the progress an operator sees is the
 * student's real work, not a number this surface can pad.
 */
export function coursesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** Roll a course up to its operator-card shape: its own row plus the derived
   *  lesson count and enrollment summary. */
  async function summarize(loc: string, courseId: string) {
    const lessonCount = await new LessonsRepo(deps.db, loc).countByCourse(courseId)
    const enrollments = await new EnrollmentsRepo(deps.db, loc).listByCourse(courseId)
    const completions = new LessonCompletionsRepo(deps.db, loc)
    const progresses = []
    for (const e of enrollments) {
      const completed = await completions.countByEnrollment(e.id)
      progresses.push(enrollmentProgress(completed, lessonCount))
    }
    return { lessonCount, summary: courseProgressSummary(progresses) }
  }

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const courses = await new CoursesRepo(deps.db, loc).list()
    const rows = []
    for (const course of courses) {
      rows.push({ ...course, ...(await summarize(loc, course.id)) })
    }
    return c.json({ courses: rows })
  })

  app.post('/', zValidator('json', createCourseSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const repo = new CoursesRepo(deps.db, loc)
    // Derive a slug from the title when none is given, and keep it unique within
    // the location so the public URL never collides with an existing course.
    let slug = input.slug?.trim() || slugify(input.title)
    if (await repo.getBySlug(slug)) slug = `${slug}-${nanoid(4).toLowerCase()}`
    const course = await repo.create({
      title: input.title,
      slug,
      description: input.description ?? null,
      status: input.status,
    })
    return c.json({ ok: true, course: { ...course, lessonCount: 0, summary: courseProgressSummary([]) } }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const course = await new CoursesRepo(deps.db, loc).get(id)
    if (!course) return c.json({ error: 'not found' }, 404)

    const lessons = await new LessonsRepo(deps.db, loc).listByCourse(id)
    const enrollmentRows = await new EnrollmentsRepo(deps.db, loc).listByCourse(id)
    const completions = new LessonCompletionsRepo(deps.db, loc)
    const enrollments = []
    for (const e of enrollmentRows) {
      const completed = await completions.countByEnrollment(e.id)
      enrollments.push({
        ...e,
        progress: enrollmentProgress(completed, lessons.length),
        link: `${PUBLIC_COURSE_BASE}/${loc}/${e.token}`,
      })
    }
    return c.json({ course, lessons, enrollments })
  })

  app.patch('/:id', zValidator('json', patchCourseSchema), async (c) => {
    const loc = c.get('locationId')
    const body = c.req.valid('json')
    const course = await new CoursesRepo(deps.db, loc).update(c.req.param('id'), {
      title: body.title,
      slug: body.slug,
      description: body.description,
      status: body.status,
    })
    if (!course) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, course })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const repo = new CoursesRepo(deps.db, loc)
    const course = await repo.get(c.req.param('id'))
    if (!course) return c.json({ error: 'not found' }, 404)
    await repo.remove(course.id)
    return c.json({ ok: true })
  })

  app.post('/:id/lessons', zValidator('json', createLessonSchema), async (c) => {
    const loc = c.get('locationId')
    const courseId = c.req.param('id')
    const coursesRepo = new CoursesRepo(deps.db, loc)
    const course = await coursesRepo.get(courseId)
    if (!course) return c.json({ error: 'not found' }, 404)

    const input = c.req.valid('json')
    const lessonsRepo = new LessonsRepo(deps.db, loc)
    // Default the new lesson to the end of the list — its position is the current
    // lesson count, so the operator's order is preserved without re-indexing.
    const position = input.position ?? (await lessonsRepo.countByCourse(courseId))
    const lesson = await lessonsRepo.create({
      courseId,
      title: input.title,
      content: input.content ?? null,
      videoUrl: input.videoUrl ?? null,
      position,
    })
    return c.json({ ok: true, lesson }, 201)
  })

  app.patch('/:id/lessons/:lessonId', zValidator('json', patchLessonSchema), async (c) => {
    const loc = c.get('locationId')
    const courseId = c.req.param('id')
    const lessonId = c.req.param('lessonId')
    const lessonsRepo = new LessonsRepo(deps.db, loc)
    // The lesson must belong to the course in the URL — no editing across courses.
    const existing = await lessonsRepo.get(lessonId)
    if (!existing || existing.course_id !== courseId) return c.json({ error: 'not found' }, 404)

    const body = c.req.valid('json')
    const lesson = await lessonsRepo.update(lessonId, {
      title: body.title,
      content: body.content,
      videoUrl: body.videoUrl,
      position: body.position,
    })
    // update() returns undefined only when no fields were supplied — echo the row.
    return c.json({ ok: true, lesson: lesson ?? existing })
  })

  app.delete('/:id/lessons/:lessonId', async (c) => {
    const loc = c.get('locationId')
    const courseId = c.req.param('id')
    const lessonId = c.req.param('lessonId')
    const lessonsRepo = new LessonsRepo(deps.db, loc)
    const existing = await lessonsRepo.get(lessonId)
    if (!existing || existing.course_id !== courseId) return c.json({ error: 'not found' }, 404)
    await lessonsRepo.remove(lessonId)
    return c.json({ ok: true })
  })

  app.post('/:id/enroll', zValidator('json', enrollSchema), async (c) => {
    const loc = c.get('locationId')
    const courseId = c.req.param('id')
    const coursesRepo = new CoursesRepo(deps.db, loc)
    const course = await coursesRepo.get(courseId)
    if (!course) return c.json({ error: 'not found' }, 404)

    const { contactId } = c.req.valid('json')
    const enrollment = await new EnrollmentsRepo(deps.db, loc).create({
      courseId,
      contactId: contactId ?? null,
      token: nanoid(),
    })
    if (enrollment.contact_id) {
      await new TimelineRepo(deps.db, loc).add({
        contactId: enrollment.contact_id,
        type: 'course_enrolled',
        refTable: 'enrollments',
        refId: enrollment.id,
        payload: { courseId },
      })
    }
    return c.json(
      { ok: true, enrollment, link: `${PUBLIC_COURSE_BASE}/${loc}/${enrollment.token}` },
      201,
    )
  })

  app.delete('/:id/enrollments/:enrollId', async (c) => {
    const loc = c.get('locationId')
    const courseId = c.req.param('id')
    const enrollId = c.req.param('enrollId')
    const enrollRepo = new EnrollmentsRepo(deps.db, loc)
    const existing = await enrollRepo.get(enrollId)
    if (!existing || existing.course_id !== courseId) return c.json({ error: 'not found' }, 404)
    await enrollRepo.remove(enrollId)
    return c.json({ ok: true })
  })

  return app
}
