import { FakeDatabase } from '../db/fake-database'
import { WorkflowActionsRepo } from './workflow-actions-repo'

test('listByWorkflow scopes to location + workflow, ordered by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1', position: 0 }])
  const repo = new WorkflowActionsRepo(db, 'locA')

  await repo.listByWorkflow('wf1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY position/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'wf1'])
})

test('replaceAll deletes existing rows for the workflow first', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // delete returns nothing
  const repo = new WorkflowActionsRepo(db, 'locA')

  await repo.replaceAll('wf1', [])
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM workflow_actions/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND workflow_id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'wf1'])
})

test('replaceAll with an empty list issues only the delete (no insert)', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new WorkflowActionsRepo(db, 'locA')

  const out = await repo.replaceAll('wf1', [])
  expect(out).toEqual([])
  expect(db.calls.length).toBe(1) // delete only
})

test('replaceAll clears and re-inserts in ONE atomic CTE statement reusing $1/$2', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1' }, { id: 'a2' }]) // the single CTE statement RETURNING the new rows
  const repo = new WorkflowActionsRepo(db, 'locA')

  const out = await repo.replaceAll('wf1', [
    { type: 'add_tag', config: { tag: 'lead' } },
    { type: 'send_sms', config: { body: 'Hi {{first_name}}' } },
  ])
  expect(out).toEqual([{ id: 'a1' }, { id: 'a2' }])

  // ONE call: the delete and the insert ride a single statement, so a failing
  // insert can never strand the workflow with its old steps gone and none added.
  expect(db.calls).toHaveLength(1)
  const call = db.calls[0]
  expect(call?.sql).toMatch(/DELETE FROM workflow_actions/i)
  expect(call?.sql).toMatch(/INSERT INTO workflow_actions/i)
  // two value groups, positions inlined as 0 and 1, location/workflow reused
  expect(call?.sql).toMatch(/\(\$3,\$1,\$2,0,\$4,\$5\)/)
  expect(call?.sql).toMatch(/\(\$6,\$1,\$2,1,\$7,\$8\)/)
  // params: [location, workflowId, id0, type0, config0, id1, type1, config1]
  const params = call?.params ?? []
  expect(params[0]).toBe('locA')
  expect(params[1]).toBe('wf1')
  expect(params).toContain('add_tag')
  expect(params).toContain('send_sms')
  expect(params).toContain(JSON.stringify({ tag: 'lead' }))
  expect(params).toContain(JSON.stringify({ body: 'Hi {{first_name}}' }))
})
