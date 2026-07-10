import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface LessonCompletion {
  id: string
  location_id: string
  enrollment_id: string
  lesson_id: string
  completed_at: string
}

/**
 * The single honest fact behind every progress figure: "this enrollee finished
 * this lesson." A unique index on (enrollment_id, lesson_id) makes `add`
 * idempotent — re-marking a lesson can never inflate the count — and the
 * lesson_id foreign key cascades, so deleting a lesson removes its completions
 * too and the derived percentage stays truthful. Nothing here computes progress;
 * it just stores what actually happened. course-math.ts turns these counts into
 * the "62% complete" the operator and student see.
 */
export class LessonCompletionsRepo extends LocationScopedRepo {
  listByEnrollment(enrollmentId: string): Promise<LessonCompletion[]> {
    return this.scopedSelect<LessonCompletion>(
      'SELECT * FROM lesson_completions WHERE enrollment_id=$2',
      [enrollmentId],
    )
  }

  /** Numerator for honest progress — how many lessons this enrollee has finished.
   *  Cascade-deletes keep it from ever exceeding the course's live lesson count. */
  async countByEnrollment(enrollmentId: string): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM lesson_completions WHERE enrollment_id=$2',
      [enrollmentId],
    )
    return Number(rows[0]?.n ?? 0)
  }

  /** Record a completion. Idempotent: a second mark of the same lesson hits the
   *  unique index and is silently ignored, so progress can't be double-counted. */
  async add(enrollmentId: string, lessonId: string): Promise<void> {
    const id = nanoid()
    await this.scopedWrite(
      `INSERT INTO lesson_completions (id, location_id, enrollment_id, lesson_id)
       VALUES ($2,$1,$3,$4)
       ON CONFLICT (enrollment_id, lesson_id) DO NOTHING`,
      [id, enrollmentId, lessonId],
    )
  }

  /** Undo a completion (the student un-checks a lesson). Scoped to the location. */
  async remove(enrollmentId: string, lessonId: string): Promise<void> {
    await this.scopedWrite(
      `DELETE FROM lesson_completions
       WHERE location_id=$1 AND enrollment_id=$2 AND lesson_id=$3`,
      [enrollmentId, lessonId],
    )
  }
}
