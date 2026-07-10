import { nanoid } from 'nanoid'
import type { SurveyStatus } from '../lib/survey-vocab'
import { LocationScopedRepo } from './base-repo'

export interface Survey {
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

export interface SurveyInput {
  name: string
  slug: string
  status?: SurveyStatus
  content?: Record<string, unknown>
}

export interface SurveyPatch {
  name?: string
  slug?: string
  content?: Record<string, unknown>
}

/**
 * Multi-step lead-capture surveys for one location. A survey is the sibling of a
 * form (see forms-repo): both store their structure in `content` and keep every
 * submission, but a survey's content holds an ordered `steps:[{...fields}]` so the
 * visitor answers a few questions at a time. The public submit path looks a survey
 * up by location-scoped slug, so `getBySlug` stays tenancy-bound even when called
 * unauthenticated.
 */
export class SurveysRepo extends LocationScopedRepo {
  list(): Promise<Survey[]> {
    return this.scopedSelect<Survey>('SELECT * FROM surveys ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Survey | undefined> {
    const rows = await this.scopedSelect<Survey>('SELECT * FROM surveys WHERE id=$2', [id])
    return rows[0]
  }

  async getBySlug(slug: string): Promise<Survey | undefined> {
    const rows = await this.scopedSelect<Survey>('SELECT * FROM surveys WHERE slug=$2', [slug])
    return rows[0]
  }

  async create(input: SurveyInput): Promise<Survey> {
    const id = nanoid()
    const rows = await this.scopedWrite<Survey>(
      `INSERT INTO surveys (id, location_id, name, slug, status, content)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.name, input.slug, input.status ?? 'draft', JSON.stringify(input.content ?? {})],
    )
    return rows[0]!
  }

  async setStatus(id: string, status: SurveyStatus): Promise<Survey | undefined> {
    const rows = await this.scopedWrite<Survey>(
      `UPDATE surveys SET status=$2, updated_at=now()
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
  async update(id: string, patch: SurveyPatch): Promise<Survey | undefined> {
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
    const rows = await this.scopedWrite<Survey>(
      `UPDATE surveys SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Bump the honest submission counter — called once per real public completion. */
  async incrementSubmissions(id: string): Promise<Survey | undefined> {
    const rows = await this.scopedWrite<Survey>(
      `UPDATE surveys SET submissions = submissions + 1
       WHERE location_id=$1 AND id=$2 RETURNING *`,
      [id],
    )
    return rows[0]
  }
}
