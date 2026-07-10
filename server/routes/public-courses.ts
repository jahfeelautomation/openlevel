import { type Context, Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { enrollmentProgress } from '../lib/course-math'
import { renderCourseNotFound, renderCoursePage } from '../lib/course-page'
import { CoursesRepo } from '../repos/courses-repo'
import { EnrollmentsRepo } from '../repos/enrollments-repo'
import { LessonCompletionsRepo } from '../repos/lesson-completions-repo'
import { LessonsRepo } from '../repos/lessons-repo'
import { LocationsRepo } from '../repos/locations-repo'
import { TimelineRepo } from '../repos/timeline-repo'

/**
 * Public, UNAUTHENTICATED course player — mounted at `/api/public/courses` BEFORE
 * the operatorAuth boundary, reading the location from the URL (`:loc`) and the
 * enrollment from its unguessable `:token`:
 *
 *   GET    /:loc/:token                          → the course player (or styled 404)
 *   POST   /:loc/:token/lessons/:lessonId/complete   → record a completion
 *   DELETE /:loc/:token/lessons/:lessonId/complete   → undo a completion
 *
 * A completion is the one real fact stored; the "X% complete" returned by every
 * mutation is DERIVED from the live completion count over the course's lesson
 * count (course-math.ts), so the figure can't be inflated. The enrollment's
 * status follows the derived progress — it flips to completed only at a true 100%
 * and reopens if it ever drops below — so "completed" never lies. A lesson can
 * only be marked through the course it belongs to (cross-course ids 404).
 */
export function publicCoursesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  async function locationMeta(loc: string): Promise<{ name: string; brandColor?: string }> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return {
      name: location?.name ?? 'us',
      brandColor: typeof color === 'string' ? color : undefined,
    }
  }

  app.get('/:loc/:token', async (c) => {
    const loc = c.req.param('loc')
    const token = c.req.param('token')
    const enrollment = await new EnrollmentsRepo(deps.db, loc).getByToken(token)
    if (!enrollment) return c.html(renderCourseNotFound(), 404)

    const course = await new CoursesRepo(deps.db, loc).get(enrollment.course_id)
    // A draft course is still being built; it must not be viewable on the public
    // player even with a valid enrollment token. Treated the same as missing so we
    // never reveal that an unpublished course exists.
    if (!course || course.status !== 'published') return c.html(renderCourseNotFound(), 404)

    const lessons = await new LessonsRepo(deps.db, loc).listByCourse(course.id)
    const completions = await new LessonCompletionsRepo(deps.db, loc).listByEnrollment(enrollment.id)
    const doneSet = new Set(completions.map((x) => x.lesson_id))
    const playerLessons = lessons.map((l) => ({
      id: l.id,
      title: l.title,
      content: l.content,
      videoUrl: l.video_url,
      done: doneSet.has(l.id),
    }))
    const completed = playerLessons.filter((l) => l.done).length
    const progress = enrollmentProgress(completed, lessons.length)

    const meta = await locationMeta(loc)
    return c.html(
      renderCoursePage(enrollment, {
        businessName: meta.name,
        brandColor: meta.brandColor,
        courseTitle: course.title,
        description: course.description,
        lessons: playerLessons,
        progress,
      }),
    )
  })

  /** Shared body for complete (mark) and un-complete (unmark): touch the
   *  completion, then re-derive progress and reconcile the enrollment status. */
  async function applyCompletion(
    c: Context<AppEnv, '/:loc/:token/lessons/:lessonId/complete'>,
    mark: boolean,
  ): Promise<Response> {
    const loc = c.req.param('loc')
    const token = c.req.param('token')
    const lessonId = c.req.param('lessonId')

    const enrollmentsRepo = new EnrollmentsRepo(deps.db, loc)
    const enrollment = await enrollmentsRepo.getByToken(token)
    if (!enrollment) return c.json({ error: 'not found' }, 404)

    // A draft course accepts no completions: it is invisible on the public player,
    // so its lessons can't be marked either. Matches the GET gate above.
    const course = await new CoursesRepo(deps.db, loc).get(enrollment.course_id)
    if (!course || course.status !== 'published') return c.json({ error: 'not found' }, 404)

    // The lesson must belong to this enrollment's course — no cross-course marks.
    const lesson = await new LessonsRepo(deps.db, loc).get(lessonId)
    if (!lesson || lesson.course_id !== enrollment.course_id) {
      return c.json({ error: 'not found' }, 404)
    }

    const completionsRepo = new LessonCompletionsRepo(deps.db, loc)
    if (mark) await completionsRepo.add(enrollment.id, lessonId)
    else await completionsRepo.remove(enrollment.id, lessonId)

    const completed = await completionsRepo.countByEnrollment(enrollment.id)
    const total = await new LessonsRepo(deps.db, loc).countByCourse(enrollment.course_id)
    const progress = enrollmentProgress(completed, total)

    const wasComplete = enrollment.status === 'completed'
    if (progress.complete && !wasComplete) {
      await enrollmentsRepo.markCompleted(enrollment.id)
      if (enrollment.contact_id) {
        await new TimelineRepo(deps.db, loc).add({
          contactId: enrollment.contact_id,
          type: 'course_completed',
          refTable: 'enrollments',
          refId: enrollment.id,
          payload: { courseId: enrollment.course_id },
        })
      }
    } else if (!progress.complete && wasComplete) {
      await enrollmentsRepo.markActive(enrollment.id)
    }

    return c.json({ ok: true, progress })
  }

  app.post('/:loc/:token/lessons/:lessonId/complete', (c) => applyCompletion(c, true))
  app.delete('/:loc/:token/lessons/:lessonId/complete', (c) => applyCompletion(c, false))

  return app
}
