import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { dispatchWorkflowEvent } from '../jobs/workflow-dispatcher'
import { FormsRepo } from '../repos/forms-repo'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import { publicFormsRoute } from './public-forms'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A published standalone form, plus a LIVE contact_created workflow — so a public
// submit proves the whole capture → store → automation loop in one go.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Test','test')", [loc])

  const form = await new FormsRepo(db, loc).create({
    name: 'Cash offer request',
    slug: 'cash-offer',
    status: 'published',
    content: {
      headline: 'Request your cash offer',
      tag: 'lead',
      successMessage: 'Got it — we’ll be in touch.',
      fields: [
        { name: 'full_name', label: 'Full name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: false },
        { name: 'phone', label: 'Phone', type: 'tel', required: true },
      ],
    },
  })

  // A live welcome workflow that tags whoever is created.
  const wf = await new WorkflowsRepo(db, loc).create({
    name: 'New lead welcome',
    triggerType: 'contact_created',
  })
  await new WorkflowsRepo(db, loc).update(wf.id, { status: 'live' })
  await new WorkflowActionsRepo(db, loc).replaceAll(wf.id, [{ type: 'add_tag', config: { tag: 'welcomed' } }])

  const dispatch = async (e: Parameters<typeof dispatchWorkflowEvent>[1]) => {
    await dispatchWorkflowEvent({ db }, e)
  }
  const app = new Hono<AppEnv>()
  app.route('/', publicFormsRoute({ db, dispatch }))
  return { db, loc, app, formId: form.id }
}

test('GET /:loc/:slug renders the published form as a hostable html page', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/cash-offer')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('Request your cash offer')
  expect(html).toContain('action="/api/public/forms/loc_test/cash-offer/submit"')
})

test('GET /:loc/:slug is a styled html 404 for an unknown slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/does-not-exist')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('text/html')
  expect((await res.text()).toLowerCase()).toContain('not found')
})

test('GET /:loc/:slug is 404 for a draft (unpublished) form', async () => {
  const { app, db } = await setup()
  await db.query("UPDATE forms SET status='draft' WHERE slug='cash-offer'")
  const res = await app.request('/loc_test/cash-offer')
  expect(res.status).toBe(404)
})

test('POST submit captures a lead, STORES the submission, tags it, bumps the counter, runs the live workflow', async () => {
  const { app, db, formId } = await setup()

  const res = await app.request('/loc_test/cash-offer/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: { full_name: 'Olivia Reed', email: 'olivia@example.com', phone: '+15125550148' },
    }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; contactId: string }
  expect(body.ok).toBe(true)
  expect(body.contactId).toBeTruthy()
  // a single-page form has no next step — it never returns one
  expect(body).not.toHaveProperty('next')

  // A real contact exists, carries the form's tag AND the workflow's tag.
  const [contact] = await db.query<{ name: string; tags: string[]; source: string }>(
    'SELECT name, tags, source FROM contacts WHERE id=$1',
    [body.contactId],
  )
  expect(contact?.name).toBe('Olivia Reed')
  expect(contact?.source).toBe('form:cash-offer')
  expect(contact?.tags).toContain('lead') // form content.tag
  expect(contact?.tags).toContain('welcomed') // live workflow ran end-to-end

  // The submission is STORED with its raw values and the linked contact — the
  // capability that distinguishes a form from a funnel step (which only counts).
  const submissions = await db.query<{
    form_id: string
    contact_id: string
    values: Record<string, unknown>
  }>('SELECT form_id, contact_id, values FROM form_submissions WHERE location_id=$1', ['loc_test'])
  expect(submissions.length).toBe(1)
  expect(submissions[0]?.form_id).toBe(formId)
  expect(submissions[0]?.contact_id).toBe(body.contactId)
  expect(submissions[0]?.values.email).toBe('olivia@example.com')

  // The honest submission counter is bumped, not faked.
  const [form] = await db.query<{ submissions: number }>('SELECT submissions FROM forms WHERE id=$1', [formId])
  expect(form?.submissions).toBe(1)

  // A timeline event was logged for the contact.
  const timeline = await db.query<{ type: string }>('SELECT type FROM timeline_events WHERE contact_id=$1', [
    body.contactId,
  ])
  expect(timeline.some((t) => t.type === 'form_submission')).toBe(true)
})

test('POST submit rejects a missing required field (400)', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/cash-offer/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { full_name: 'No Phone' } }), // phone is required
  })
  expect(res.status).toBe(400)
})

test('POST submit is 404 for an unknown form slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: {} }),
  })
  expect(res.status).toBe(404)
})

test('POST submit is 404 for a draft (unpublished) form', async () => {
  const { app, db } = await setup()
  await db.query("UPDATE forms SET status='draft' WHERE slug='cash-offer'")
  const res = await app.request('/loc_test/cash-offer/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { full_name: 'A', phone: '+1', email: 'a@b.com' } }),
  })
  expect(res.status).toBe(404)
})

test('OPTIONS submit allows the JahFeel marketing site to post JSON', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/cash-offer/submit', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://jahfeelautomation.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  })

  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-origin')).toBe('https://jahfeelautomation.com')
  expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type')
})
