import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { surveysRoute } from './surveys'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', surveysRoute({ db }))
  return app
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists surveys with their honest submission count, scoped to location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', name: 'Seller intake', slug: 'seller-intake', status: 'published', submissions: 4 }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { surveys: { id: string; submissions: number }[] }
  expect(body.surveys[0]?.id).toBe('sv1')
  expect(body.surveys[0]?.submissions).toBe(4)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a survey, auto-seeds the two-step starter, defaults to draft (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv_new', location_id: 'locA', name: 'New survey', slug: 'new-survey', status: 'draft' }])
  const res = await jsonReq(harness(db), '/', 'POST', { name: 'New survey', slug: 'new-survey' })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: boolean; survey: { id: string } }
  expect(body.ok).toBe(true)
  expect(body.survey.id).toBe('sv_new')
  // create is scoped to location ($1) and seeds a real multi-step starter
  expect(db.calls[0]?.params?.[0]).toBe('locA')
  expect(db.calls[0]?.params).toContain('draft')
  const content = db.calls[0]?.params?.find((p) => typeof p === 'string' && p.includes('"steps"'))
  expect(typeof content).toBe('string')
  expect(content).toContain('full_name') // starter step-1 field
  expect(content).toContain('step-2') // a genuine second step
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/', 'POST', { name: '', slug: 'x' })
  expect(res.status).toBe(400)
})

test('POST / rejects a bad slug (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/', 'POST', { name: 'Ok', slug: 'Not A Slug' })
  expect(res.status).toBe(400)
})

test('GET /:id returns the survey with its recent submissions', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', name: 'Seller intake', slug: 'seller-intake', status: 'published' }]) // survey get
  db.enqueue([
    { id: 'ss2', survey_id: 'sv1', values: { address: '2 Elm' } },
    { id: 'ss1', survey_id: 'sv1', values: { address: '1 Oak' } },
  ]) // submissions, newest first
  const res = await harness(db).request('/sv1')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { survey: { id: string }; submissions: { id: string }[] }
  expect(body.survey.id).toBe('sv1')
  expect(body.submissions).toHaveLength(2)
  expect(body.submissions[0]?.id).toBe('ss2')
  expect(db.calls[0]?.params).toEqual(['locA', 'sv1']) // survey get scoped
  expect(db.calls[1]?.params).toEqual(['locA', 'sv1']) // submissions scoped to location + survey
})

test('GET /:id is 404 when the survey is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // survey get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id with status publishes the survey', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', status: 'published' }])
  const res = await jsonReq(harness(db), '/sv1', 'PATCH', { status: 'published' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, survey: { status: 'published' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'published', 'sv1'])
})

test('PATCH /:id with name/content edits the survey (steps survive the round trip)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'sv1', name: 'Renamed' }])
  const content = { headline: 'New headline', steps: [{ id: 's1', title: 'One', fields: [] }] }
  const res = await jsonReq(harness(db), '/sv1', 'PATCH', { name: 'Renamed', content })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, survey: { id: 'sv1' } })
  expect(db.calls[0]?.params?.[0]).toBe('locA')
  expect(db.calls[0]?.params).toContain(JSON.stringify(content))
  expect(db.calls[0]?.params?.[db.calls[0].params.length - 1]).toBe('sv1') // id pinned last
})

test('PATCH /:id is 404 when nothing matched', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // setStatus RETURNING -> none
  const res = await jsonReq(harness(db), '/missing', 'PATCH', { status: 'published' })
  expect(res.status).toBe(404)
})
