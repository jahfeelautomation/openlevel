import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { funnelsRoute } from './funnels'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', funnelsRoute({ db }))
  return app
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists funnels with a step count, scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', name: 'Sell fast', slug: 'sell-fast', status: 'published', step_count: 2 }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { funnels: { id: string; step_count: number }[] }
  expect(body.funnels[0]?.id).toBe('fn1')
  expect(body.funnels[0]?.step_count).toBe(2)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a funnel and auto-seeds an opt-in + thank-you step (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn_new', location_id: 'locA', name: 'New funnel', slug: 'new-funnel', status: 'draft' }]) // funnel insert
  db.enqueue([{ id: 'st_optin', funnel_id: 'fn_new', type: 'opt_in', path: 'opt-in', position: 0 }]) // step 1
  db.enqueue([{ id: 'st_thanks', funnel_id: 'fn_new', type: 'thank_you', path: 'thank-you', position: 1 }]) // step 2
  const res = await jsonReq(harness(db), '/', 'POST', { name: 'New funnel', slug: 'new-funnel' })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: boolean; funnel: { id: string }; steps: { type: string }[] }
  expect(body.ok).toBe(true)
  expect(body.funnel.id).toBe('fn_new')
  expect(body.steps).toHaveLength(2)
  expect(body.steps.map((s) => s.type)).toEqual(['opt_in', 'thank_you'])
  // funnel insert is scoped to location ($1)
  expect(db.calls[0]?.params?.[0]).toBe('locA')
  // both step inserts carry the new funnel id and the location
  expect(db.calls[1]?.params).toContain('fn_new')
  expect(db.calls[2]?.params).toContain('fn_new')
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/', 'POST', { name: '', slug: 'x' })
  expect(res.status).toBe(400)
})

test('GET /:id returns the funnel with its ordered steps', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', name: 'Sell fast', slug: 'sell-fast', status: 'published' }]) // funnel get
  db.enqueue([
    { id: 'st1', funnel_id: 'fn1', position: 0, type: 'opt_in', path: 'get-offer' },
    { id: 'st2', funnel_id: 'fn1', position: 1, type: 'thank_you', path: 'thanks' },
  ]) // steps
  const res = await harness(db).request('/fn1')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { funnel: { id: string }; steps: { id: string }[] }
  expect(body.funnel.id).toBe('fn1')
  expect(body.steps).toHaveLength(2)
  expect(db.calls[0]?.params).toEqual(['locA', 'fn1']) // funnel get scoped
  expect(db.calls[1]?.params).toEqual(['locA', 'fn1']) // steps scoped to location + funnel
})

test('GET /:id is 404 when the funnel is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // funnel get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id with status publishes the funnel', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', status: 'published' }])
  const res = await jsonReq(harness(db), '/fn1', 'PATCH', { status: 'published' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, funnel: { status: 'published' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'published', 'fn1'])
})

test('PATCH /:id with name/slug renames the funnel', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', name: 'Renamed', slug: 'renamed' }])
  const res = await jsonReq(harness(db), '/fn1', 'PATCH', { name: 'Renamed', slug: 'renamed' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, funnel: { name: 'Renamed' } })
  expect(db.calls[0]?.params?.[0]).toBe('locA')
})

test('PATCH /:id is 404 when nothing matched', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // update RETURNING -> none
  const res = await jsonReq(harness(db), '/missing', 'PATCH', { status: 'published' })
  expect(res.status).toBe(404)
})

test('POST /:id/steps adds a step (201) scoped to location + funnel', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'fn1', location_id: 'locA', name: 'Sell fast', slug: 'sell-fast' }]) // funnel ownership get
  db.enqueue([{ id: 'st_new', funnel_id: 'fn1', type: 'sales', path: 'offer', position: 2 }])
  const res = await jsonReq(harness(db), '/fn1/steps', 'POST', {
    name: 'Sales page',
    type: 'sales',
    path: 'offer',
    position: 2,
    content: { headline: 'Limited offer' },
  })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, step: { id: 'st_new' } })
  const params = db.calls[1]?.params // [0] is the funnel ownership get, [1] is the insert
  expect(params?.[0]).toBe('locA') // location $1
  expect(params).toContain('fn1') // funnel id
  expect(params).toContain('sales')
})

test('POST /:id/steps is 404 when the parent funnel is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // funnel ownership get -> none
  const res = await jsonReq(harness(db), '/fnX/steps', 'POST', { name: 'X', type: 'sales', path: 'x' })
  expect(res.status).toBe(404)
  expect(db.calls.length).toBe(1) // no step insert attempted
})

test('POST /:id/steps rejects an unknown step type (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/fn1/steps', 'POST', { name: 'X', type: 'banana', path: 'x' })
  expect(res.status).toBe(400)
})

test('PATCH /:id/steps/:stepId edits a step', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'st1', funnel_id: 'fn1', name: 'Before' }]) // step ownership get
  db.enqueue([{ id: 'st1', name: 'Edited' }]) // update RETURNING
  const res = await jsonReq(harness(db), '/fn1/steps/st1', 'PATCH', {
    name: 'Edited',
    content: { headline: 'New headline' },
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, step: { id: 'st1' } })
  expect(db.calls[1]?.params?.[0]).toBe('locA') // [1] is the update
  expect(db.calls[1]?.params?.[db.calls[1].params.length - 1]).toBe('st1') // id pinned last
})

test('PATCH /:id/steps/:stepId is 404 when the step belongs to another funnel', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'st1', funnel_id: 'fnOTHER', name: 'Before' }]) // step is in a different funnel
  const res = await jsonReq(harness(db), '/fn1/steps/st1', 'PATCH', { name: 'X' })
  expect(res.status).toBe(404)
  expect(db.calls.length).toBe(1) // no update attempted
})

test('PATCH /:id/steps/:stepId is 404 when the step is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // step ownership get -> none
  const res = await jsonReq(harness(db), '/fn1/steps/missing', 'PATCH', { name: 'X' })
  expect(res.status).toBe(404)
})
