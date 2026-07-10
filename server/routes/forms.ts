import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { FORM_STATUSES } from '../lib/form-vocab'
import { FormSubmissionsRepo } from '../repos/form-submissions-repo'
import { FormsRepo } from '../repos/forms-repo'

const createFormSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and dashes'),
})

// A form's structured content (jsonb). Loose by design — forms grow new keys
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
    cta: z.string().optional(),
    tag: z.string().optional(),
    successMessage: z.string().optional(),
    fields: z.array(fieldSchema).optional(),
  })
  .passthrough()

const patchFormSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  status: z.enum(FORM_STATUSES).optional(),
  content: contentSchema.optional(),
})

// A brand-new form starts with the fields every lead-capture form needs and a
// friendly success message. The operator edits from there (matches GHL's "new
// form" default).
const STARTER_CONTENT = {
  headline: 'Get in touch',
  subhead: "Leave your details and we'll reach out shortly.",
  cta: 'Submit',
  tag: 'lead',
  successMessage: 'Thanks — we got your details and will be in touch shortly.',
  fields: [
    { name: 'full_name', label: 'Full name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: false },
  ],
}

/**
 * Standalone forms for the current location. Mounted behind operatorAuth +
 * locationAccess. The Forms UI reads GET / (list, each carrying its honest
 * submission counter) and GET /:id (form + its stored submissions). Creating a
 * form seeds starter content. Unlike a funnel, a form has no steps sub-resource
 * — its structure lives in `content`, PATCHed wholesale. The public capture +
 * storage side lives in public-forms.ts (unauthenticated).
 */
export function formsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const forms = await new FormsRepo(deps.db, loc).list()
    return c.json({ forms })
  })

  app.post('/', zValidator('json', createFormSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const form = await new FormsRepo(deps.db, loc).create({ ...input, content: STARTER_CONTENT })
    return c.json({ ok: true, form }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const form = await new FormsRepo(deps.db, loc).get(id)
    if (!form) return c.json({ error: 'not found' }, 404)
    const submissions = await new FormSubmissionsRepo(deps.db, loc).listByForm(id)
    return c.json({ form, submissions })
  })

  app.patch('/:id', zValidator('json', patchFormSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const repo = new FormsRepo(deps.db, loc)

    // One concern per call: publish/unpublish > rename/re-slug/edit content.
    const form =
      body.status !== undefined
        ? await repo.setStatus(id, body.status)
        : await repo.update(id, { name: body.name, slug: body.slug, content: body.content })
    if (!form) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, form })
  })

  return app
}
