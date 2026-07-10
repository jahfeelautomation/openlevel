import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { FUNNEL_STATUSES, FUNNEL_STEP_TYPES } from '../lib/funnel-vocab'
import { FunnelStepsRepo } from '../repos/funnel-steps-repo'
import { FunnelsRepo } from '../repos/funnels-repo'

const createFunnelSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and dashes'),
})

const patchFunnelSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  status: z.enum(FUNNEL_STATUSES).optional(),
})

// A page's structured content (jsonb). Loose by design — pages grow new keys
// without a migration — but the capture-relevant bits (fields, tag) are typed.
const fieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.string().optional(),
  required: z.boolean().optional(),
})
const contentSchema = z
  .object({
    headline: z.string().optional(),
    subhead: z.string().optional(),
    body: z.string().optional(),
    cta: z.string().optional(),
    tag: z.string().optional(),
    fields: z.array(fieldSchema).optional(),
  })
  .passthrough()

const createStepSchema = z.object({
  name: z.string().min(1),
  type: z.enum(FUNNEL_STEP_TYPES),
  path: z.string().min(1),
  content: contentSchema.optional(),
  position: z.number().int().nonnegative().optional(),
})

const patchStepSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(FUNNEL_STEP_TYPES).optional(),
  path: z.string().min(1).optional(),
  content: contentSchema.optional(),
  position: z.number().int().nonnegative().optional(),
})

// A brand-new funnel starts with the two pages every funnel needs: a capture
// page and a thank-you. The operator edits from there (matches GHL's "new
// funnel" default).
const STARTER_STEPS = [
  {
    name: 'Opt-in',
    type: 'opt_in' as const,
    path: 'opt-in',
    position: 0,
    content: {
      headline: 'Get your free offer',
      subhead: "Enter your details and we'll be in touch.",
      cta: 'Submit',
      tag: 'lead',
      fields: [
        { name: 'full_name', label: 'Full name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: false },
        { name: 'phone', label: 'Phone', type: 'tel', required: true },
      ],
    },
  },
  {
    name: 'Thank you',
    type: 'thank_you' as const,
    path: 'thank-you',
    position: 1,
    content: { headline: 'Thank you!', body: 'We got your details and will reach out shortly.' },
  },
]

/**
 * Funnels (hosted pages) for the current location. Mounted behind operatorAuth +
 * locationAccess. The Sites & Funnels UI reads GET / (list w/ step counts) and
 * GET /:id (funnel + ordered steps); creating a funnel seeds a starter opt-in +
 * thank-you. `/:id/steps` is a distinct path depth, so it never collides with
 * `/:id`. The public capture side lives in public-funnels.ts (unauthenticated).
 */
export function funnelsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const funnels = await new FunnelsRepo(deps.db, loc).listWithStepCounts()
    return c.json({ funnels })
  })

  app.post('/', zValidator('json', createFunnelSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const funnel = await new FunnelsRepo(deps.db, loc).create(input)
    const stepsRepo = new FunnelStepsRepo(deps.db, loc)
    const steps = []
    for (const s of STARTER_STEPS) {
      steps.push(await stepsRepo.create({ funnelId: funnel.id, ...s }))
    }
    return c.json({ ok: true, funnel, steps }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const funnel = await new FunnelsRepo(deps.db, loc).get(id)
    if (!funnel) return c.json({ error: 'not found' }, 404)
    const steps = await new FunnelStepsRepo(deps.db, loc).listByFunnel(id)
    return c.json({ funnel, steps })
  })

  app.patch('/:id', zValidator('json', patchFunnelSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const repo = new FunnelsRepo(deps.db, loc)

    // One concern per call: publish/unpublish > rename/re-slug.
    const funnel =
      body.status !== undefined
        ? await repo.setStatus(id, body.status)
        : await repo.update(id, { name: body.name, slug: body.slug })
    if (!funnel) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, funnel })
  })

  app.post('/:id/steps', zValidator('json', createStepSchema), async (c) => {
    const loc = c.get('locationId')
    const funnelId = c.req.param('id')
    const input = c.req.valid('json')
    // Only add a step to a funnel that exists in this location — the lookup is
    // scoped, so a foreign or missing funnel id is a 404 instead of orphaning a
    // step under an id this tenant does not own.
    const funnel = await new FunnelsRepo(deps.db, loc).get(funnelId)
    if (!funnel) return c.json({ error: 'not found' }, 404)
    const step = await new FunnelStepsRepo(deps.db, loc).create({ funnelId, ...input })
    return c.json({ ok: true, step }, 201)
  })

  app.patch('/:id/steps/:stepId', zValidator('json', patchStepSchema), async (c) => {
    const loc = c.get('locationId')
    const funnelId = c.req.param('id')
    const stepId = c.req.param('stepId')
    const repo = new FunnelStepsRepo(deps.db, loc)
    // The step must belong to the funnel named in the path, not merely exist in
    // this location — otherwise PATCH /funnelA/steps/<step-of-funnelB> would edit
    // funnel B's step through funnel A's URL.
    const existing = await repo.get(stepId)
    if (!existing || existing.funnel_id !== funnelId) return c.json({ error: 'not found' }, 404)
    const step = await repo.update(stepId, c.req.valid('json'))
    if (!step) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, step })
  })

  return app
}
