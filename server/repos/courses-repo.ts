import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type CourseStatus = 'draft' | 'published'

export interface Course {
  id: string
  location_id: string
  title: string
  slug: string
  description: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface CourseInput {
  title: string
  slug: string
  description?: string | null
  status?: CourseStatus
}

export interface CoursePatch {
  title?: string
  slug?: string
  description?: string | null
  status?: CourseStatus
}

/**
 * Courses for one location — the container a body of lessons hangs off of. A
 * course is only ever a draft until the operator publishes it; an enrollee never
 * sees a draft. The headline "62% complete" lives nowhere on this row — it is
 * derived from real lesson completions in course-math.ts — so this repo only owns
 * the course's own facts (title, slug, status). `getBySlug` powers a stable,
 * human-readable public URL, still bound to the location so it stays tenancy-safe.
 */
export class CoursesRepo extends LocationScopedRepo {
  list(): Promise<Course[]> {
    return this.scopedSelect<Course>('SELECT * FROM courses ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Course | undefined> {
    const rows = await this.scopedSelect<Course>('SELECT * FROM courses WHERE id=$2', [id])
    return rows[0]
  }

  async getBySlug(slug: string): Promise<Course | undefined> {
    const rows = await this.scopedSelect<Course>('SELECT * FROM courses WHERE slug=$2', [slug])
    return rows[0]
  }

  async create(input: CourseInput): Promise<Course> {
    const id = nanoid()
    const rows = await this.scopedWrite<Course>(
      `INSERT INTO courses (id, location_id, title, slug, description, status)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.title, input.slug, input.description ?? null, input.status ?? 'draft'],
    )
    return rows[0]!
  }

  /** Patch the supplied fields only; always refresh updated_at. Returns the row
   *  (scoped to this location) or undefined if it isn't ours. `scopedWrite`
   *  prepends locationId as $1, so the dynamic params number from $2. */
  async update(id: string, patch: CoursePatch): Promise<Course | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.title !== undefined) bind('title', patch.title)
    if (patch.slug !== undefined) bind('slug', patch.slug)
    if (patch.description !== undefined) bind('description', patch.description)
    if (patch.status !== undefined) bind('status', patch.status)
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<Course>(
      `UPDATE courses SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM courses WHERE location_id=$1 AND id=$2', [id])
  }
}
