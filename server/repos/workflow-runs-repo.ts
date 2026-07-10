import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed'

/** One per-action result in a run's append-only log. */
export interface WorkflowRunStep {
  position: number
  type: string
  status: 'done' | 'skipped' | 'waiting' | 'failed'
  detail: string
}

export interface WorkflowRun {
  id: string
  location_id: string
  workflow_id: string
  contact_id: string | null
  trigger_type: string
  status: string
  steps: WorkflowRunStep[]
  started_at: string
  finished_at: string | null
}

export interface WorkflowRunInput {
  workflowId: string
  contactId: string | null
  triggerType: string
}

export class WorkflowRunsRepo extends LocationScopedRepo {
  async create(input: WorkflowRunInput): Promise<WorkflowRun> {
    const id = nanoid()
    const rows = await this.scopedWrite<WorkflowRun>(
      `INSERT INTO workflow_runs (id, location_id, workflow_id, contact_id, trigger_type)
       VALUES ($2,$1,$3,$4,$5) RETURNING *`,
      [id, input.workflowId, input.contactId, input.triggerType],
    )
    return rows[0]!
  }

  /**
   * Append a single step result to the run's log and set its status. Uses jsonb
   * `||` so it is a read-free atomic concat — never a read-modify-write that could
   * lose a step under the (rare) overlapping resume of a waited workflow.
   */
  async appendStep(
    runId: string,
    step: WorkflowRunStep,
    status: RunStatus,
  ): Promise<WorkflowRun | undefined> {
    const rows = await this.scopedWrite<WorkflowRun>(
      `UPDATE workflow_runs SET steps = steps || $2::jsonb, status = $3
       WHERE location_id = $1 AND id = $4 RETURNING *`,
      [JSON.stringify([step]), status, runId],
    )
    return rows[0]
  }

  async finish(runId: string, status: RunStatus): Promise<WorkflowRun | undefined> {
    const rows = await this.scopedWrite<WorkflowRun>(
      `UPDATE workflow_runs SET status = $2, finished_at = now()
       WHERE location_id = $1 AND id = $3 RETURNING *`,
      [status, runId],
    )
    return rows[0]
  }

  listByWorkflow(workflowId: string, limit = 20): Promise<WorkflowRun[]> {
    return this.scopedSelect<WorkflowRun>(
      'SELECT * FROM workflow_runs WHERE workflow_id=$2 ORDER BY started_at DESC LIMIT $3',
      [workflowId, limit],
    )
  }

  async get(id: string): Promise<WorkflowRun | undefined> {
    const rows = await this.scopedSelect<WorkflowRun>('SELECT * FROM workflow_runs WHERE id=$2', [id])
    return rows[0]
  }
}
