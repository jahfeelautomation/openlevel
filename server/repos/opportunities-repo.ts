import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Opportunity {
  id: string
  location_id: string
  pipeline_id: string
  stage_id: string
  contact_id: string | null
  name: string
  value_cents: number
  status: string
  source: string | null
  assignee: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface OpportunityInput {
  pipelineId: string
  stageId: string
  name: string
  contactId?: string | null
  valueCents?: number
  source?: string | null
  assignee?: string | null
}

export interface OpportunityPatch {
  name?: string
  valueCents?: number
  contactId?: string | null
  source?: string | null
  assignee?: string | null
}

export class OpportunitiesRepo extends LocationScopedRepo {
  listByPipeline(pipelineId: string): Promise<Opportunity[]> {
    return this.scopedSelect<Opportunity>(
      'SELECT * FROM opportunities WHERE pipeline_id=$2 ORDER BY position, created_at DESC',
      [pipelineId],
    )
  }

  async get(id: string): Promise<Opportunity | undefined> {
    const rows = await this.scopedSelect<Opportunity>('SELECT * FROM opportunities WHERE id=$2', [id])
    return rows[0]
  }

  async create(input: OpportunityInput): Promise<Opportunity> {
    const id = nanoid()
    const rows = await this.scopedWrite<Opportunity>(
      `INSERT INTO opportunities
        (id, location_id, pipeline_id, stage_id, contact_id, name, value_cents, source, assignee)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id,
        input.pipelineId,
        input.stageId,
        input.contactId ?? null,
        input.name,
        input.valueCents ?? 0,
        input.source ?? null,
        input.assignee ?? null,
      ],
    )
    return rows[0]!
  }

  /** Move a card to another stage (the kanban drag-drop). */
  async move(id: string, stageId: string): Promise<Opportunity | undefined> {
    const rows = await this.scopedWrite<Opportunity>(
      `UPDATE opportunities SET stage_id=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [stageId, id],
    )
    return rows[0]
  }

  async setStatus(id: string, status: string): Promise<Opportunity | undefined> {
    const rows = await this.scopedWrite<Opportunity>(
      `UPDATE opportunities SET status=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [status, id],
    )
    return rows[0]
  }

  /**
   * Partial field edit. Only the keys actually provided are written, so passing
   * contactId / source / assignee = null genuinely CLEARS them (detach the
   * contact, drop the source, unassign). The old COALESCE form could never clear
   * a column — null meant "keep the current value" — so a deliberate detach was
   * silently ignored. An absent key (undefined) is left untouched. updated_at
   * always bumps, so an empty patch is a no-op touch that still returns the row
   * (or undefined when the id is not in this location). Columns are numbered from
   * $2 because $1 is the location; id is pinned last.
   */
  async update(id: string, patch: OpportunityPatch): Promise<Opportunity | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.valueCents !== undefined) push('value_cents', patch.valueCents)
    if (patch.contactId !== undefined) push('contact_id', patch.contactId)
    if (patch.source !== undefined) push('source', patch.source)
    if (patch.assignee !== undefined) push('assignee', patch.assignee)
    sets.push('updated_at=now()')

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Opportunity>(
      `UPDATE opportunities SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }
}
