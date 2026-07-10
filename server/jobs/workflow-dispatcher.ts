import type { TriggerType } from '../lib/automation-vocab'
import type { WorkflowRun } from '../repos/workflow-runs-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import { type WorkflowRunnerDeps, runWorkflow } from './workflow-runner'

/**
 * A real thing that happened in a location — a contact was created, a message
 * came in, an opportunity opened. The dispatcher turns it into workflow runs.
 */
export interface WorkflowEvent {
  locationId: string
  triggerType: TriggerType
  contactId: string | null
}

/**
 * What a route calls when something happens that workflows can trigger on. In
 * prod this enqueues a `workflow.dispatch` pg-boss job (durable, off the request
 * path); in dev/tests it runs the dispatch in-process. Routes depend on this
 * shape, not on pg-boss, so they stay pure.
 */
export type WorkflowDispatch = (event: WorkflowEvent) => void | Promise<void>

/**
 * Fan one event out to every live workflow wired to that trigger, starting an
 * honest run for each. Draft workflows are ignored (only `status = 'live'`
 * fires). Returns the runs it started so callers/tests can inspect them; an
 * event with no matching live workflow is a no-op that returns `[]`.
 *
 * Runs are started sequentially to keep ordering deterministic and avoid a
 * thundering herd on the shared DB; each run is itself cheap (a handful of
 * scoped queries) and a `wait` step defers via the scheduler rather than
 * blocking here.
 */
export async function dispatchWorkflowEvent(
  deps: WorkflowRunnerDeps,
  event: WorkflowEvent,
): Promise<WorkflowRun[]> {
  const live = await new WorkflowsRepo(deps.db, event.locationId).listLiveByTrigger(
    event.triggerType,
  )

  const runs: WorkflowRun[] = []
  for (const workflow of live) {
    runs.push(
      await runWorkflow(deps, {
        locationId: event.locationId,
        workflowId: workflow.id,
        contactId: event.contactId,
        triggerType: event.triggerType,
      }),
    )
  }
  return runs
}
