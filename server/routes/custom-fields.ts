import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { CUSTOM_FIELD_TYPES } from '../lib/custom-field-key'
import { CustomFieldsRepo } from '../repos/custom-fields-repo'

const createSchema = z.object({
  label: z.string().trim().min(1),
  type: z.enum(CUSTOM_FIELD_TYPES).default('text'),
  // Choices for a dropdown; each trimmed and non-empty. Ignored for other types.
  options: z.array(z.string().trim().min(1)).default([]),
  placeholder: z.string().trim().nullish(),
})

// Every key optional; the key (slug) is immutable so it is intentionally absent.
// An empty patch returns the field unchanged (no UPDATE issued), mirroring
// templates — so no refine guard is needed here.
const patchSchema = z.object({
  label: z.string().trim().min(1).optional(),
  type: z.enum(CUSTOM_FIELD_TYPES).optional(),
  options: z.array(z.string().trim().min(1)).optional(),
  placeholder: z.string().trim().nullish(),
  position: z.number().int().min(0).optional(),
})

/**
 * Custom-field *definitions* for the current location (GHL "Custom Fields"
 * settings). Mounted behind operatorAuth + locationAccess. Defining or editing a
 * field only changes the contact-record schema — it never sends anything or
 * moves money. Deleting a field also clears its values from every contact.
 */
export function customFieldsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const fields = await new CustomFieldsRepo(deps.db, loc).list()
    return c.json({ fields })
  })

  app.post('/', zValidator('json', createSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const field = await new CustomFieldsRepo(deps.db, loc).create({
      label: input.label,
      type: input.type,
      options: input.options,
      placeholder: input.placeholder ?? null,
    })
    return c.json({ ok: true, field }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const field = await new CustomFieldsRepo(deps.db, loc).get(c.req.param('id'))
    if (!field) return c.json({ error: 'not found' }, 404)
    return c.json({ field })
  })

  app.patch('/:id', zValidator('json', patchSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new CustomFieldsRepo(deps.db, loc)
    const id = c.req.param('id')
    const existing = await repo.get(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    const field = await repo.update(id, c.req.valid('json'))
    return c.json({ ok: true, field: field ?? existing })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const ok = await new CustomFieldsRepo(deps.db, loc).remove(c.req.param('id'))
    if (!ok) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  return app
}
