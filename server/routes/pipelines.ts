import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { type DeleteResult, PipelinesRepo } from '../repos/pipelines-repo'

const nameSchema = z.object({ name: z.string().trim().min(1) })
const reorderSchema = z.object({ orderedIds: z.array(z.string().min(1)).min(1) })

type DeleteFailure = Extract<DeleteResult, { ok: false }>

/**
 * Turn a guarded-delete refusal into an honest HTTP status + message. Missing is
 * 404; the safety refusals (last-of-kind, still-holds-opportunities) are 409 with
 * a plain instruction for what to do first.
 */
function deleteError(
  failure: DeleteFailure,
  noun: 'pipeline' | 'stage',
): { status: 404 | 409; error: string } {
  switch (failure.reason) {
    case 'not_found':
      return { status: 404, error: 'not found' }
    case 'last_pipeline':
      return {
        status: 409,
        error: 'A location needs at least one pipeline. Create another before deleting this one.',
      }
    case 'last_stage':
      return {
        status: 409,
        error: 'A pipeline needs at least one stage. Add another before deleting this one.',
      }
    case 'has_opportunities':
      return { status: 409, error: `Move or close the opportunities in this ${noun} first.` }
  }
}

/**
 * Pipeline and stage *management* for the current location (the GHL Settings ->
 * Pipelines area). Mounted behind operatorAuth + locationAccess. The opportunities
 * route still owns the board reads/writes; this owns the structure: create/rename/
 * delete pipelines and add/rename/reorder/delete their stages. Deletes are guarded
 * (a location keeps >=1 pipeline, a pipeline keeps >=1 stage, and neither a
 * pipeline nor a stage holding opportunities can be removed) -> 409, never a
 * silent cascade. Editing structure never sends a message or moves money.
 *
 * Stage routes are split into two shapes so they never collide with /:id: the
 * pipeline-scoped /:id/stages (add) and /:id/stages-reorder (reorder), and the
 * id-addressed /stages/:stageId (rename, delete). Different segment counts and a
 * distinct "stages-reorder" literal keep every path unambiguous.
 */
export function pipelinesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const pipelines = await new PipelinesRepo(deps.db, loc).listWithStages()
    return c.json({ pipelines })
  })

  app.post('/', zValidator('json', nameSchema), async (c) => {
    const loc = c.get('locationId')
    const { name } = c.req.valid('json')
    const pipeline = await new PipelinesRepo(deps.db, loc).createPipeline(name)
    return c.json({ ok: true, pipeline }, 201)
  })

  // Reorder a pipeline's stages. Registered before /:id/stages so the distinct
  // literal segment is unambiguous regardless of router internals.
  app.post('/:id/stages-reorder', zValidator('json', reorderSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const repo = new PipelinesRepo(deps.db, loc)
    const pipeline = await repo.get(id)
    if (!pipeline) return c.json({ error: 'not found' }, 404)
    const stages = await repo.reorderStages(id, c.req.valid('json').orderedIds)
    return c.json({ ok: true, stages })
  })

  app.post('/:id/stages', zValidator('json', nameSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const repo = new PipelinesRepo(deps.db, loc)
    const pipeline = await repo.get(id)
    if (!pipeline) return c.json({ error: 'not found' }, 404)
    const stage = await repo.addStage(id, c.req.valid('json').name)
    return c.json({ ok: true, stage }, 201)
  })

  app.patch('/stages/:stageId', zValidator('json', nameSchema), async (c) => {
    const loc = c.get('locationId')
    const stage = await new PipelinesRepo(deps.db, loc).renameStage(
      c.req.param('stageId'),
      c.req.valid('json').name,
    )
    if (!stage) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, stage })
  })

  app.delete('/stages/:stageId', async (c) => {
    const loc = c.get('locationId')
    const result = await new PipelinesRepo(deps.db, loc).removeStage(c.req.param('stageId'))
    if (!result.ok) {
      const e = deleteError(result, 'stage')
      return c.json({ error: e.error }, e.status)
    }
    return c.json({ ok: true })
  })

  app.patch('/:id', zValidator('json', nameSchema), async (c) => {
    const loc = c.get('locationId')
    const pipeline = await new PipelinesRepo(deps.db, loc).renamePipeline(
      c.req.param('id'),
      c.req.valid('json').name,
    )
    if (!pipeline) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, pipeline })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const result = await new PipelinesRepo(deps.db, loc).removePipeline(c.req.param('id'))
    if (!result.ok) {
      const e = deleteError(result, 'pipeline')
      return c.json({ error: e.error }, e.status)
    }
    return c.json({ ok: true })
  })

  return app
}
