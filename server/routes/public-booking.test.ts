import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { dispatchWorkflowEvent } from '../jobs/workflow-dispatcher'
import { AppointmentsRepo } from '../repos/appointments-repo'
import { CalendarsRepo } from '../repos/calendars-repo'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import { WorkflowsRepo } from '../repos/workflows-repo'
import { publicBookingRoute } from './public-booking'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A pinned clock: Monday 2025-06-09, 04:00 in New York (EDT). The enabled
// calendar opens Mondays 9–12, so the canonical open day is "today".
const NOW = new Date('2025-06-09T08:00:00Z')
const MONDAY = '2025-06-09'
const FIRST_SLOT = '2025-06-09T13:00:00.000Z' // 9:00 AM EDT

// A booking-enabled calendar (+ a disabled one) and a LIVE appointment_booked
// workflow — so a public booking proves the whole reserve → automation loop.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Test','test')", [loc])

  const calRepo = new CalendarsRepo(db, loc)
  const cal = await calRepo.create({ name: 'Seller Consultations' })
  await calRepo.update(cal.id, {
    bookingEnabled: true,
    bookingSlug: 'cash-offer',
    timezone: 'America/New_York',
    durationMin: 30,
    slotIntervalMin: 0,
    bufferMin: 0,
    noticeMin: 0,
    rollingDays: 14,
    availability: [{ weekday: 1, start: '09:00', end: '12:00' }],
    bookingHeadline: 'Book your cash-offer call',
    bookingBlurb: 'Pick a time that works.',
  })

  // A calendar that has a slug but is NOT booking-enabled — must 404 publicly.
  const off = await calRepo.create({ name: 'Internal' })
  await calRepo.update(off.id, { bookingSlug: 'disabled-cal' })

  // A live workflow that tags whoever books — proves the dispatch fires.
  const wf = await new WorkflowsRepo(db, loc).create({
    name: 'Booking welcome',
    triggerType: 'appointment_booked',
  })
  await new WorkflowsRepo(db, loc).update(wf.id, { status: 'live' })
  await new WorkflowActionsRepo(db, loc).replaceAll(wf.id, [
    { type: 'add_tag', config: { tag: 'booked-welcome' } },
  ])

  const dispatch = async (e: Parameters<typeof dispatchWorkflowEvent>[1]) => {
    await dispatchWorkflowEvent({ db }, e)
  }
  const app = new Hono<AppEnv>()
  app.route('/', publicBookingRoute({ db, dispatch, now: () => NOW }))
  return { db, loc, app, calId: cal.id }
}

test('GET /:loc/:slug renders the booking page as a hostable html document', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/cash-offer')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('Book your cash-offer call')
  expect(html).toContain('Mon, Jun 9') // a bookable date pill
  expect(html).toContain('/api/public/booking/loc_test/cash-offer') // wired endpoints
})

test('GET /:loc/:slug is a styled 404 for an unknown slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope')
  expect(res.status).toBe(404)
  expect((await res.text()).toLowerCase()).toContain('unavailable')
})

test('GET /:loc/:slug is 404 for a calendar that is not booking-enabled', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/disabled-cal')
  expect(res.status).toBe(404)
})

test('GET slots returns the open times for the Monday and nothing on a closed day', async () => {
  const { app } = await setup()

  const mon = (await (await app.request(`/loc_test/cash-offer/slots?date=${MONDAY}`)).json()) as {
    slots: { start: string; label: string }[]
  }
  expect(mon.slots).toHaveLength(6) // 9:00 … 11:30, every 30 min
  expect(mon.slots[0]?.start).toBe(FIRST_SLOT)
  expect(mon.slots[0]?.label).toBe('9:00 AM')

  const sun = (await (await app.request('/loc_test/cash-offer/slots?date=2025-06-08')).json()) as {
    slots: unknown[]
  }
  expect(sun.slots).toHaveLength(0) // Sunday has no window
})

test('GET slots excludes a time the calendar is already booked for', async () => {
  const { app, db, loc, calId } = await setup()
  await new AppointmentsRepo(db, loc).create({
    calendarId: calId,
    title: 'Existing',
    startsAt: FIRST_SLOT,
    endsAt: '2025-06-09T13:30:00.000Z',
  })

  const mon = (await (await app.request(`/loc_test/cash-offer/slots?date=${MONDAY}`)).json()) as {
    slots: { start: string }[]
  }
  expect(mon.slots).toHaveLength(5)
  expect(mon.slots.some((s) => s.start === FIRST_SLOT)).toBe(false)
})

test('POST book reserves the slot: creates a contact + appointment, logs it, runs the live workflow', async () => {
  const { app, db, loc, calId } = await setup()

  const res = await app.request('/loc_test/cash-offer/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: FIRST_SLOT,
      end: '2025-06-09T13:30:00.000Z',
      name: 'Olivia Reed',
      email: 'olivia@example.com',
      phone: '+15125550148',
      notes: 'Looking forward to it',
    }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; appointmentId: string; contactId: string }
  expect(body.ok).toBe(true)
  expect(body.appointmentId).toBeTruthy()

  // The appointment exists on the right calendar, at the chosen instant.
  const [appt] = await db.query<{ calendar_id: string; starts_at: string; contact_id: string }>(
    'SELECT calendar_id, starts_at, contact_id FROM appointments WHERE id=$1',
    [body.appointmentId],
  )
  expect(appt?.calendar_id).toBe(calId)
  expect(new Date(appt?.starts_at ?? 0).toISOString()).toBe(FIRST_SLOT)
  expect(appt?.contact_id).toBe(body.contactId)

  // A real contact was captured AND the live appointment_booked workflow tagged it.
  const [contact] = await db.query<{ name: string; tags: string[]; source: string }>(
    'SELECT name, tags, source FROM contacts WHERE id=$1',
    [body.contactId],
  )
  expect(contact?.name).toBe('Olivia Reed')
  expect(contact?.source).toBe('booking:cash-offer')
  expect(contact?.tags).toContain('booked-welcome') // workflow ran end-to-end

  // The booking was logged to the contact's timeline.
  const timeline = await db.query<{ type: string }>(
    'SELECT type FROM timeline_events WHERE contact_id=$1',
    [body.contactId],
  )
  expect(timeline.some((t) => t.type === 'appointment_booked')).toBe(true)
})

test('POST book is 409 when the slot was taken in the meantime (double-book guard)', async () => {
  const { app } = await setup()
  const book = () =>
    app.request('/loc_test/cash-offer/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: FIRST_SLOT,
        end: '2025-06-09T13:30:00.000Z',
        name: 'First Come',
        email: 'first@example.com',
      }),
    })

  expect((await book()).status).toBe(200)
  const second = await book()
  expect(second.status).toBe(409)
  expect((await second.json()).error).toBe('slot taken')
})

test('the appointments schema forbids two live bookings at the same calendar instant', async () => {
  const { db, loc, calId } = await setup()
  const repo = new AppointmentsRepo(db, loc)
  await repo.create({
    calendarId: calId,
    title: 'First',
    startsAt: FIRST_SLOT,
    endsAt: '2025-06-09T13:30:00.000Z',
  })
  // A second LIVE appointment at the exact same calendar+instant must be refused
  // at the DATABASE, not merely by the slot snapshot the route happens to read —
  // that is what makes the booking race un-winnable rather than merely unlikely.
  await expect(
    repo.create({
      calendarId: calId,
      title: 'Second',
      startsAt: FIRST_SLOT,
      endsAt: '2025-06-09T13:30:00.000Z',
    }),
  ).rejects.toThrow()
})

test('POST book survives a concurrent double-book: exactly one 200, one 409, one row', async () => {
  const { app, db } = await setup()
  const book = (name: string, email: string) =>
    app.request('/loc_test/cash-offer/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: FIRST_SLOT, end: '2025-06-09T13:30:00.000Z', name, email }),
    })

  // Two visitors fire for the SAME slot in the same tick. Both pass the slot
  // snapshot (neither has written yet); the DB invariant must let only one land
  // and the loser must get an honest 409, never a 500.
  const [a, b] = await Promise.all([
    book('Ava Stone', 'ava@example.com'),
    book('Ben Cole', 'ben@example.com'),
  ])
  expect([a.status, b.status].sort()).toEqual([200, 409])

  const rows = await db.query<{ id: string }>(
    "SELECT id FROM appointments WHERE starts_at=$1 AND status <> 'cancelled'",
    [FIRST_SLOT],
  )
  expect(rows).toHaveLength(1)
})

test('POST book is 409 for a start time that was never offered', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/cash-offer/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: '2025-06-09T20:00:00.000Z', // 4:00 PM EDT — outside the 9–12 window
      end: '2025-06-09T20:30:00.000Z',
      name: 'Off Hours',
      email: 'off@example.com',
    }),
  })
  expect(res.status).toBe(409)
})

test('POST book is 404 for a calendar that is not booking-enabled', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/disabled-cal/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: FIRST_SLOT,
      end: '2025-06-09T13:30:00.000Z',
      name: 'Nope',
      email: 'nope@example.com',
    }),
  })
  expect(res.status).toBe(404)
})
