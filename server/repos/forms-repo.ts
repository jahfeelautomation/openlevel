import { nanoid } from 'nanoid'
import type { FormStatus } from '../lib/form-vocab'
import { LocationScopedRepo } from './base-repo'

export interface Form {
  id: string
  location_id: string
  name: string
  slug: string
  status: string
  content: Record<string, unknown>
  submissions: number
  created_at: string
  updated_at: string
}

export interface FormInput {
  name: string
  slug: string
  status?: FormStatus
  content?: Record<string, unknown>
}

export interface FormPatch {
  name?: string
  slug?: string
  content?: Record<string, unknown>
}

/**
 * Standalone lead-capture forms for one location. A form is single-page (its
 * structure lives in `content`), unlike a funnel which is an ordered set of
 * steps. The public submit path looks a form up by location-scoped slug, so
 * `getBySlug` stays tenancy-bound even when called unauthenticated.
 */
export class FormsRepo extends LocationScopedRepo {
  list(): Promise<Form[]> {
    return this.scopedSelect<Form>('SELECT * FROM forms ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Form | undefined> {
    const rows = await this.scopedSelect<Form>('SELECT * FROM forms WHERE id=$2', [id])
    return rows[0]
  }

  async getBySlug(slug: string): Promise<Form | undefined> {
    const rows = await this.scopedSelect<Form>('SELECT * FROM forms WHERE slug=$2', [slug])
    return rows[0]
  }

  async create(input: FormInput): Promise<Form> {
    const id = nanoid()
    const rows = await this.scopedWrite<Form>(
      `INSERT INTO forms (id, location_id, name, slug, status, content)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.name, input.slug, input.status ?? 'draft', JSON.stringify(input.content ?? {})],
    )
    return rows[0]!
  }

  async setStatus(id: string, status: FormStatus): Promise<Form | undefined> {
    const rows = await this.scopedWrite<Form>(
      `UPDATE forms SET status=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [status, id],
    )
    return rows[0]
  }

  /**
   * Patch only the provided columns (content is json-encoded). Dynamic SET from
   * $2, always bumps updated_at, id pinned last. Returns undefined when nothing
   * was provided (no query issued).
   */
  async update(id: string, patch: FormPatch): Promise<Form | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.slug !== undefined) push('slug', patch.slug)
    if (patch.content !== undefined) push('content', JSON.stringify(patch.content))
    if (sets.length === 0) return undefined

    sets.push('updated_at=now()')
    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Form>(
      `UPDATE forms SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Bump the honest submission counter — called once per real public submit. */
  async incrementSubmissions(id: string): Promise<Form | undefined> {
    const rows = await this.scopedWrite<Form>(
      `UPDATE forms SET submissions = submissions + 1
       WHERE location_id=$1 AND id=$2 RETURNING *`,
      [id],
    )
    return rows[0]
  }
}
