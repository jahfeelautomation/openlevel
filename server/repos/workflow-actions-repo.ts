import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'
import type { WorkflowAction, WorkflowActionInput } from './workflows-repo'

export class WorkflowActionsRepo extends LocationScopedRepo {
  listByWorkflow(workflowId: string): Promise<WorkflowAction[]> {
    return this.scopedSelect<WorkflowAction>(
      'SELECT * FROM workflow_actions WHERE workflow_id=$2 ORDER BY position',
      [workflowId],
    )
  }

  /**
   * Replace a workflow's entire ordered step list in ONE atomic statement: a
   * data-modifying CTE clears the existing rows, then the main INSERT writes the
   * new ones. Doing it as a single statement means a failing INSERT can never
   * leave the workflow with the old steps deleted and no new ones — the editor's
   * save is all-or-nothing. (A separate DELETE-then-INSERT could strand a
   * workflow with zero steps if the insert threw.) position is the array index,
   * inlined as an integer literal (we control it); id/type/config are bound
   * params. $1 (location) and $2 (workflow_id) are reused across every group.
   *
   * Safe as one statement because the new rows carry fresh ids (the PK) and the
   * only other index on (location_id, workflow_id, position) is non-unique — so
   * the INSERT, which under a single snapshot does not see the CTE's delete,
   * never collides with the rows still being cleared.
   */
  async replaceAll(
    workflowId: string,
    actions: WorkflowActionInput[],
  ): Promise<WorkflowAction[]> {
    // Nothing to insert: a bare DELETE clears the list (no rows to RETURNING).
    if (actions.length === 0) {
      await this.scopedWrite(
        'DELETE FROM workflow_actions WHERE location_id=$1 AND workflow_id=$2',
        [workflowId],
      )
      return []
    }

    const extra: unknown[] = [workflowId]
    const groups: string[] = []
    actions.forEach((action, i) => {
      const idIdx = 3 + i * 3 // $3, $6, $9, ...
      const typeIdx = 4 + i * 3 // $4, $7, $10, ...
      const configIdx = 5 + i * 3 // $5, $8, $11, ...
      extra.push(nanoid(), action.type, JSON.stringify(action.config ?? {}))
      groups.push(`($${idIdx},$1,$2,${i},$${typeIdx},$${configIdx})`)
    })
    return this.scopedWrite<WorkflowAction>(
      `WITH cleared AS (
         DELETE FROM workflow_actions WHERE location_id=$1 AND workflow_id=$2
       )
       INSERT INTO workflow_actions (id, location_id, workflow_id, position, type, config)
       VALUES ${groups.join(',')} RETURNING *`,
      extra,
    )
  }
}
