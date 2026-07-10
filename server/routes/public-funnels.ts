import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { renderFunnelNotFound, renderFunnelPage } from '../lib/funnel-page'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { ContactsRepo } from '../repos/contacts-repo'
import { FunnelStepsRepo } from '../repos/funnel-steps-repo'
import { FunnelsRepo } from '../repos/funnels-repo'
import { LocationsRepo } from '../repos/locations-repo'
import { TimelineRepo } from '../repos/timeline-repo'

const submitSchema = z.object({
  values: z.record(z.string(), z.string()).default({}),
})

interface FormField {
  name: string
  label?: string
  type?: string
  required?: boolean
}

/** Read the declared form fields off a page's structured content (jsonb). */
function readFields(content: Record<string, unknown>): FormField[] {
  const f = (content as { fields?: unknown }).fields
  return Array.isArray(f) ? (f as FormField[]) : []
}

/**
 * Public, UNAUTHENTICATED funnel pages — the only unauthenticated write in the
 * app, kept deliberately narrow. Mounted at `/api/public/f` BEFORE the
 * operatorAuth boundary, so it must read the location from the URL (`:loc`)
 * itself rather than from middleware context.
 *
 *   GET  /:loc/:slug              → a published funnel + its steps (visitor render)
 *   POST /:loc/:slug/:path/submit → capture a lead off the opt-in page
 *
 * A submit is the architectural keystone: it upserts a contact, applies the
 * page's tag, bumps the honest submission counter, logs a timeline event, and
 * dispatches a `contact_created` event — so a funnel opt-in runs the live
 * welcome workflow end-to-end. Only published funnels are reachable.
 */
export function publicFunnelsRoute(deps: {
  db: Database
  /** Fired after a capture so live workflows enroll the new lead. */
  dispatch?: WorkflowDispatch
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** The location's branding color (for the CTA + accents), or undefined. */
  async function brandColor(loc: string): Promise<string | undefined> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return typeof color === 'string' ? color : undefined
  }

  // A published funnel renders as a real, hostable HTML landing page:
  //   /:loc/:slug        → its first step (the entry page)
  //   /:loc/:slug/:path  → a specific step (where the opt-in form advances to)
  // Unpublished or unknown → a styled 404 page. This is the "future hosting"
  // the Slice 8 design deferred — it makes a published funnel actually viewable.
  app.get('/:loc/:slug', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const funnel = await new FunnelsRepo(deps.db, loc).getBySlug(slug)
    if (!funnel || funnel.status !== 'published') return c.html(renderFunnelNotFound(), 404)
    const steps = await new FunnelStepsRepo(deps.db, loc).listByFunnel(funnel.id)
    const first = steps[0]
    if (!first) return c.html(renderFunnelNotFound(), 404)
    return c.html(renderFunnelPage(funnel, first, steps, { brandColor: await brandColor(loc) }))
  })

  app.get('/:loc/:slug/:path', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const path = c.req.param('path')
    const funnel = await new FunnelsRepo(deps.db, loc).getBySlug(slug)
    if (!funnel || funnel.status !== 'published') return c.html(renderFunnelNotFound(), 404)
    const steps = await new FunnelStepsRepo(deps.db, loc).listByFunnel(funnel.id)
    const step = steps.find((s) => s.path === path)
    if (!step) return c.html(renderFunnelNotFound(), 404)
    return c.html(renderFunnelPage(funnel, step, steps, { brandColor: await brandColor(loc) }))
  })

  app.post('/:loc/:slug/:path/submit', zValidator('json', submitSchema), async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const path = c.req.param('path')
    const { values } = c.req.valid('json')

    const funnel = await new FunnelsRepo(deps.db, loc).getBySlug(slug)
    if (!funnel || funnel.status !== 'published') return c.json({ error: 'not found' }, 404)

    const stepsRepo = new FunnelStepsRepo(deps.db, loc)
    const step = await stepsRepo.getByPath(funnel.id, path)
    if (!step) return c.json({ error: 'not found' }, 404)

    // Validate every required field the page declares is present.
    for (const field of readFields(step.content)) {
      if (field.required && !values[field.name]?.trim()) {
        return c.json({ error: 'missing required field', field: field.name }, 400)
      }
    }

    // Capture the lead. Known field names map onto contact identity; everything
    // else is preserved by the merge fields the workflow runner reads.
    const contactsRepo = new ContactsRepo(deps.db, loc)
    const contact = await contactsRepo.upsertByMatch(
      {
        name: values.full_name ?? values.name,
        email: values.email,
        phone: values.phone,
      },
      `funnel:${slug}`,
    )

    const tag = typeof step.content.tag === 'string' ? step.content.tag : undefined
    if (tag) await contactsRepo.addTag(contact.id, tag)

    await stepsRepo.incrementSubmissions(step.id)
    await new TimelineRepo(deps.db, loc).add({
      contactId: contact.id,
      type: 'funnel_submission',
      refTable: 'funnel_steps',
      refId: step.id,
      payload: { funnel: slug, step: path },
    })

    // Drive the capture → automation loop: a live contact_created workflow runs.
    await deps.dispatch?.({ locationId: loc, triggerType: 'contact_created', contactId: contact.id })

    // Where the visitor goes next (the following page, if any).
    const steps = await stepsRepo.listByFunnel(funnel.id)
    const next = steps.find((s) => s.position > step.position)?.path ?? null
    return c.json({ ok: true, contactId: contact.id, next })
  })

  return app
}
