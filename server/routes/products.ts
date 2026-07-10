import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { ProductsRepo } from '../repos/products-repo'

const intervalSchema = z.enum(['day', 'week', 'month', 'year'])
const typeSchema = z.enum(['one_time', 'recurring'])

const createSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  priceCents: z.number().int().min(0).optional(),
  currency: z.string().trim().min(1).optional(),
  type: typeSchema.optional(),
  recurringInterval: intervalSchema.optional(),
})

// Every field optional; an empty patch returns the product unchanged (no UPDATE
// issued), so no refine guard is needed. `status` toggles active/archived; the
// repo couples type and interval so a one_time product never keeps a cadence.
const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  priceCents: z.number().int().min(0).optional(),
  currency: z.string().trim().min(1).optional(),
  type: typeSchema.optional(),
  recurringInterval: intervalSchema.optional(),
  status: z.enum(['active', 'archived']).optional(),
  position: z.number().int().min(0).optional(),
})

/**
 * The product/service catalog for the current location (GHL "Payments →
 * Products"): the saved items an invoice or proposal can be built from instead
 * of retyping a price. Mounted behind operatorAuth + locationAccess. Editing the
 * catalog only changes stored text and amounts — it never sends anything or
 * moves money, and because a document copies its lines at build time, archiving
 * or deleting a product never disturbs a document already created from it.
 */
export function productsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const products = await new ProductsRepo(deps.db, loc).list()
    return c.json({ products })
  })

  app.post('/', zValidator('json', createSchema), async (c) => {
    const loc = c.get('locationId')
    const product = await new ProductsRepo(deps.db, loc).create(c.req.valid('json'))
    return c.json({ ok: true, product }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const product = await new ProductsRepo(deps.db, loc).get(c.req.param('id'))
    if (!product) return c.json({ error: 'not found' }, 404)
    return c.json({ product })
  })

  app.patch('/:id', zValidator('json', patchSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new ProductsRepo(deps.db, loc)
    const id = c.req.param('id')
    const existing = await repo.get(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    const product = await repo.update(id, c.req.valid('json'))
    return c.json({ ok: true, product: product ?? existing })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const ok = await new ProductsRepo(deps.db, loc).remove(c.req.param('id'))
    if (!ok) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  return app
}
