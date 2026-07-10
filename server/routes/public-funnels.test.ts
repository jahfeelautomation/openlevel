import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { dispatchWorkflowEvent } from '../jobs/workflow-dispatcher'
import { FunnelStepsRepo } from '../repos/funnel-steps-repo'
import { FunnelsRepo } from '../repos/funnels-repo'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import { publicFunnelsRoute } from './public-funnels'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A published funnel with an opt-in capture page, plus a LIVE contact_created
// workflow — so a public submit proves the whole capture → automation loop.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Test','test')", [loc])

  const funnel = await new FunnelsRepo(db, loc).create({
    name: 'Sell your house fast',
    slug: 'sell-fast',
    status: 'published',
  })
  const steps = new FunnelStepsRepo(db, loc)
  const optIn = await steps.create({
    funnelId: funnel.id,
    name: 'Opt-in',
    type: 'opt_in',
    path: 'get-offer',
    position: 0,
    content: {
      headline: 'Get your cash offer',
      tag: 'lead',
      fields: [
        { name: 'full_name', label: 'Full name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: false },
        { name: 'phone', label: 'Phone', type: 'tel', required: true },
      ],
    },
  })
  await steps.create({
    funnelId: funnel.id,
    name: 'Thank you',
    type: 'thank_you',
    path: 'thanks',
    position: 1,
    content: { headline: 'Thank you!' },
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
  app.route('/', publicFunnelsRoute({ db, dispatch }))
  return { db, loc, app, funnelId: funnel.id, optInId: optIn.id }
}

test('GET /:loc/:slug renders the published funnel as a hostable html page', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/sell-fast')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  // the first step (the opt-in) is rendered: its headline + a real capture form
  expect(html).toContain('Get your cash offer')
  expect(html).toContain('action="/api/public/f/loc_test/sell-fast/get-offer/submit"')
})

test('GET /:loc/:slug/:path renders a specific step as html', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/sell-fast/thanks')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('Thank you!')
  expect(html).not.toContain('<form') // the thank-you page has no capture form
})

test('GET /:loc/:slug is a styled html 404 for an unknown slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/does-not-exist')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('text/html')
  expect((await res.text()).toLowerCase()).toContain('not found')
})

test('GET /:loc/:slug is 404 for a draft (unpublished) funnel', async () => {
  const { app, db } = await setup()
  await db.query("UPDATE funnels SET status='draft' WHERE slug='sell-fast'")
  const res = await app.request('/loc_test/sell-fast')
  expect(res.status).toBe(404)
})

test('GET /:loc/:slug/:path is 404 for an unknown step path', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/sell-fast/nope')
  expect(res.status).toBe(404)
})

test('POST submit captures a lead, tags it, bumps the counter, and runs the live workflow', async () => {
  const { app, db, optInId } = await setup()

  const res = await app.request('/loc_test/sell-fast/get-offer/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: { full_name: 'Olivia Reed', email: 'olivia@example.com', phone: '+15125550148' },
    }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; contactId: string; next: string | null }
  expect(body.ok).toBe(true)
  expect(body.contactId).toBeTruthy()
  expect(body.next).toBe('thanks') // advances to the next step

  // A real contact exists, carries the funnel's tag AND the workflow's tag.
  const [contact] = await db.query<{ name: string; tags: string[]; source: string }>(
    'SELECT name, tags, source FROM contacts WHERE id=$1',
    [body.contactId],
  )
  expect(contact?.name).toBe('Olivia Reed')
  expect(contact?.source).toBe('funnel:sell-fast')
  expect(contact?.tags).toContain('lead') // funnel content.tag
  expect(contact?.tags).toContain('welcomed') // live workflow ran end-to-end

  // The submission counter is real, not faked.
  const [step] = await db.query<{ submissions: number }>(
    'SELECT submissions FROM funnel_steps WHERE id=$1',
    [optInId],
  )
  expect(step?.submissions).toBe(1)

  // A timeline event was logged for the contact.
  const timeline = await db.query<{ type: string }>(
    'SELECT type FROM timeline_events WHERE contact_id=$1',
    [body.contactId],
  )
  expect(timeline.some((t) => t.type === 'funnel_submission')).toBe(true)
})

test('POST submit rejects a missing required field (400)', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/sell-fast/get-offer/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { full_name: 'No Phone' } }), // phone is required
  })
  expect(res.status).toBe(400)
})

test('POST submit is 404 for an unknown step path', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/sell-fast/nope/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: {} }),
  })
  expect(res.status).toBe(404)
})
