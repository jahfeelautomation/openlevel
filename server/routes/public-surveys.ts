import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { readAllFields } from '../lib/page-html'
import { renderSurveyNotFound, renderSurveyPage } from '../lib/survey-page'
import { ContactsRepo } from '../repos/contacts-repo'
import { LocationsRepo } from '../repos/locations-repo'
import { SurveySubmissionsRepo } from '../repos/survey-submissions-repo'
import { SurveysRepo } from '../repos/surveys-repo'
import { TimelineRepo } from '../repos/timeline-repo'

const submitSchema = z.object({
  values: z.record(z.string(), z.string()).default({}),
})

/**
 * Public, UNAUTHENTICATED multi-step surveys — mounted at `/api/public/surveys`
 * BEFORE the operatorAuth boundary, so it reads the location from the URL
 * (`:loc`) itself.
 *
 *   GET  /:loc/:slug         → a published survey (visitor render, all steps)
 *   POST /:loc/:slug/submit  → capture every step's answers in one shot
 *
 * The submit runs the same capture keystone as a form — upsert a contact, apply
 * an optional tag, store the raw answers, bump the honest counter, log a
 * timeline event — and dispatches BOTH `survey_submitted` (the specific trigger
 * a workflow can key off) AND `contact_created` (so a finished survey enrolls
 * the lead in the generic new-contact automations too). Only published surveys
 * are reachable; required fields are validated against every step's fields.
 */
export function publicSurveysRoute(deps: {
  db: Database
  /** Fired after a capture so live workflows enroll the contact. */
  dispatch?: WorkflowDispatch
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** The location's branding color (for the CTA + accents), or undefined. */
  async function brandColor(loc: string): Promise<string | undefined> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return typeof color === 'string' ? color : undefined
  }

  // A published survey renders as a real, hostable multi-step HTML page.
  // Unpublished or unknown → a styled 404 page.
  app.get('/:loc/:slug', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const survey = await new SurveysRepo(deps.db, loc).getBySlug(slug)
    if (!survey || survey.status !== 'published') return c.html(renderSurveyNotFound(), 404)
    return c.html(renderSurveyPage(survey, { brandColor: await brandColor(loc) }))
  })

  app.post('/:loc/:slug/submit', zValidator('json', submitSchema), async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const { values } = c.req.valid('json')

    const surveysRepo = new SurveysRepo(deps.db, loc)
    const survey = await surveysRepo.getBySlug(slug)
    if (!survey || survey.status !== 'published') return c.json({ error: 'not found' }, 404)

    // Validate every required field across ALL steps is present. The renderer and
    // this check read the same readAllFields, so they can never disagree.
    for (const field of readAllFields(survey.content)) {
      if (field.required && !values[field.name]?.trim()) {
        return c.json({ error: 'missing required field', field: field.name }, 400)
      }
    }

    // Capture the lead. Known field names map onto contact identity; the full
    // raw answers map is preserved on the stored submission below.
    const contactsRepo = new ContactsRepo(deps.db, loc)
    const contact = await contactsRepo.upsertByMatch(
      {
        name: values.full_name ?? values.name,
        email: values.email,
        phone: values.phone,
      },
      `survey:${slug}`,
    )

    const tag = typeof survey.content.tag === 'string' ? survey.content.tag : undefined
    if (tag) await contactsRepo.addTag(contact.id, tag)

    // STORE the raw answers — the operator submissions viewer reads these back.
    await new SurveySubmissionsRepo(deps.db, loc).create({
      surveyId: survey.id,
      contactId: contact.id,
      values,
    })

    await surveysRepo.incrementSubmissions(survey.id)
    await new TimelineRepo(deps.db, loc).add({
      contactId: contact.id,
      type: 'survey_submission',
      refTable: 'surveys',
      refId: survey.id,
      payload: { survey: slug },
    })

    // Drive the capture → automation loop: a completed survey can start its own
    // dedicated workflow AND the generic new-contact ones.
    await deps.dispatch?.({ locationId: loc, triggerType: 'survey_submitted', contactId: contact.id })
    await deps.dispatch?.({ locationId: loc, triggerType: 'contact_created', contactId: contact.id })

    return c.json({ ok: true, contactId: contact.id })
  })

  return app
}
