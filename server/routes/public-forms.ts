import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { renderFormNotFound, renderFormPage } from '../lib/form-page'
import { readFields } from '../lib/page-html'
import { ContactsRepo } from '../repos/contacts-repo'
import { FormSubmissionsRepo } from '../repos/form-submissions-repo'
import { FormsRepo } from '../repos/forms-repo'
import { LocationsRepo } from '../repos/locations-repo'
import { TimelineRepo } from '../repos/timeline-repo'

const submitSchema = z.object({
  values: z.record(z.string(), z.string()).default({}),
})

/**
 * Public, UNAUTHENTICATED standalone forms — mounted at `/api/public/forms`
 * BEFORE the operatorAuth boundary, so it reads the location from the URL
 * (`:loc`) itself. A form is single-page (no `:path`, no `next`), unlike a
 * funnel:
 *
 *   GET  /:loc/:slug         → a published form (visitor render)
 *   POST /:loc/:slug/submit  → capture a lead off the form
 *
 * The submit runs the same capture keystone as a funnel — upsert a contact,
 * apply the form's tag, bump the honest counter, log a timeline event, dispatch
 * `contact_created` — and ADDITIONALLY STORES the raw submission in
 * form_submissions, the capability that distinguishes a form from a funnel step
 * (which only counts). Only published forms are reachable.
 */
export function publicFormsRoute(deps: {
  db: Database
  /** Fired after a capture so live workflows enroll the new lead. */
  dispatch?: WorkflowDispatch
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use(
    '*',
    cors({
      origin: ['https://jahfeelautomation.com', 'https://www.jahfeelautomation.com'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 86400,
    }),
  )

  /** The location's branding color (for the CTA + accents), or undefined. */
  async function brandColor(loc: string): Promise<string | undefined> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return typeof color === 'string' ? color : undefined
  }

  // A published form renders as a real, hostable HTML landing page. Unpublished
  // or unknown → a styled 404 page.
  app.get('/:loc/:slug', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const form = await new FormsRepo(deps.db, loc).getBySlug(slug)
    if (!form || form.status !== 'published') return c.html(renderFormNotFound(), 404)
    return c.html(renderFormPage(form, { brandColor: await brandColor(loc) }))
  })

  app.post('/:loc/:slug/submit', zValidator('json', submitSchema), async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const { values } = c.req.valid('json')

    const formsRepo = new FormsRepo(deps.db, loc)
    const form = await formsRepo.getBySlug(slug)
    if (!form || form.status !== 'published') return c.json({ error: 'not found' }, 404)

    // Validate every required field the form declares is present.
    for (const field of readFields(form.content)) {
      if (field.required && !values[field.name]?.trim()) {
        return c.json({ error: 'missing required field', field: field.name }, 400)
      }
    }

    // Capture the lead. Known field names map onto contact identity; the full
    // raw values map is preserved on the stored submission below.
    const contactsRepo = new ContactsRepo(deps.db, loc)
    const contact = await contactsRepo.upsertByMatch(
      {
        name: values.full_name ?? values.name,
        email: values.email,
        phone: values.phone,
      },
      `form:${slug}`,
    )

    const tag = typeof form.content.tag === 'string' ? form.content.tag : undefined
    if (tag) await contactsRepo.addTag(contact.id, tag)

    // STORE the submission — the form's distinguishing capability. The operator
    // submissions viewer reads these raw values back per form.
    await new FormSubmissionsRepo(deps.db, loc).create({
      formId: form.id,
      contactId: contact.id,
      values,
    })

    await formsRepo.incrementSubmissions(form.id)
    await new TimelineRepo(deps.db, loc).add({
      contactId: contact.id,
      type: 'form_submission',
      refTable: 'forms',
      refId: form.id,
      payload: { form: slug },
    })

    // Drive the capture → automation loop: a live contact_created workflow runs.
    await deps.dispatch?.({ locationId: loc, triggerType: 'contact_created', contactId: contact.id })

    return c.json({ ok: true, contactId: contact.id })
  })

  return app
}
