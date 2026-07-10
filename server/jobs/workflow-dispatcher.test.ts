import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PgliteDatabase } from '../db/pglite-database'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import type { TriggerType } from '../lib/automation-vocab'
import { dispatchWorkflowEvent } from './workflow-dispatcher'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Test','test')", [loc])
  await db.query(
    "INSERT INTO contacts (id, location_id, name, first_name) VALUES ('c1',$1,'Derek','Derek')",
    [loc],
  )

  async function makeWorkflow(name: string, trigger: TriggerType, status: string, tag: string) {
    const wf = await new WorkflowsRepo(db, loc).create({ name, triggerType: trigger })
    if (status === 'live') await new WorkflowsRepo(db, loc).update(wf.id, { status: 'live' })
    await new WorkflowActionsRepo(db, loc).replaceAll(wf.id, [{ type: 'add_tag', config: { tag } }])
    return wf
  }

  await makeWorkflow('Live match', 'contact_created', 'live', 'A')
  await makeWorkflow('Draft match', 'contact_created', 'draft', 'B')
  await makeWorkflow('Live other trigger', 'inbound_message', 'live', 'C')
  return { db, loc }
}

test('dispatch enrolls the contact into only live workflows for the matching trigger', async () => {
  const { db, loc } = await setup()

  const runs = await dispatchWorkflowEvent(
    { db },
    { locationId: loc, triggerType: 'contact_created', contactId: 'c1' },
  )

  // Only the one live contact_created workflow fires.
  expect(runs).toHaveLength(1)
  expect(runs[0]?.status).toBe('completed')

  const [contact] = await db.query<{ tags: string[] }>('SELECT tags FROM contacts WHERE id=$1', ['c1'])
  expect(contact?.tags).toContain('A') // live + matching trigger ran
  expect(contact?.tags).not.toContain('B') // draft did not
  expect(contact?.tags).not.toContain('C') // wrong trigger did not
})

test('dispatch is a no-op (no runs) when no live workflow matches the trigger', async () => {
  const { db, loc } = await setup()

  const runs = await dispatchWorkflowEvent(
    { db },
    { locationId: loc, triggerType: 'opportunity_created', contactId: 'c1' },
  )
  expect(runs).toEqual([])
})
