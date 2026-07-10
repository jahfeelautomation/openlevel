import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { proposalsRoute } from './proposals'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', proposalsRoute({ db }))
  return app
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists proposals scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', title: 'Retainer', slug: 'retainer', status: 'sent' }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { proposals: { id: string }[] }
  expect(body.proposals[0]?.id).toBe('p1')
  // No server-computed total — the row carries its line items and the client
  // derives the dollar figure the same way the public page does.
  expect(body.proposals[0]).not.toHaveProperty('total_cents')
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a proposal, seeds the real starter document, defaults to draft (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p_new', location_id: 'locA', title: 'New deal', slug: 'new-deal', status: 'draft' }])
  const res = await jsonReq(harness(db), '/', 'POST', { title: 'New deal', slug: 'new-deal' })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: boolean; proposal: { id: string } }
  expect(body.ok).toBe(true)
  expect(body.proposal.id).toBe('p_new')
  // create is scoped to location ($1) and seeds a real starter with line items.
  expect(db.calls[0]?.params?.[0]).toBe('locA')
  expect(db.calls[0]?.params).toContain('draft')
  const content = db.calls[0]?.params?.find((p) => typeof p === 'string' && p.includes('"line_items"'))
  expect(typeof content).toBe('string')
  expect(content).toContain('Monthly management') // a genuine starter line
  expect(content).toContain('150000') // setup amount, in cents
})

test('POST / rejects an empty title (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/', 'POST', { title: '', slug: 'x' })
  expect(res.status).toBe(400)
})

test('POST / rejects a bad slug (400)', async () => {
  const db = new FakeDatabase()
  const res = await jsonReq(harness(db), '/', 'POST', { title: 'Ok', slug: 'Not A Slug' })
  expect(res.status).toBe(400)
})

test('GET /:id returns the proposal', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', title: 'Retainer', slug: 'retainer', status: 'sent' }])
  const res = await harness(db).request('/p1')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { proposal: { id: string } }
  expect(body.proposal.id).toBe('p1')
  expect(db.calls[0]?.params).toEqual(['locA', 'p1']) // scoped get
})

test('GET /:id is 404 when the proposal is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id edits the body (line items survive the round trip)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', title: 'Renamed' }])
  const content = {
    intro: 'Updated intro',
    line_items: [{ description: 'Custom build', quantity: 1, unit_amount: 250000 }],
    terms: 'Net 30.',
  }
  const res = await jsonReq(harness(db), '/p1', 'PATCH', { title: 'Renamed', content })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, proposal: { id: 'p1' } })
  expect(db.calls[0]?.params?.[0]).toBe('locA')
  expect(db.calls[0]?.params).toContain(JSON.stringify(content))
  expect(db.calls[0]?.params?.[db.calls[0].params.length - 1]).toBe('p1') // id pinned last
})

test('PATCH /:id is 404 when nothing matched', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // update RETURNING -> none
  const res = await jsonReq(harness(db), '/missing', 'PATCH', { title: 'x' })
  expect(res.status).toBe(404)
})

test('POST /:id/send flips a draft to sent and logs a timeline event for the contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', title: 'Retainer', slug: 'retainer', status: 'sent', contact_id: 'c1', content: {} }]) // markSent RETURNING
  db.enqueue([{ id: 'ev1' }]) // timeline insert RETURNING
  const res = await jsonReq(harness(db), '/p1/send', 'POST', {})

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, proposal: { status: 'sent' } })
  // markSent scoped to location + id.
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
  // A proposal_sent timeline event was written for the linked contact.
  const timelineCall = db.calls[1]
  expect(timelineCall?.sql).toMatch(/insert into timeline_events/i)
  expect(timelineCall?.params).toContain('proposal_sent')
  expect(timelineCall?.params).toContain('c1')
})

test('POST /:id/send is 404 when the proposal is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // markSent -> none
  const res = await jsonReq(harness(db), '/missing/send', 'POST', {})
  expect(res.status).toBe(404)
})

test('POST /:id/send on a contact-less proposal still succeeds without a timeline write', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', title: 'Retainer', slug: 'retainer', status: 'sent', contact_id: null, content: {} }])
  const res = await jsonReq(harness(db), '/p1/send', 'POST', {})

  expect(res.status).toBe(200)
  expect(db.calls).toHaveLength(1) // only the markSent; no timeline insert
})
