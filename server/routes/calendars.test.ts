import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { calendarsRoute } from './calendars'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', calendarsRoute({ db }))
  return app
}

function patchJson(app: Hono<AppEnv>, path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists calendars scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cal1', location_id: 'locA', name: 'Inspections' }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ calendars: [{ id: 'cal1', location_id: 'locA', name: 'Inspections' }] })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / creates a calendar (201) with location_id set', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cal_new', location_id: 'locA', name: 'Consults' }])
  const res = await harness(db).request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Consults' }),
  })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, calendar: { id: 'cal_new' } })
  expect(db.calls[0]?.params[0]).toBe('locA') // $1 = location_id
})

test('POST / rejects an empty name (400)', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '' }),
  })
  expect(res.status).toBe(400)
})

test('PATCH /:id updates booking config and runs the slug-uniqueness guard first', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // getByBookingSlug → slug is free
  db.enqueue([{ id: 'cal1', booking_enabled: true, booking_slug: 'cash-offer' }]) // update RETURNING
  const res = await patchJson(harness(db), '/cal1', {
    bookingEnabled: true,
    bookingSlug: 'cash-offer',
    timezone: 'America/New_York',
    availability: [{ weekday: 1, start: '09:00', end: '12:00' }],
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, calendar: { id: 'cal1' } })
  // the slug lookup ran first, location-scoped
  expect(db.calls[0]?.sql).toMatch(/booking_slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cash-offer'])
  // then the dynamic update with the booking columns + json availability
  expect(db.calls[1]?.sql).toMatch(/booking_enabled=\$2/i)
  expect(db.calls[1]?.params).toContain('America/New_York')
})

test('PATCH /:id is 409 when the booking slug is taken by another calendar', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'other', booking_slug: 'cash-offer' }]) // slug owned by a different cal
  const res = await patchJson(harness(db), '/cal1', { bookingSlug: 'cash-offer' })

  expect(res.status).toBe(409)
  expect((await res.json()).error).toBe('slug taken')
  expect(db.calls).toHaveLength(1) // never reached the update
})

test('PATCH /:id allows re-saving a calendar with its own existing slug', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cal1', booking_slug: 'cash-offer' }]) // slug owner IS this calendar
  db.enqueue([{ id: 'cal1', booking_blurb: 'Updated' }]) // update RETURNING
  const res = await patchJson(harness(db), '/cal1', {
    bookingSlug: 'cash-offer',
    bookingBlurb: 'Updated',
  })
  expect(res.status).toBe(200)
})

test('PATCH /:id rejects an invalid (non-url-safe) slug (400)', async () => {
  const db = new FakeDatabase()
  const res = await patchJson(harness(db), '/cal1', { bookingSlug: 'Cash Offer!' })
  expect(res.status).toBe(400)
})

test('PATCH /:id with an empty patch is 400', async () => {
  const db = new FakeDatabase()
  const res = await patchJson(harness(db), '/cal1', {})
  expect(res.status).toBe(400)
})

test('PATCH /:id is 404 when the calendar is not in this location', async () => {
  const db = new FakeDatabase()
  // No slug in the patch → no slug guard query; the update is the only call.
  db.enqueue([]) // update RETURNING → none
  const res = await patchJson(harness(db), '/missing', { bookingHeadline: 'Hi' })
  expect(res.status).toBe(404)
})

test('GET /appointments defaults to a now..+30d range when no query', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1' }])
  const res = await harness(db).request('/appointments')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ appointments: [{ id: 'a1' }] })
  // $1 = location, $2 = from, $3 = to; both timestamps present and ordered.
  const params = db.calls[0]?.params as string[]
  expect(params[0]).toBe('locA')
  expect(Date.parse(params[1]!)).not.toBeNaN()
  expect(Date.parse(params[2]!)).toBeGreaterThan(Date.parse(params[1]!))
})

test('GET /appointments passes explicit from/to through', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1' }])
  await harness(db).request('/appointments?from=2026-06-01T00:00:00Z&to=2026-06-08T00:00:00Z')

  expect(db.calls[0]?.params).toEqual([
    'locA',
    '2026-06-01T00:00:00Z',
    '2026-06-08T00:00:00Z',
  ])
})

test('POST /appointments books an appointment (201) with location_id set', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cal1', location_id: 'locA', name: 'Inspections' }]) // calendar ownership get
  db.enqueue([{ id: 'a_new', location_id: 'locA', title: 'Inspection' }]) // insert RETURNING
  const res = await harness(db).request('/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendarId: 'cal1',
      title: 'Inspection',
      startsAt: '2026-06-04T15:00:00Z',
      endsAt: '2026-06-04T15:30:00Z',
    }),
  })

  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, appointment: { id: 'a_new' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'cal1']) // calendar get scoped to location
  expect(db.calls[1]?.params[0]).toBe('locA') // then the insert, also scoped
})

test('POST /appointments rejects an unknown or foreign calendar (400, no insert)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // calendar ownership get → none (foreign or missing)
  const res = await harness(db).request('/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendarId: 'calX',
      title: 'Inspection',
      startsAt: '2026-06-04T15:00:00Z',
      endsAt: '2026-06-04T15:30:00Z',
    }),
  })

  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('unknown calendar')
  expect(db.calls.length).toBe(1) // only the ownership lookup — no insert attempted
})

test('POST /appointments is 409 when the calendar+instant is already taken', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cal1', location_id: 'locA' }]) // calendar ownership get succeeds
  db.enqueueError({ code: '23505' }) // the no-double-book unique index rejects the insert
  const res = await harness(db).request('/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendarId: 'cal1',
      title: 'Inspection',
      startsAt: '2026-06-04T15:00:00Z',
      endsAt: '2026-06-04T15:30:00Z',
    }),
  })

  expect(res.status).toBe(409)
  expect((await res.json()).error).toBe('time already booked')
})

test('POST /appointments still surfaces a non-conflict DB error (not a false 409)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cal1', location_id: 'locA' }]) // calendar ownership get succeeds
  db.enqueueError({ code: '23503' }) // a foreign-key violation must NOT be masked as a conflict
  await expect(
    harness(db).request('/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarId: 'cal1',
        title: 'Inspection',
        startsAt: '2026-06-04T15:00:00Z',
        endsAt: '2026-06-04T15:30:00Z',
      }),
    }),
  ).rejects.toBeTruthy()
})

test('POST /appointments rejects an empty title (400)', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendarId: 'cal1',
      title: '',
      startsAt: '2026-06-04T15:00:00Z',
      endsAt: '2026-06-04T15:30:00Z',
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /appointments rejects a non-datetime startsAt (400, no DB call)', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendarId: 'cal1',
      title: 'Inspection',
      startsAt: 'soon',
      endsAt: '2026-06-04T15:30:00Z',
    }),
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0) // rejected at validation, never reached the DB
})

test('POST /appointments rejects an end at or before the start (400)', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendarId: 'cal1',
      title: 'Inspection',
      startsAt: '2026-06-04T15:30:00Z',
      endsAt: '2026-06-04T15:00:00Z', // backwards — must not store a negative-length slot
    }),
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /appointments/:id rejects a reschedule whose end precedes the start (400)', async () => {
  const db = new FakeDatabase()
  const res = await patchJson(harness(db), '/appointments/a1', {
    startsAt: '2026-06-05T10:30:00Z',
    endsAt: '2026-06-05T10:00:00Z',
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('PATCH /appointments/:id reschedules when both timestamps given', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1', starts_at: '2026-06-05T10:00:00Z' }])
  const res = await patchJson(harness(db), '/appointments/a1', {
    startsAt: '2026-06-05T10:00:00Z',
    endsAt: '2026-06-05T10:30:00Z',
  })

  expect(res.status).toBe(200)
  expect(db.calls[0]?.params).toEqual([
    'locA',
    '2026-06-05T10:00:00Z',
    '2026-06-05T10:30:00Z',
    'a1',
  ])
})

test('PATCH /appointments/:id sets status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1', status: 'completed' }])
  const res = await patchJson(harness(db), '/appointments/a1', { status: 'completed' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, appointment: { status: 'completed' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'completed', 'a1'])
})

test('PATCH /appointments/:id with neither reschedule nor status is 400', async () => {
  const db = new FakeDatabase()
  const res = await patchJson(harness(db), '/appointments/a1', {})
  expect(res.status).toBe(400)
})

test('PATCH /appointments/:id is 404 when not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // setStatus RETURNING -> none
  const res = await patchJson(harness(db), '/appointments/missing', { status: 'confirmed' })
  expect(res.status).toBe(404)
})

test('PATCH /appointments/:id rejects an invalid status (400)', async () => {
  const db = new FakeDatabase()
  const res = await patchJson(harness(db), '/appointments/a1', { status: 'banana' })
  expect(res.status).toBe(400)
})
