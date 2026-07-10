import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PgliteDatabase } from '../db/pglite-database'
import { CustomValuesRepo } from '../repos/custom-values-repo'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { WorkflowRunsRepo } from '../repos/workflow-runs-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import { type WorkflowActionInput } from '../repos/workflows-repo'
import { MAX_TIMEOUT_MS, runWorkflow, timeoutChunks, waitMs } from './workflow-runner'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// Spin up a real in-process Postgres, seed one location + contact + a live
// workflow with the given steps, and hand back everything the test needs.
async function harness(steps: WorkflowActionInput[], contact = { first: 'Derek', last: 'Sull' }) {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Test','test')", [loc])
  const contactId = 'c_test'
  await db.query(
    'INSERT INTO contacts (id, location_id, name, first_name, last_name) VALUES ($1,$2,$3,$4,$5)',
    [contactId, loc, `${contact.first} ${contact.last}`, contact.first, contact.last],
  )
  const wf = await new WorkflowsRepo(db, loc).create({ name: 'Test wf', triggerType: 'contact_created' })
  await new WorkflowActionsRepo(db, loc).replaceAll(wf.id, steps)
  return { db, loc, contactId, workflowId: wf.id }
}

test('runs every step in order, mutates data for real, and completes the run', async () => {
  const { db, loc, contactId, workflowId } = await harness([
    { type: 'send_sms', config: { body: 'Hi {{first_name}}, welcome!' } },
    { type: 'add_tag', config: { tag: 'new-lead' } },
  ])

  const run = await runWorkflow({ db }, { locationId: loc, workflowId, contactId, triggerType: 'contact_created' })

  expect(run.status).toBe('completed')
  expect(run.steps).toHaveLength(2)
  expect(run.steps.every((s) => s.status === 'done')).toBe(true)
  expect(run.steps[0]?.detail).toContain('Hi Derek, welcome!') // merge fields rendered

  // add_tag really wrote to the contact (not a simulated effect).
  const [contact] = await db.query<{ tags: string[] }>('SELECT tags FROM contacts WHERE id=$1', [contactId])
  expect(contact?.tags).toContain('new-lead')

  // send_sms left an honest activity record on the contact's timeline.
  const timeline = await db.query<{ type: string }>(
    "SELECT type FROM timeline_events WHERE contact_id=$1 AND type='automation_action'",
    [contactId],
  )
  expect(timeline).toHaveLength(1)
})

test('resolves a {{custom_values.<key>}} merge tag from the location in a send_sms body', async () => {
  const { db, loc, contactId, workflowId } = await harness([
    { type: 'send_sms', config: { body: 'Hi {{first_name}}, this is {{custom_values.business_name}}' } },
  ])
  // The location defines the business-name constant the template references.
  await new CustomValuesRepo(db, loc).create({ name: 'Business Name', value: 'Lighthouse Realty' })

  const run = await runWorkflow({ db }, { locationId: loc, workflowId, contactId, triggerType: 'contact_created' })

  expect(run.status).toBe('completed')
  // Both the contact token and the location custom value resolved in one pass.
  expect(run.steps[0]?.detail).toContain('Hi Derek, this is Lighthouse Realty')
})

test('a contactless step is skipped, not failed, and the run still completes', async () => {
  const { db, loc, workflowId } = await harness([{ type: 'add_tag', config: { tag: 'x' } }])

  const run = await runWorkflow({ db }, { locationId: loc, workflowId, contactId: null, triggerType: 'contact_created' })

  expect(run.status).toBe('completed')
  expect(run.steps[0]?.status).toBe('skipped')
})

test('wait pauses the run and a scheduled resume finishes the remaining steps', async () => {
  const { db, loc, contactId, workflowId } = await harness([
    { type: 'add_tag', config: { tag: 'before' } },
    { type: 'wait', config: { minutes: 30 } },
    { type: 'add_tag', config: { tag: 'after' } },
  ])

  // Capture the deferred resume instead of really sleeping 30 minutes.
  let resume: (() => Promise<unknown>) | null = null
  const schedule = (thunk: () => Promise<unknown>) => {
    resume = thunk
  }

  const paused = await runWorkflow(
    { db, schedule },
    { locationId: loc, workflowId, contactId, triggerType: 'contact_created' },
  )

  // Paused on the wait: first tag applied, wait recorded, third step not yet run.
  expect(paused.status).toBe('waiting')
  expect(paused.steps).toHaveLength(2)
  expect(paused.steps[1]?.type).toBe('wait')
  let [c1] = await db.query<{ tags: string[] }>('SELECT tags FROM contacts WHERE id=$1', [contactId])
  expect(c1?.tags).toContain('before')
  expect(c1?.tags).not.toContain('after')

  // Fire the resume the scheduler captured.
  expect(resume).toBeTruthy()
  await resume!()

  const finished = await new WorkflowRunsRepo(db, loc).get(paused.id)
  expect(finished?.status).toBe('completed')
  expect(finished?.steps).toHaveLength(3)
  const [c2] = await db.query<{ tags: string[] }>('SELECT tags FROM contacts WHERE id=$1', [contactId])
  expect(c2?.tags).toContain('after')
})

test('a workflow deleted during the wait fails the resume cleanly instead of throwing', async () => {
  const { db, loc, contactId, workflowId } = await harness([
    { type: 'add_tag', config: { tag: 'before' } },
    { type: 'wait', config: { minutes: 30 } },
    { type: 'add_tag', config: { tag: 'after' } },
  ])

  let resume: (() => Promise<unknown>) | null = null
  const schedule = (thunk: () => Promise<unknown>) => {
    resume = thunk
  }

  const paused = await runWorkflow(
    { db, schedule },
    { locationId: loc, workflowId, contactId, triggerType: 'contact_created' },
  )
  expect(paused.status).toBe('waiting')

  // The operator deletes the workflow while a run is paused on its wait step.
  await db.query('DELETE FROM workflows WHERE id=$1', [workflowId])

  // Firing the captured resume must RESOLVE, not throw. The old code threw a
  // "workflow not found" error here — and because the resume runs inside a
  // fire-and-forget scheduled callback, that throw was an unhandled rejection.
  expect(resume).toBeTruthy()
  await resume!()

  // The remaining step never ran (no 'after' tag), and the run is never left
  // dangling in 'waiting' — it is closed out (or cascaded away with its workflow).
  const [c2] = await db.query<{ tags: string[] }>('SELECT tags FROM contacts WHERE id=$1', [contactId])
  expect(c2?.tags ?? []).not.toContain('after')
  const after = await new WorkflowRunsRepo(db, loc).get(paused.id)
  expect(after?.status ?? 'failed').not.toBe('waiting')
})

test('waitMs sums supported units into milliseconds; unparseable -> 0', () => {
  expect(waitMs({ seconds: 30 })).toBe(30_000)
  expect(waitMs({ minutes: 5 })).toBe(300_000)
  expect(waitMs({ hours: 2 })).toBe(7_200_000)
  expect(waitMs({ days: 1 })).toBe(86_400_000)
  expect(waitMs({ minutes: 1, seconds: 30 })).toBe(90_000)
  expect(waitMs({})).toBe(0)
  expect(waitMs({ minutes: -5 })).toBe(0) // negatives ignored, never a negative delay
})

test('timeoutChunks splits a multi-week wait into setTimeout-safe pieces', () => {
  // A short wait fits in one setTimeout and is returned untouched.
  expect(timeoutChunks(300_000)).toEqual([300_000])
  // setTimeout stores its delay in a 32-bit int: a larger value silently clamps
  // to 1ms and fires immediately, so a 30-day drip wait must be split or it
  // would fire the follow-up almost instantly.
  const ms = waitMs({ days: 30 })
  expect(ms).toBeGreaterThan(MAX_TIMEOUT_MS)
  const chunks = timeoutChunks(ms)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.every((c) => c <= MAX_TIMEOUT_MS)).toBe(true)
  // No time is lost or invented across the chunks.
  expect(chunks.reduce((a, b) => a + b, 0)).toBe(ms)
  // A delay exactly at the ceiling stays one chunk; one past it splits in two.
  expect(timeoutChunks(MAX_TIMEOUT_MS)).toEqual([MAX_TIMEOUT_MS])
  expect(timeoutChunks(MAX_TIMEOUT_MS + 1)).toEqual([MAX_TIMEOUT_MS, 1])
  // Zero / unparseable wait fires on the next tick.
  expect(timeoutChunks(0)).toEqual([0])
})
