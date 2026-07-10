import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { dispatchWorkflowEvent } from '../jobs/workflow-dispatcher'
import { ContactsRepo } from '../repos/contacts-repo'
import { ProposalsRepo } from '../repos/proposals-repo'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import { publicProposalsRoute } from './public-proposals'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A sent proposal tied to a real contact, plus a live workflow keyed on the
// proposal_signed trigger — so a single public sign proves the whole
// record → dispatch loop end to end.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Test','test')", [loc])

  const contact = await new ContactsRepo(db, loc).upsertByMatch(
    { name: 'Alex Mercer', email: 'Alex@example.com' },
    'manual',
  )

  const proposal = await new ProposalsRepo(db, loc).create({
    title: 'Marketing retainer',
    slug: 'marketing-retainer',
    contactId: contact.id,
    status: 'sent',
    content: {
      intro: 'Here is what we propose for Q3.',
      line_items: [
        { description: 'Strategy retainer', quantity: 2, unit_amount: 150000 },
        { description: 'Setup', quantity: 1, unit_amount: 50000 },
      ],
      terms: 'Month to month. Cancel anytime with 30 days notice.',
    },
  })

  // Live workflow keyed on the dedicated proposal_signed trigger.
  const wf = await new WorkflowsRepo(db, loc).create({
    name: 'Proposal accepted',
    triggerType: 'proposal_signed',
  })
  await new WorkflowsRepo(db, loc).update(wf.id, { status: 'live' })
  await new WorkflowActionsRepo(db, loc).replaceAll(wf.id, [
    { type: 'add_tag', config: { tag: 'closed-won' } },
  ])

  const dispatch = async (e: Parameters<typeof dispatchWorkflowEvent>[1]) => {
    await dispatchWorkflowEvent({ db }, e)
  }
  const app = new Hono<AppEnv>()
  app.route('/', publicProposalsRoute({ db, dispatch }))
  return { db, loc, app, contactId: contact.id, proposalId: proposal.id }
}

test('GET /:loc/:slug renders the sent proposal and marks it viewed', async () => {
  const { app, db } = await setup()
  const res = await app.request('/loc_test/marketing-retainer')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('Marketing retainer')
  expect(html).toContain('$3,500.00') // derived total
  expect(html).toContain('action="/api/public/proposals/loc_test/marketing-retainer/sign"')

  // Opening a sent proposal honestly advances it to viewed.
  const [row] = await db.query<{ status: string }>('SELECT status FROM proposals WHERE slug=$1', [
    'marketing-retainer',
  ])
  expect(row?.status).toBe('viewed')
})

test('GET /:loc/:slug is a styled html 404 for an unknown slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('text/html')
  expect((await res.text()).toLowerCase()).toContain('not found')
})

test('GET /:loc/:slug is 404 for a draft proposal (never sent)', async () => {
  const { app, db } = await setup()
  await db.query("UPDATE proposals SET status='draft' WHERE slug='marketing-retainer'")
  const res = await app.request('/loc_test/marketing-retainer')
  expect(res.status).toBe(404)
})

test('POST sign records the signature, flips to signed, and fires proposal_signed', async () => {
  const { app, db, contactId, proposalId } = await setup()

  const res = await app.request('/loc_test/marketing-retainer/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signer_name: 'Alex Mercer' }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; signer_name: string; signed_at: string }
  expect(body.ok).toBe(true)
  expect(body.signer_name).toBe('Alex Mercer')
  expect(body.signed_at).toBeTruthy()

  // The proposal is honestly signed: real name + timestamp stored.
  const [row] = await db.query<{ status: string; signer_name: string; signed_at: string }>(
    'SELECT status, signer_name, signed_at FROM proposals WHERE id=$1',
    [proposalId],
  )
  expect(row?.status).toBe('signed')
  expect(row?.signer_name).toBe('Alex Mercer')
  expect(row?.signed_at).toBeTruthy()

  // The proposal_signed workflow ran against the linked contact.
  const [contact] = await db.query<{ tags: string[] }>('SELECT tags FROM contacts WHERE id=$1', [
    contactId,
  ])
  expect(contact?.tags).toContain('closed-won')

  // A timeline event was logged for the contact.
  const timeline = await db.query<{ type: string }>(
    'SELECT type FROM timeline_events WHERE contact_id=$1',
    [contactId],
  )
  expect(timeline.some((t) => t.type === 'proposal_signed')).toBe(true)
})

test('POST sign rejects an empty signer name (400)', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/marketing-retainer/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signer_name: '   ' }),
  })
  expect(res.status).toBe(400)
})

test('POST sign on an already-signed proposal echoes the stored signature (idempotent)', async () => {
  const { app } = await setup()
  await app.request('/loc_test/marketing-retainer/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signer_name: 'Alex Mercer' }),
  })
  // A second sign attempt (e.g. double submit) doesn't overwrite — it echoes.
  const res = await app.request('/loc_test/marketing-retainer/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signer_name: 'Someone Else' }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; signer_name: string }
  expect(body.ok).toBe(true)
  expect(body.signer_name).toBe('Alex Mercer') // the original, not the second attempt
})

test('POST decline flips to declined; signing afterward is refused (409)', async () => {
  const { app, db } = await setup()
  const declineRes = await app.request('/loc_test/marketing-retainer/decline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect(declineRes.status).toBe(200)

  const [row] = await db.query<{ status: string }>('SELECT status FROM proposals WHERE slug=$1', [
    'marketing-retainer',
  ])
  expect(row?.status).toBe('declined')

  // A declined proposal can't then be signed — we never overwrite a decision.
  const signRes = await app.request('/loc_test/marketing-retainer/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signer_name: 'Alex Mercer' }),
  })
  expect(signRes.status).toBe(409)
})

test('POST sign is 404 for an unknown proposal slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signer_name: 'Alex Mercer' }),
  })
  expect(res.status).toBe(404)
})

