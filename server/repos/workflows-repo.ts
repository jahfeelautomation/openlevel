import { nanoid } from 'nanoid'
import type { ActionType, TriggerType } from '../lib/automation-vocab'
import { LocationScopedRepo } from './base-repo'

export interface Workflow {
  id: string
  location_id: string
  name: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  status: string
  created_at: string
  updated_at: string
}

export interface WorkflowAction {
  id: string
  location_id: string
  workflow_id: string
  position: number
  type: string
  config: Record<string, unknown>
  created_at: string
}

export interface WorkflowInput {
  name: string
  triggerType: TriggerType
  triggerConfig?: Record<string, unknown>
}

export interface WorkflowPatch {
  name?: string
  status?: string
  triggerType?: TriggerType
  triggerConfig?: Record<string, unknown>
}

export interface WorkflowActionInput {
  type: ActionType
  config?: Record<string, unknown>
}

export class WorkflowsRepo extends LocationScopedRepo {
  list(): Promise<Workflow[]> {
    return this.scopedSelect<Workflow>('SELECT * FROM workflows ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Workflow | undefined> {
    const rows = await this.scopedSelect<Workflow>('SELECT * FROM workflows WHERE id=$2', [id])
    return rows[0]
  }

  /** Live workflows wired to a given trigger — the set the dispatcher enrolls a
   *  contact into when that event fires. Draft workflows never run. */
  listLiveByTrigger(triggerType: TriggerType): Promise<Workflow[]> {
    return this.scopedSelect<Workflow>(
      "SELECT * FROM workflows WHERE status = 'live' AND trigger_type=$2 ORDER BY created_at",
      [triggerType],
    )
  }

  async create(input: WorkflowInput): Promise<Workflow> {
    const id = nanoid()
    const rows = await this.scopedWrite<Workflow>(
      `INSERT INTO workflows (id, location_id, name, trigger_type, trigger_config)
       VALUES ($2,$1,$3,$4,$5) RETURNING *`,
      [id, input.name, input.triggerType, JSON.stringify(input.triggerConfig ?? {})],
    )
    return rows[0]!
  }

  /**
   * Patch only the provided columns. Builds a dynamic SET starting at $2 (since
   * $1 is the location), always bumps updated_at, and pins id as the last param.
   * Returns undefined when nothing was provided (no query issued).
   */
  async update(id: string, patch: WorkflowPatch): Promise<Workflow | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.status !== undefined) push('status', patch.status)
    if (patch.triggerType !== undefined) push('trigger_type', patch.triggerType)
    if (patch.triggerConfig !== undefined)
      push('trigger_config', JSON.stringify(patch.triggerConfig))
    if (sets.length === 0) return undefined

    sets.push('updated_at=now()')
    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Workflow>(
      `UPDATE workflows SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }
}
