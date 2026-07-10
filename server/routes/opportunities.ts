import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { OpportunitiesRepo } from '../repos/opportunities-repo'
import { PipelinesRepo } from '../repos/pipelines-repo'

const createSchema = z.object({
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  name: z.string().min(1),
  contactId: z.string().nullable().optional(),
  valueCents: z.number().int().nonnegative().optional(),
  source: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
})

const patchSchema = z.object({
  stageId: z.string().min(1).optional(),
  status: z.enum(['open', 'won', 'lost', 'abandoned']).optional(),
  name: z.string().min(1).optional(),
  valueCents: z.number().int().nonnegative().optional(),
  contactId: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
})

/**
 * Opportunities + pipelines for the current location. Mounted behind
 * operatorAuth + locationAccess. The kanban board reads GET /pipelines (stages
 * nested) and GET /?pipelineId=; drag-drop PATCHes {stageId}; won/lost PATCHes
 * {status}. `/pipelines` is registered before `/:id` so it isn't matched as one.
 */
export function opportunitiesRoute(deps: {
  db: Database
  /** Fired after a new opportunity so live workflows can enroll the contact. */
  dispatch?: WorkflowDispatch
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/pipelines', async (c) => {
    const loc = c.get('locationId')
    const pipelines = await new PipelinesRepo(deps.db, loc).listWithStages()
    return c.json({ pipelines })
  })

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const pipelineId = c.req.query('pipelineId')
    if (!pipelineId) return c.json({ error: 'pipelineId is required' }, 400)
    const opportunities = await new OpportunitiesRepo(deps.db, loc).listByPipeline(pipelineId)
    return c.json({ opportunities })
  })

  app.post('/', zValidator('json', createSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    // A new card may only reference a pipeline and stage that belong to this
    // location, and the stage must belong to that pipeline. Both lookups are
    // location-scoped, so a foreign id resolves to undefined and is rejected
    // rather than landing a card under another tenant's pipeline.
    const pipelines = new PipelinesRepo(deps.db, loc)
    const pipeline = await pipelines.get(input.pipelineId)
    const stage = await pipelines.getStage(input.stageId)
    if (!pipeline || !stage || stage.pipeline_id !== pipeline.id) {
      return c.json({ error: 'unknown pipeline or stage' }, 400)
    }
    const opportunity = await new OpportunitiesRepo(deps.db, loc).create(input)
    await deps.dispatch?.({
      locationId: loc,
      triggerType: 'opportunity_created',
      contactId: opportunity.contact_id ?? null,
    })
    return c.json({ ok: true, opportunity }, 201)
  })

  app.patch('/:id', zValidator('json', patchSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const repo = new OpportunitiesRepo(deps.db, loc)

    // One concern per call: move (drag-drop) > status (won/lost) > field edit.
    let opportunity
    if (body.stageId !== undefined) {
      // The card stays in its own pipeline; a move may only target a stage that
      // is in this location AND belongs to that same pipeline. This blocks both
      // a foreign stage id and a sideways move into another pipeline's column.
      const existing = await repo.get(id)
      if (!existing) return c.json({ error: 'not found' }, 404)
      const stage = await new PipelinesRepo(deps.db, loc).getStage(body.stageId)
      if (!stage || stage.pipeline_id !== existing.pipeline_id) {
        return c.json({ error: 'unknown stage' }, 400)
      }
      opportunity = await repo.move(id, body.stageId)
    } else if (body.status !== undefined) {
      opportunity = await repo.setStatus(id, body.status)
    } else {
      opportunity = await repo.update(id, {
        name: body.name,
        valueCents: body.valueCents,
        contactId: body.contactId,
        source: body.source,
        assignee: body.assignee,
      })
    }
    if (!opportunity) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, opportunity })
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const opportunity = await new OpportunitiesRepo(deps.db, loc).get(c.req.param('id'))
    if (!opportunity) return c.json({ error: 'not found' }, 404)
    return c.json({ opportunity })
  })

  return app
}
