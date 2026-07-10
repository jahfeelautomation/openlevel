import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { TemplatesRepo } from '../repos/templates-repo'

const CHANNELS = ['email', 'sms'] as const

const createTemplateSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(CHANNELS).default('email'),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
})

const patchTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  channel: z.enum(CHANNELS).optional(),
  subject: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
})

/**
 * The reusable message-template library for the current location. Mounted behind
 * operatorAuth + locationAccess. These are saved drafts only — creating or editing
 * a template never sends anything or touches money; they get pulled into campaigns
 * and automation steps where the actual send happens.
 *
 *   GET    /       list templates (newest first)
 *   POST   /       create a template
 *   GET    /:id    one template
 *   PATCH  /:id    edit name / channel / subject / body
 *   DELETE /:id    remove a template
 */
export function templatesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const templates = await new TemplatesRepo(deps.db, loc).list()
    return c.json({ templates })
  })

  app.post('/', zValidator('json', createTemplateSchema), async (c) => {
    const loc = c.get('locationId')
    const template = await new TemplatesRepo(deps.db, loc).create(c.req.valid('json'))
    return c.json({ ok: true, template }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const template = await new TemplatesRepo(deps.db, loc).get(c.req.param('id'))
    if (!template) return c.json({ error: 'not found' }, 404)
    return c.json({ template })
  })

  app.patch('/:id', zValidator('json', patchTemplateSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const repo = new TemplatesRepo(deps.db, loc)
    // Establish existence first so an empty patch (a valid no-op) returns the
    // template unchanged rather than being mistaken for a missing row.
    const existing = await repo.get(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    const updated = await repo.update(id, c.req.valid('json'))
    return c.json({ ok: true, template: updated ?? existing })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const removed = await new TemplatesRepo(deps.db, loc).remove(c.req.param('id'))
    if (!removed) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  return app
}
