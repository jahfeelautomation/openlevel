import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { CustomValuesRepo } from '../repos/custom-values-repo'

const createSchema = z.object({
  name: z.string().trim().min(1),
  value: z.string().default(''),
})

// Every key optional; the key (slug) is immutable so it is intentionally absent.
// An empty patch returns the value unchanged (no UPDATE issued), mirroring the
// custom-fields route — so no refine guard is needed here.
const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  value: z.string().optional(),
  position: z.number().int().min(0).optional(),
})

/**
 * Custom *values* for the current location (GHL "Custom Values" settings):
 * location-level constants referenced as {{custom_values.<key>}} merge tags in
 * templates and automations. Mounted behind operatorAuth + locationAccess.
 * Defining or editing a value only changes stored text — it never sends anything
 * or moves money. The merge key is derived from the name once and never changes.
 */
export function customValuesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const values = await new CustomValuesRepo(deps.db, loc).list()
    return c.json({ values })
  })

  app.post('/', zValidator('json', createSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const value = await new CustomValuesRepo(deps.db, loc).create({
      name: input.name,
      value: input.value,
    })
    return c.json({ ok: true, value }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const value = await new CustomValuesRepo(deps.db, loc).get(c.req.param('id'))
    if (!value) return c.json({ error: 'not found' }, 404)
    return c.json({ value })
  })

  app.patch('/:id', zValidator('json', patchSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new CustomValuesRepo(deps.db, loc)
    const id = c.req.param('id')
    const existing = await repo.get(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    const value = await repo.update(id, c.req.valid('json'))
    return c.json({ ok: true, value: value ?? existing })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const ok = await new CustomValuesRepo(deps.db, loc).remove(c.req.param('id'))
    if (!ok) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  return app
}
