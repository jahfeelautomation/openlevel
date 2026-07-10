import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { workflowsRoute } from './workflows'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', workflowsRoute({ db }))
  return app
}

/** Harness that stubs the runner so test-run routes don't drive the real engine. */
function harnessWithRunner(db: FakeDatabase, locationId = 'locA') {
  const calls: unknown[] = []
  const runWorkflow = async (_deps: unknown, payload: unknown) => {
    calls.push(payload)
    return { id: 'run1', location_id: locationId, status: 'completed', steps: [] }
  }
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  // biome-ignore lint/suspicious/noExplicitAny: the stub matches the runner's call shape
  app.route('/', workflowsRoute({ db, runWorkflow: runWorkflow as any }))
  return { app, calls }
}

function sendJson(app: Hono<AppEnv>, method: string, path: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists workflows scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1', location_id: 'locA', name: 'New lead welcome' }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    workflows: [{ id: 'wf1', location_id: 'locA', name: 'New lead welcome' }],
  })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a draft workflow (201) with location_id set', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf_new', location_id: 'locA', status: 'draft' }])
  const res = await sendJson(harness(db), 'POST', '/', {
    name: 'New lead welcome',
    triggerType: 'contact_created',
  })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, workflow: { id: 'wf_new', status: 'draft' } })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('POST / rejects an unknown trigger type (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), 'POST', '/', { name: 'X', triggerType: 'nope' })
  expect(res.status).toBe(400)
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), 'POST', '/', { name: '', triggerType: 'contact_created' })
  expect(res.status).toBe(400)
})

test('GET /:id returns the workflow with its ordered actions', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1', location_id: 'locA', name: 'New lead welcome' }]) // workflow
  db.enqueue([{ id: 'a1', position: 0, type: 'add_tag' }]) // actions
  const res = await harness(db).request('/wf1')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    workflow: { id: 'wf1', location_id: 'locA', name: 'New lead welcome' },
    actions: [{ id: 'a1', position: 0, type: 'add_tag' }],
  })
  expect(db.calls[0]?.params).toEqual(['locA', 'wf1']) // get workflow
  expect(db.calls[1]?.params).toEqual(['locA', 'wf1']) // actions by workflow
})

test('GET /:id is 404 when the workflow is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id flips status and returns the updated workflow (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1', status: 'live' }]) // update RETURNING
  const res = await sendJson(harness(db), 'PATCH', '/wf1', { status: 'live' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, workflow: { status: 'live' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'live', 'wf1'])
})

test('PATCH /:id rejects an unknown status (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), 'PATCH', '/wf1', { status: 'paused' })
  expect(res.status).toBe(400)
})

test('PATCH /:id rejects an empty body (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), 'PATCH', '/wf1', {})
  expect(res.status).toBe(400)
  expect(db.calls.length).toBe(0)
})

test('PATCH /:id is 404 when the workflow is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // update returns no row
  const res = await sendJson(harness(db), 'PATCH', '/missing', { status: 'live' })
  expect(res.status).toBe(404)
})

test('PUT /:id/actions replaces the step list and returns the new actions (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1', status: 'draft' }]) // get workflow
  db.enqueue([{ id: 'a1', position: 0 }, { id: 'a2', position: 1 }]) // single CTE replaceAll, RETURNING the new rows
  const res = await sendJson(harness(db), 'PUT', '/wf1/actions', {
    actions: [
      { type: 'add_tag', config: { tag: 'lead' } },
      { type: 'send_sms', config: { body: 'Hi' } },
    ],
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    actions: [{ id: 'a1', position: 0 }, { id: 'a2', position: 1 }],
  })
})

test('PUT /:id/actions is 404 when the workflow is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get workflow -> none
  const res = await sendJson(harness(db), 'PUT', '/missing/actions', { actions: [] })
  expect(res.status).toBe(404)
})

test('PUT /:id/actions rejects an unknown action type (400)', async () => {
  const db = new FakeDatabase()
  const res = await sendJson(harness(db), 'PUT', '/wf1/actions', {
    actions: [{ type: 'launch_rocket' }],
  })
  expect(res.status).toBe(400)
})

test('POST /:id/run executes the workflow for a contact and returns the run (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'wf1', location_id: 'locA', trigger_type: 'contact_created' }]) // get workflow
  const { app, calls } = harnessWithRunner(db)
  const res = await sendJson(app, 'POST', '/wf1/run', { contactId: 'c1' })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, run: { id: 'run1', status: 'completed' } })
  // The trigger_type is carried from the workflow so the run records how it ran.
  expect(calls).toEqual([
    { locationId: 'locA', workflowId: 'wf1', contactId: 'c1', triggerType: 'contact_created' },
  ])
})

test('POST /:id/run is 404 when the workflow is missing (runner never invoked)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get workflow -> none
  const { app, calls } = harnessWithRunner(db)
  const res = await sendJson(app, 'POST', '/missing/run', { contactId: 'c1' })

  expect(res.status).toBe(404)
  expect(calls).toEqual([])
})

test('GET /:id/runs lists run history newest-first, scoped to location + workflow', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'run1', workflow_id: 'wf1', status: 'completed' }])
  const res = await harness(db).request('/wf1/runs')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ runs: [{ id: 'run1', workflow_id: 'wf1', status: 'completed' }] })
  expect(db.calls[0]?.params).toEqual(['locA', 'wf1', 20])
})
