import { Hono } from 'hono'
import { vi } from 'vitest'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import type { sendCampaign } from '../lib/sending/campaign-send'
import { campaignsRoute } from './campaigns'

function harness(db: FakeDatabase, locationId = 'locA', send?: typeof sendCampaign) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', campaignsRoute({ db, send }))
  return app
}

/** A send engine that reports every contact delivered. */
function allSentEngine(contactIds: string[]) {
  return vi.fn<typeof sendCampaign>(async () => ({
    ok: true as const,
    outcomes: contactIds.map((id) => ({ contactId: id, status: 'sent' as const, detail: null })),
    sentCount: contactIds.length,
  }))
}

function postJson(app: Hono<AppEnv>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists campaigns scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', location_id: 'locA', name: 'Spring blast' }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ campaigns: [{ id: 'cmp1', location_id: 'locA', name: 'Spring blast' }] })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a draft (201) with location_id set', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp_new', location_id: 'locA', name: 'Cash offer', status: 'draft' }])
  const res = await postJson(harness(db), '/', { name: 'Cash offer', body: 'We buy houses' })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, campaign: { id: 'cmp_new', status: 'draft' } })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await postJson(harness(db), '/', { name: '', body: 'hi' })
  expect(res.status).toBe(400)
})

test('POST / rejects an empty body (400)', async () => {
  const db = new FakeDatabase()
  const res = await postJson(harness(db), '/', { name: 'No body', body: '' })
  expect(res.status).toBe(400)
})

test('GET /:id returns the campaign with its recipients', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', location_id: 'locA', name: 'Spring blast' }]) // campaign
  db.enqueue([{ id: 'r1', campaign_id: 'cmp1' }]) // recipients
  const res = await harness(db).request('/cmp1')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    campaign: { id: 'cmp1', location_id: 'locA', name: 'Spring blast' },
    recipients: [{ id: 'r1', campaign_id: 'cmp1' }],
  })
  expect(db.calls[0]?.params).toEqual(['locA', 'cmp1']) // get campaign
  expect(db.calls[1]?.params).toEqual(['locA', 'cmp1']) // recipients by campaign
})

test('GET /:id is 404 when the campaign is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('POST /:id/send blasts a draft through the send engine and marks it sent (200)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', status: 'draft', audience_tag: null }]) // get campaign
  db.enqueue([{ id: 'c1' }, { id: 'c2' }]) // contacts list
  db.enqueue([]) // custom values map
  db.enqueue([{ id: 'r1' }, { id: 'r2' }]) // bulkInsertOutcomes RETURNING
  db.enqueue([{ id: 'cmp1', status: 'sent', sent_count: 2 }]) // markSent RETURNING
  const send = allSentEngine(['c1', 'c2'])

  const res = await harness(db, 'locA', send).request('/cmp1/send', { method: 'POST' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({
    ok: true,
    campaign: { status: 'sent' },
    delivery: { sent: 2, skipped: 0, failed: 0 },
  })
  // The engine received the audience it must fan out to.
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]?.[1]).toMatchObject({
    locationId: 'locA',
    contacts: [{ id: 'c1' }, { id: 'c2' }],
  })
  // markSent records [location, recipientCount, sentCount, id].
  expect(db.calls[4]?.params).toEqual(['locA', 2, 2, 'cmp1'])
})

test('POST /:id/send is an honest 409 when no provider is connected (stays draft)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', status: 'draft', audience_tag: null }]) // get campaign
  db.enqueue([{ id: 'c1' }]) // contacts list
  db.enqueue([]) // custom values map
  const send = vi.fn(async () => ({ ok: false as const, reason: 'no email provider connected' }))

  const res = await harness(db, 'locA', send).request('/cmp1/send', { method: 'POST' })

  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'no email provider connected' })
  // No recipient rows, no markSent — the campaign is untouched.
  expect(db.calls).toHaveLength(3)
})

test('POST /:id/send records real outcomes and counts only delivered sends', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', status: 'draft', audience_tag: null }]) // get campaign
  db.enqueue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]) // contacts list
  db.enqueue([]) // custom values map
  db.enqueue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]) // bulkInsertOutcomes RETURNING
  db.enqueue([{ id: 'cmp1', status: 'sent', sent_count: 1 }]) // markSent RETURNING
  const send = vi.fn(async () => ({
    ok: true as const,
    outcomes: [
      { contactId: 'c1', status: 'sent' as const, detail: null },
      { contactId: 'c2', status: 'skipped' as const, detail: 'unsubscribed' },
      { contactId: 'c3', status: 'failed' as const, detail: 'brevo send failed: 500' },
    ],
    sentCount: 1,
  }))

  const res = await harness(db, 'locA', send).request('/cmp1/send', { method: 'POST' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ delivery: { sent: 1, skipped: 1, failed: 1 } })
  // The per-recipient statuses ride into the insert.
  expect(db.calls[3]?.params).toContain('skipped')
  expect(db.calls[3]?.params).toContain('failed')
  // recipient_count = audience (3), sent_count = actually delivered (1).
  expect(db.calls[4]?.params).toEqual(['locA', 3, 1, 'cmp1'])
})

test('POST /:id/send segments by audience_tag when set', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', status: 'draft', audience_tag: 'seller' }]) // get campaign
  db.enqueue([{ id: 'c1' }]) // listByTag('seller')
  db.enqueue([]) // custom values map
  db.enqueue([{ id: 'r1' }]) // bulkInsertOutcomes RETURNING
  db.enqueue([{ id: 'cmp1', status: 'sent', sent_count: 1 }]) // markSent RETURNING

  const res = await harness(db, 'locA', allSentEngine(['c1'])).request('/cmp1/send', { method: 'POST' })

  expect(res.status).toBe(200)
  // audience query is the tag-membership lookup, scoped to location + tag.
  expect(db.calls[1]?.sql).toMatch(/\$2 = ANY\(tags\)/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'seller'])
})

test('POST /:id/send is 404 when the campaign is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing/send', { method: 'POST' })
  expect(res.status).toBe(404)
})

test('POST /:id/send is 409 when the campaign is already sent', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', status: 'sent', audience_tag: null }])
  const res = await harness(db).request('/cmp1/send', { method: 'POST' })
  expect(res.status).toBe(409)
})

test('POST /:id/send is 400 when the audience resolves to zero contacts', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', status: 'draft', audience_tag: 'nobody' }]) // get campaign
  db.enqueue([]) // listByTag -> none
  const res = await harness(db).request('/cmp1/send', { method: 'POST' })
  expect(res.status).toBe(400)
})
