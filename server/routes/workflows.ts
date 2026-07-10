import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { runWorkflow as realRunWorkflow } from '../jobs/workflow-runner'
import { ACTION_TYPES, TRIGGER_TYPES } from '../lib/automation-vocab'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { WorkflowRunsRepo } from '../repos/workflow-runs-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'

const configSchema = z.record(z.string(), z.unknown())

const createWorkflowSchema = z.object({
  name: z.string().min(1),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: configSchema.optional(),
})

const patchWorkflowSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(['draft', 'live']).optional(),
    triggerType: z.enum(TRIGGER_TYPES).optional(),
    triggerConfig: configSchema.optional(),
  })
  // Reject an empty patch so "no fields" is a 400 (bad request), distinct from
  // a 404 when the workflow genuinely doesn't exist.
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' })

const actionsSchema = z.object({
  actions: z.array(
    z.object({
      type: z.enum(ACTION_TYPES),
      config: configSchema.optional(),
    }),
  ),
})

// A manual test run enrolls one contact. contactId is optional/null so a run can
// be exercised without a contact (contact-dependent steps then skip honestly).
const runSchema = z.object({ contactId: z.string().min(1).nullable().optional() })

/**
 * Automation workflows for the current location. Mounted behind operatorAuth +
 * locationAccess. Covers the builder layer (define a workflow, toggle draft/live,
 * replace its ordered step list) plus execution: POST /:id/run enrolls one
 * contact through the engine (works on a draft too — it's a manual test), and
 * GET /:id/runs returns the honest execution history. The runner is injectable
 * so tests can stub it; prod uses the real engine.
 */
export function workflowsRoute(deps: {
  db: Database
  runWorkflow?: typeof realRunWorkflow
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const runWorkflow = deps.runWorkflow ?? realRunWorkflow

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const workflows = await new WorkflowsRepo(deps.db, loc).list()
    return c.json({ workflows })
  })

  app.post('/', zValidator('json', createWorkflowSchema), async (c) => {
    const loc = c.get('locationId')
    const workflow = await new WorkflowsRepo(deps.db, loc).create(c.req.valid('json'))
    return c.json({ ok: true, workflow }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const workflow = await new WorkflowsRepo(deps.db, loc).get(id)
    if (!workflow) return c.json({ error: 'not found' }, 404)
    const actions = await new WorkflowActionsRepo(deps.db, loc).listByWorkflow(id)
    return c.json({ workflow, actions })
  })

  app.patch('/:id', zValidator('json', patchWorkflowSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const workflow = await new WorkflowsRepo(deps.db, loc).update(id, c.req.valid('json'))
    if (!workflow) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, workflow })
  })

  app.put('/:id/actions', zValidator('json', actionsSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const workflow = await new WorkflowsRepo(deps.db, loc).get(id)
    if (!workflow) return c.json({ error: 'not found' }, 404)
    const actions = await new WorkflowActionsRepo(deps.db, loc).replaceAll(id, c.req.valid('json').actions)
    return c.json({ ok: true, actions })
  })

  // Manual test run: enroll a contact through the engine now, regardless of the
  // workflow's draft/live status. Returns the run record (status reflects reality —
  // a `wait` step leaves it `waiting`).
  app.post('/:id/run', zValidator('json', runSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const workflow = await new WorkflowsRepo(deps.db, loc).get(id)
    if (!workflow) return c.json({ error: 'not found' }, 404)

    const run = await runWorkflow(
      { db: deps.db },
      {
        locationId: loc,
        workflowId: id,
        contactId: c.req.valid('json').contactId ?? null,
        triggerType: workflow.trigger_type,
      },
    )
    return c.json({ ok: true, run }, 201)
  })

  // Execution history for one workflow, newest first.
  app.get('/:id/runs', async (c) => {
    const loc = c.get('locationId')
    const runs = await new WorkflowRunsRepo(deps.db, loc).listByWorkflow(c.req.param('id'))
    return c.json({ runs })
  })

  return app
}
