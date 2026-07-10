import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { dispatchWorkflowEvent } from '../jobs/workflow-dispatcher'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { TriggerLinksRepo } from '../repos/trigger-links-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import { publicTriggerLinksRoute } from './public-trigger-links'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location with a contact, one trackable link, and a LIVE workflow wired to
// `trigger_link_clicked` (adds a tag). Clicking an attributed link should record a
// click, fire the workflow on the real contact, log the timeline, and 302 onward.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query('INSERT INTO locations (id, name, slug, branding) VALUES ($1,$2,$3,$4)', [
    loc,
    'Alex — Cash Offers',
    'Alex',
    { color: '#4f46e5' },
  ])
  await db.query(
    "INSERT INTO contacts (id, location_id, name, first_name) VALUES ('c1',$1,'Dana','Dana')",
    [loc],
  )

  const link = await new TriggerLinksRepo(db, loc).create({
    name: 'Free Cash Offer',
    slug: 'free-offer',
    destinationUrl: 'https://example.test/landing',
  })

  // A live workflow that tags whoever clicks an attributed trigger link.
  const wf = await new WorkflowsRepo(db, loc).create({
    name: 'Tag link clickers',
    triggerType: 'trigger_link_clicked',
  })
  await new WorkflowsRepo(db, loc).update(wf.id, { status: 'live' })
  await new WorkflowActionsRepo(db, loc).replaceAll(wf.id, [
    { type: 'add_tag', config: { tag: 'clicked-offer' } },
  ])

  // Dispatch runs in-process for the test (prod enqueues to pg-boss).
  const dispatch = async (e: Parameters<typeof dispatchWorkflowEvent>[1]) => {
    await dispatchWorkflowEvent({ db }, e)
  }

  const app = new Hono<AppEnv>()
  app.route('/', publicTriggerLinksRoute({ db, dispatch }))
  return { db, loc, app, link }
}

async function clicks(db: PgliteDatabase, linkId: string) {
  return db.query<{ id: string; contact_id: string | null }>(
    'SELECT id, contact_id FROM trigger_link_clicks WHERE link_id=$1',
    [linkId],
  )
}

test('an anonymous click 302-redirects to the destination and records a click', async () => {
  const { db, app, link } = await setup()

  const res = await app.request(`/loc_test/free-offer`)
  expect(res.status).toBe(302)
  expect(res.headers.get('location')).toBe('https://example.test/landing')

  const rows = await clicks(db, link.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.contact_id).toBeNull() // anonymous — no ?c=
})

test('a click attributed to a real contact records, fires the workflow, and logs the timeline', async () => {
  const { db, app, link } = await setup()

  const res = await app.request(`/loc_test/free-offer?c=c1`)
  expect(res.status).toBe(302)
  expect(res.headers.get('location')).toBe('https://example.test/landing')

  // The click is attributed to the contact.
  const rows = await clicks(db, link.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.contact_id).toBe('c1')

  // The live trigger_link_clicked workflow ran on the real contact.
  const [contact] = await db.query<{ tags: string[] }>('SELECT tags FROM contacts WHERE id=$1', [
    'c1',
  ])
  expect(contact?.tags).toContain('clicked-offer')

  // The click is on the contact's timeline.
  const [t] = await db.query<{ type: string }>(
    "SELECT type FROM timeline_events WHERE contact_id='c1' AND type='trigger_link_click'",
  )
  expect(t?.type).toBe('trigger_link_click')
})

test('an unknown ?c= is treated as anonymous (no workflow run) but still redirects', async () => {
  const { db, app, link } = await setup()

  const res = await app.request(`/loc_test/free-offer?c=ghost`)
  expect(res.status).toBe(302)

  const rows = await clicks(db, link.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.contact_id).toBeNull() // unknown contact → not attributed, not leaked

  // No workflow ran (no real contact to act on).
  const runs = await db.query('SELECT id FROM workflow_runs')
  expect(runs).toHaveLength(0)
})

test('an unknown slug 404s and records no click', async () => {
  const { db, app, link } = await setup()

  const res = await app.request(`/loc_test/does-not-exist`)
  expect(res.status).toBe(404)

  const rows = await clicks(db, link.id)
  expect(rows).toHaveLength(0)
})

