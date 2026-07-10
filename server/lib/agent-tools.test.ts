import { FakeDatabase } from '../db/fake-database'
import type { Calendar } from '../repos/calendars-repo'
import { buildAgentTools } from './agent-tools'

const cal: Calendar = {
  id: 'cal1',
  location_id: 'locA',
  name: 'Discovery Call',
  color: 'indigo',
  duration_min: 30,
  position: 0,
  booking_enabled: true,
  booking_slug: 'discovery',
  timezone: 'America/New_York',
  slot_interval_min: 30,
  buffer_min: 0,
  notice_min: 0,
  rolling_days: 14,
  availability: [{ weekday: 1, start: '09:00', end: '17:00' }], // Mondays 9-5
  booking_headline: null,
  booking_blurb: null,
  created_at: '2026-06-01T00:00:00.000Z',
}

// 2026-06-08 is a Monday; 8:00 AM America/New_York (EDT, UTC-4) = 12:00Z.
const MON_8AM = () => new Date('2026-06-08T12:00:00.000Z')

function makeTools(over: Partial<Parameters<typeof buildAgentTools>[0]> = {}) {
  const db = new FakeDatabase()
  const events: unknown[] = []
  const tools = buildAgentTools({
    db,
    locationId: 'locA',
    contactId: 'c1',
    allowWrites: true,
    now: MON_8AM,
    dispatch: (e) => {
      events.push(e)
    },
    ...over,
  })
  return { db, events, tools }
}

// --- schema / write gate ----------------------------------------------------

test('approve-first mode exposes only the read tools', () => {
  const { tools } = makeTools({ allowWrites: false })
  expect(tools.schemas.map((s) => s.name).sort()).toEqual(['check_availability', 'get_contact_context'])
})

test('autonomous mode exposes the read tools plus the write tools', () => {
  const { tools } = makeTools({ allowWrites: true })
  expect(tools.schemas.map((s) => s.name).sort()).toEqual([
    'add_tag',
    'book_appointment',
    'check_availability',
    'get_contact_context',
  ])
})

test('no schema declares a payment, charge, or refund tool (money invariant)', () => {
  const { tools } = makeTools({ allowWrites: true })
  const names = tools.schemas.map((s) => s.name).join(' ')
  expect(names).not.toMatch(/pay|charge|refund|invoice|card|bank/i)
})

test('dispatch refuses a write tool in approve-first mode without touching the database', async () => {
  const { db, tools } = makeTools({ allowWrites: false })
  const r = await tools.dispatch({ id: 'w1', name: 'add_tag', input: { tag: 'hot' } })
  expect(r.isError).toBe(true)
  expect(r.toolUseId).toBe('w1')
  expect(r.content).toMatch(/not permitted|propose/i)
  expect(db.calls).toHaveLength(0) // never hit the DB
})

test('dispatch reports an unknown tool as an error', async () => {
  const { tools } = makeTools()
  const r = await tools.dispatch({ id: 'u1', name: 'launch_missiles', input: {} })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/unknown tool/i)
})

// --- check_availability -----------------------------------------------------

test('check_availability returns the open times for a given date, location-scoped', async () => {
  const { db, tools } = makeTools({ allowWrites: false })
  db.enqueue([cal]) // CalendarsRepo.list()
  db.enqueue([]) // listByCalendarRange -> no busy spans
  const r = await tools.dispatch({ id: 't1', name: 'check_availability', input: { date: '2026-06-08' } })

  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('2026-06-08')
  expect(r.content).toMatch(/9:00\s?AM/i)
  // the ISO start is surfaced so the model can pass it straight to book_appointment
  expect(r.content).toContain('2026-06-08T13:00:00.000Z')
  // calendars listed scoped to this location
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('check_availability with no date offers the soonest open day', async () => {
  const { db, tools } = makeTools({ allowWrites: false })
  db.enqueue([cal])
  db.enqueue([]) // busy for the soonest day
  const r = await tools.dispatch({ id: 't2', name: 'check_availability', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('2026-06-08') // today (Mon) is the soonest open day
})

test('check_availability reports plainly when no calendar is bookable', async () => {
  const { db, tools } = makeTools({ allowWrites: false })
  db.enqueue([{ ...cal, booking_enabled: false }])
  const r = await tools.dispatch({ id: 't3', name: 'check_availability', input: {} })
  expect(r.isError).toBeFalsy() // not a failure, just nothing to offer
  expect(r.content).toMatch(/no booking calendar|isn't|not.*available/i)
})

// --- get_contact_context ----------------------------------------------------

test('get_contact_context summarizes the conversation contact only', async () => {
  const { db, tools } = makeTools()
  db.enqueue([
    {
      id: 'c1',
      location_id: 'locA',
      name: 'Jane Doe',
      tags: ['lead', 'vip'],
      custom_fields: { city: 'Phoenix' },
    },
  ])
  const r = await tools.dispatch({ id: 't4', name: 'get_contact_context', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('Jane Doe')
  expect(r.content).toContain('lead')
  expect(r.content).toContain('Phoenix')
  // queried for THIS contact id, never one the model supplied
  expect(db.calls[0]?.params).toContain('c1')
})

// --- book_appointment -------------------------------------------------------

test('book_appointment books the conversation contact, writes the timeline, and dispatches', async () => {
  const { db, events, tools } = makeTools({ allowWrites: true })
  db.enqueue([cal]) // calendars list
  db.enqueue([]) // busy
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe' }]) // contact get (for the title)
  db.enqueue([{ id: 'appt1', location_id: 'locA' }]) // appointment INSERT RETURNING
  db.enqueue([{ id: 'tl1', location_id: 'locA' }]) // timeline INSERT RETURNING

  const r = await tools.dispatch({
    id: 't5',
    name: 'book_appointment',
    input: { start: '2026-06-08T13:00:00.000Z', notes: 'from chat' },
  })

  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/booked|confirmed/i)
  // the appointment row was created for the conversation's contact (c1)
  const createCall = db.calls.find((c) => /INSERT INTO appointments/i.test(c.sql))
  expect(createCall?.params).toContain('c1')
  // an appointment_booked timeline event was written
  const tlCall = db.calls.find((c) => /INSERT INTO timeline_events/i.test(c.sql))
  expect(tlCall?.params).toContain('appointment_booked')
  // and the automation loop was driven
  expect(events).toEqual([{ locationId: 'locA', triggerType: 'appointment_booked', contactId: 'c1' }])
})

test('book_appointment refuses a time that is not actually open', async () => {
  const { db, events, tools } = makeTools({ allowWrites: true })
  db.enqueue([cal])
  db.enqueue([]) // busy
  const r = await tools.dispatch({
    id: 't6',
    name: 'book_appointment',
    input: { start: '2026-06-08T05:00:00.000Z' }, // 1 AM EDT — outside the 9-5 window
  })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/no longer available|not available|another time/i)
  // nothing was inserted and no workflow fired
  expect(db.calls.some((c) => /INSERT/i.test(c.sql))).toBe(false)
  expect(events).toEqual([])
})

test('book_appointment turns a lost write race into an honest "just taken"', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([cal])
  db.enqueue([]) // busy
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe' }]) // contact get
  db.enqueueError({ code: '23505' }) // appointment INSERT loses the unique race
  const r = await tools.dispatch({
    id: 't7',
    name: 'book_appointment',
    input: { start: '2026-06-08T13:00:00.000Z' },
  })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/just (been )?taken|no longer/i)
})

// --- add_tag ----------------------------------------------------------------

test('add_tag tags the conversation contact', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([{ id: 'c1', location_id: 'locA', tags: ['hot-lead'] }]) // addTag RETURNING
  const r = await tools.dispatch({ id: 't8', name: 'add_tag', input: { tag: 'hot-lead' } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/hot-lead/)
  const upd = db.calls.find((c) => /UPDATE contacts/i.test(c.sql))
  expect(upd?.params).toContain('c1') // scoped to THIS contact
})

test('add_tag rejects an empty tag', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  const r = await tools.dispatch({ id: 't9', name: 'add_tag', input: { tag: '   ' } })
  expect(r.isError).toBe(true)
  expect(db.calls).toHaveLength(0)
})
