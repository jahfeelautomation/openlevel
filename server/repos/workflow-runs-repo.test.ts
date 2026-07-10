import { FakeDatabase } from '../db/fake-database'
import { WorkflowRunsRepo, type WorkflowRunStep } from './workflow-runs-repo'

test('constructor enforces the tenancy guard', () => {
  expect(() => new WorkflowRunsRepo(new FakeDatabase(), '')).toThrow(/locationId is required/)
})

test('create sets location_id as $1 and carries workflow/contact/trigger', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'run1', location_id: 'locA', workflow_id: 'wf1', status: 'running' }])
  const repo = new WorkflowRunsRepo(db, 'locA')
  const run = await repo.create({ workflowId: 'wf1', contactId: 'c1', triggerType: 'contact_created' })

  expect(run.id).toBe('run1')
  const p = db.calls[0]?.params
  expect(p?.[0]).toBe('locA') // $1 = location_id
  expect(p?.[2]).toBe('wf1')
  expect(p?.[3]).toBe('c1')
  expect(p?.[4]).toBe('contact_created')
})

test('appendStep concatenates one step as jsonb and updates status, scoped to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'run1', status: 'running' }])
  const repo = new WorkflowRunsRepo(db, 'locA')
  const step: WorkflowRunStep = { position: 0, type: 'add_tag', status: 'done', detail: 'Added tag "vip"' }
  await repo.appendStep('run1', step, 'running')

  const call = db.calls[0]
  expect(call?.sql).toMatch(/steps\s*=\s*steps\s*\|\|/i) // appends, never overwrites
  const p = call?.params
  expect(p?.[0]).toBe('locA')
  expect(JSON.parse(p?.[1] as string)).toEqual([step]) // wrapped in an array for ||
  expect(p?.[2]).toBe('running')
  expect(p?.[3]).toBe('run1')
})

test('finish stamps status + finished_at, scoped to location+id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'run1', status: 'completed' }])
  const repo = new WorkflowRunsRepo(db, 'locA')
  const run = await repo.finish('run1', 'completed')

  expect(run?.status).toBe('completed')
  expect(db.calls[0]?.sql).toMatch(/finished_at\s*=\s*now\(\)/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'completed', 'run1'])
})

test('listByWorkflow scopes to location, filters by workflow, newest-first with a limit', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'run1' }])
  const repo = new WorkflowRunsRepo(db, 'locA')
  await repo.listByWorkflow('wf1')

  expect(db.calls[0]?.sql).toMatch(/order by started_at desc/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'wf1', 20])
})

test('get scopes the lookup to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'run1', location_id: 'locA' }])
  const repo = new WorkflowRunsRepo(db, 'locA')
  const run = await repo.get('run1')

  expect(run?.id).toBe('run1')
  expect(db.calls[0]?.params).toEqual(['locA', 'run1'])
})
