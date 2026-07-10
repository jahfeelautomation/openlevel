import { nanoid } from 'nanoid'
import type { FunnelStepType } from '../lib/funnel-vocab'
import { LocationScopedRepo } from './base-repo'

export interface FunnelStep {
  id: string
  location_id: string
  funnel_id: string
  position: number
  name: string
  type: string
  path: string
  content: Record<string, unknown>
  submissions: number
  created_at: string
}

export interface FunnelStepInput {
  funnelId: string
  name: string
  type: FunnelStepType
  path: string
  content?: Record<string, unknown>
  position?: number
}

export interface FunnelStepPatch {
  name?: string
  type?: FunnelStepType
  path?: string
  content?: Record<string, unknown>
  position?: number
}

export class FunnelStepsRepo extends LocationScopedRepo {
  listByFunnel(funnelId: string): Promise<FunnelStep[]> {
    return this.scopedSelect<FunnelStep>(
      'SELECT * FROM funnel_steps WHERE funnel_id=$2 ORDER BY position',
      [funnelId],
    )
  }

  async get(id: string): Promise<FunnelStep | undefined> {
    const rows = await this.scopedSelect<FunnelStep>('SELECT * FROM funnel_steps WHERE id=$2', [id])
    return rows[0]
  }

  /** Resolve the step a public visitor is on within a funnel (by URL path). */
  async getByPath(funnelId: string, path: string): Promise<FunnelStep | undefined> {
    const rows = await this.scopedSelect<FunnelStep>(
      'SELECT * FROM funnel_steps WHERE funnel_id=$2 AND path=$3',
      [funnelId, path],
    )
    return rows[0]
  }

  async create(input: FunnelStepInput): Promise<FunnelStep> {
    const id = nanoid()
    const rows = await this.scopedWrite<FunnelStep>(
      `INSERT INTO funnel_steps (id, location_id, funnel_id, position, name, type, path, content)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id,
        input.funnelId,
        input.position ?? 0,
        input.name,
        input.type,
        input.path,
        JSON.stringify(input.content ?? {}),
      ],
    )
    return rows[0]!
  }

  /**
   * Patch only the provided columns (content is json-encoded). Dynamic SET from
   * $2, id pinned last. Returns undefined when nothing was provided.
   */
  async update(id: string, patch: FunnelStepPatch): Promise<FunnelStep | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.type !== undefined) push('type', patch.type)
    if (patch.path !== undefined) push('path', patch.path)
    if (patch.content !== undefined) push('content', JSON.stringify(patch.content))
    if (patch.position !== undefined) push('position', patch.position)
    if (sets.length === 0) return undefined

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<FunnelStep>(
      `UPDATE funnel_steps SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Bump the honest submission counter — called once per real public submit. */
  async incrementSubmissions(id: string): Promise<FunnelStep | undefined> {
    const rows = await this.scopedWrite<FunnelStep>(
      `UPDATE funnel_steps SET submissions = submissions + 1
       WHERE location_id=$1 AND id=$2 RETURNING *`,
      [id],
    )
    return rows[0]
  }
}
