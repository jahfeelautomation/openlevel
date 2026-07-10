import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { dispatchWorkflowEvent } from '../jobs/workflow-dispatcher'
import { SurveysRepo } from '../repos/surveys-repo'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import { publicSurveysRoute } from './public-surveys'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A published multi-step survey, plus TWO live workflows — one keyed on the
// dedicated survey_submitted trigger, one on the generic contact_created — so a
// single public submit proves the whole capture → store → DUAL-dispatch loop.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Test','test')", [loc])

  const survey = await new SurveysRepo(db, loc).create({
    name: 'Seller intake',
    slug: 'seller-intake',
    status: 'published',
    content: {
      headline: 'Tell us about your property',
      tag: 'seller-lead',
      successMessage: 'Got it — we’ll review and text you today.',
      steps: [
        {
          id: 's1',
          title: 'About you',
          fields: [
            { name: 'full_name', label: 'Full name', type: 'text', required: true },
            { name: 'phone', label: 'Phone', type: 'tel', required: true },
          ],
        },
        {
          id: 's2',
          title: 'The property',
          fields: [
            { name: 'address', label: 'Property address', type: 'text', required: true },
            { name: 'beds', label: 'Bedrooms', type: 'select', options: ['1', '2', '3', '4+'] },
          ],
        },
        { id: 's3', title: 'Anything else', fields: [{ name: 'notes', type: 'textarea' }] },
      ],
    },
  })

  // Live workflow A: keyed on the dedicated survey_submitted trigger.
  const wfA = await new WorkflowsRepo(db, loc).create({
    name: 'Survey done',
    triggerType: 'survey_submitted',
  })
  await new WorkflowsRepo(db, loc).update(wfA.id, { status: 'live' })
  await new WorkflowActionsRepo(db, loc).replaceAll(wfA.id, [
    { type: 'add_tag', config: { tag: 'surveyed' } },
  ])

  // Live workflow B: keyed on the generic contact_created trigger.
  const wfB = await new WorkflowsRepo(db, loc).create({
    name: 'New lead welcome',
    triggerType: 'contact_created',
  })
  await new WorkflowsRepo(db, loc).update(wfB.id, { status: 'live' })
  await new WorkflowActionsRepo(db, loc).replaceAll(wfB.id, [
    { type: 'add_tag', config: { tag: 'welcomed' } },
  ])

  const dispatch = async (e: Parameters<typeof dispatchWorkflowEvent>[1]) => {
    await dispatchWorkflowEvent({ db }, e)
  }
  const app = new Hono<AppEnv>()
  app.route('/', publicSurveysRoute({ db, dispatch }))
  return { db, loc, app, surveyId: survey.id }
}

test('GET /:loc/:slug renders the published survey as a multi-step html page', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/seller-intake')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('Tell us about your property')
  expect(html).toContain('Step 1 of 3')
  expect(html).toContain('action="/api/public/surveys/loc_test/seller-intake/submit"')
})

test('GET /:loc/:slug is a styled html 404 for an unknown slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/does-not-exist')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('text/html')
  expect((await res.text()).toLowerCase()).toContain('not found')
})

test('GET /:loc/:slug is 404 for a draft (unpublished) survey', async () => {
  const { app, db } = await setup()
  await db.query("UPDATE surveys SET status='draft' WHERE slug='seller-intake'")
  const res = await app.request('/loc_test/seller-intake')
  expect(res.status).toBe(404)
})

test('POST submit captures, STORES answers, tags, bumps the counter, and fires BOTH triggers', async () => {
  const { app, db, surveyId } = await setup()

  const res = await app.request('/loc_test/seller-intake/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: {
        full_name: 'Olivia Reed',
        phone: '+15125550148',
        address: '123 Oak St',
        beds: '3',
        notes: 'Roof is new.',
      },
    }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; contactId: string }
  expect(body.ok).toBe(true)
  expect(body.contactId).toBeTruthy()

  // A real contact exists, carries the survey's tag AND both workflows' tags —
  // proving survey_submitted AND contact_created both dispatched end-to-end.
  const [contact] = await db.query<{ name: string; tags: string[]; source: string }>(
    'SELECT name, tags, source FROM contacts WHERE id=$1',
    [body.contactId],
  )
  expect(contact?.name).toBe('Olivia Reed')
  expect(contact?.source).toBe('survey:seller-intake')
  expect(contact?.tags).toContain('seller-lead') // survey content.tag
  expect(contact?.tags).toContain('surveyed') // survey_submitted workflow ran
  expect(contact?.tags).toContain('welcomed') // contact_created workflow ran

  // The raw answers are STORED with the linked contact and survey.
  const submissions = await db.query<{
    survey_id: string
    contact_id: string
    values: Record<string, unknown>
  }>('SELECT survey_id, contact_id, values FROM survey_submissions WHERE location_id=$1', ['loc_test'])
  expect(submissions.length).toBe(1)
  expect(submissions[0]?.survey_id).toBe(surveyId)
  expect(submissions[0]?.contact_id).toBe(body.contactId)
  expect(submissions[0]?.values.address).toBe('123 Oak St')
  expect(submissions[0]?.values.notes).toBe('Roof is new.')

  // The honest submission counter is bumped, not faked.
  const [survey] = await db.query<{ submissions: number }>('SELECT submissions FROM surveys WHERE id=$1', [
    surveyId,
  ])
  expect(survey?.submissions).toBe(1)

  // A timeline event was logged for the contact.
  const timeline = await db.query<{ type: string }>('SELECT type FROM timeline_events WHERE contact_id=$1', [
    body.contactId,
  ])
  expect(timeline.some((t) => t.type === 'survey_submission')).toBe(true)
})

test('POST submit rejects a missing required field on ANY step (400)', async () => {
  const { app } = await setup()
  // address (step 2) is required but omitted
  const res = await app.request('/loc_test/seller-intake/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { full_name: 'No Address', phone: '+15125550148' } }),
  })
  expect(res.status).toBe(400)
})

test('POST submit is 404 for an unknown survey slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: {} }),
  })
  expect(res.status).toBe(404)
})

test('POST submit is 404 for a draft (unpublished) survey', async () => {
  const { app, db } = await setup()
  await db.query("UPDATE surveys SET status='draft' WHERE slug='seller-intake'")
  const res = await app.request('/loc_test/seller-intake/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { full_name: 'A', phone: '+1', address: 'x' } }),
  })
  expect(res.status).toBe(404)
})
