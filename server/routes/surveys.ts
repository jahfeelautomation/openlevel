import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { SURVEY_STATUSES } from '../lib/survey-vocab'
import { SurveySubmissionsRepo } from '../repos/survey-submissions-repo'
import { SurveysRepo } from '../repos/surveys-repo'

const createSurveySchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and dashes'),
})

// A survey's structured content (jsonb). Loose by design — surveys grow new keys
// without a migration — but the capture-relevant bits (steps → fields, tag) are
// typed. A field may carry `options` for a single-choice dropdown.
const fieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
})
const stepSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  fields: z.array(fieldSchema).default([]),
})
const contentSchema = z
  .object({
    headline: z.string().optional(),
    subhead: z.string().optional(),
    cta: z.string().optional(),
    tag: z.string().optional(),
    successMessage: z.string().optional(),
    steps: z.array(stepSchema).optional(),
  })
  .passthrough()

const patchSurveySchema = z.object({
  name: z.string().min(1).optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  status: z.enum(SURVEY_STATUSES).optional(),
  content: contentSchema.optional(),
})

// A brand-new survey starts as a friendly two-step intake the operator edits
// from there (matches GHL's "new survey" starting with real questions).
const STARTER_CONTENT = {
  headline: 'Tell us a bit about you',
  subhead: 'A couple of quick questions — under a minute.',
  cta: 'Submit',
  tag: 'lead',
  successMessage: 'Thanks — we got your answers and will be in touch shortly.',
  steps: [
    {
      id: 'step-1',
      title: 'About you',
      subtitle: 'So we know who to reach.',
      fields: [
        { name: 'full_name', label: 'Full name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
      ],
    },
    {
      id: 'step-2',
      title: 'How can we help?',
      fields: [{ name: 'message', label: 'What are you looking for?', type: 'textarea' }],
    },
  ],
}

/**
 * Surveys for the current location. Mounted behind operatorAuth + locationAccess.
 * The Surveys UI reads GET / (list, each carrying its honest submission counter)
 * and GET /:id (survey + its stored submissions). Creating a survey seeds the
 * two-step starter. Like a form, a survey's structure lives in `content`
 * (here a `steps` array), PATCHed wholesale. The public render + capture + store
 * side lives in public-surveys.ts (unauthenticated).
 */
export function surveysRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const surveys = await new SurveysRepo(deps.db, loc).list()
    return c.json({ surveys })
  })

  app.post('/', zValidator('json', createSurveySchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const survey = await new SurveysRepo(deps.db, loc).create({ ...input, content: STARTER_CONTENT })
    return c.json({ ok: true, survey }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const survey = await new SurveysRepo(deps.db, loc).get(id)
    if (!survey) return c.json({ error: 'not found' }, 404)
    const submissions = await new SurveySubmissionsRepo(deps.db, loc).listBySurvey(id)
    return c.json({ survey, submissions })
  })

  app.patch('/:id', zValidator('json', patchSurveySchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const repo = new SurveysRepo(deps.db, loc)

    // One concern per call: publish/unpublish > rename/re-slug/edit content.
    const survey =
      body.status !== undefined
        ? await repo.setStatus(id, body.status)
        : await repo.update(id, { name: body.name, slug: body.slug, content: body.content })
    if (!survey) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, survey })
  })

  return app
}
