import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Lesson {
  id: string
  location_id: string
  course_id: string
  position: number
  title: string
  content: string | null
  video_url: string | null
  created_at: string
}

export interface LessonInput {
  courseId: string
  title: string
  content?: string | null
  videoUrl?: string | null
  position?: number
}

export interface LessonPatch {
  title?: string
  content?: string | null
  videoUrl?: string | null
  position?: number
}

/**
 * The ordered lessons within a course. `position` carries the sequence the
 * student walks; the operator reorders by patching positions (one update per
 * moved lesson, mirroring how funnel steps reorder). A lesson holds only its own
 * content — whether a given enrollee has *finished* it is recorded separately as
 * a lesson_completion, which is what keeps progress derivable and honest.
 */
export class LessonsRepo extends LocationScopedRepo {
  listByCourse(courseId: string): Promise<Lesson[]> {
    return this.scopedSelect<Lesson>(
      'SELECT * FROM lessons WHERE course_id=$2 ORDER BY position',
      [courseId],
    )
  }

  async get(id: string): Promise<Lesson | undefined> {
    const rows = await this.scopedSelect<Lesson>('SELECT * FROM lessons WHERE id=$2', [id])
    return rows[0]
  }

  /** How many lessons the course holds — the denominator for honest progress. */
  async countByCourse(courseId: string): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM lessons WHERE course_id=$2',
      [courseId],
    )
    return Number(rows[0]?.n ?? 0)
  }

  async create(input: LessonInput): Promise<Lesson> {
    const id = nanoid()
    const rows = await this.scopedWrite<Lesson>(
      `INSERT INTO lessons (id, location_id, course_id, position, title, content, video_url)
       VALUES ($2,$1,$3,$4,$5,$6,$7) RETURNING *`,
      [
        id,
        input.courseId,
        input.position ?? 0,
        input.title,
        input.content ?? null,
        input.videoUrl ?? null,
      ],
    )
    return rows[0]!
  }

  /** Patch only the provided columns. Dynamic SET from $2, id pinned last.
   *  Returns undefined when nothing was provided. */
  async update(id: string, patch: LessonPatch): Promise<Lesson | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.title !== undefined) push('title', patch.title)
    if (patch.content !== undefined) push('content', patch.content)
    if (patch.videoUrl !== undefined) push('video_url', patch.videoUrl)
    if (patch.position !== undefined) push('position', patch.position)
    if (sets.length === 0) return undefined

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Lesson>(
      `UPDATE lessons SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM lessons WHERE location_id=$1 AND id=$2', [id])
  }
}
