import { FakeDatabase } from '../db/fake-database'
import type { Calendar } from '../repos/calendars-repo'
import { calendarBusyFor, readWindows, toConfig } from './booking-availability'

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
  availability: [{ weekday: 1, start: '09:00', end: '17:00' }],
  booking_headline: null,
  booking_blurb: null,
  created_at: '2026-06-01T00:00:00.000Z',
}

test('readWindows tolerates arrays, JSON strings, and garbage', () => {
  expect(readWindows([{ weekday: 1, start: '09:00', end: '17:00' }])).toHaveLength(1)
  expect(readWindows('[{"weekday":2,"start":"10:00","end":"12:00"}]')).toEqual([
    { weekday: 2, start: '10:00', end: '12:00' },
  ])
  expect(readWindows('not json')).toEqual([])
  expect(readWindows(null)).toEqual([])
  expect(readWindows(42)).toEqual([])
})

test('toConfig projects a calendar row onto the pure slot-math config', () => {
  expect(toConfig(cal)).toEqual({
    timezone: 'America/New_York',
    slotMinutes: 30,
    intervalMinutes: 30,
    bufferMinutes: 0,
    noticeMinutes: 0,
    rollingDays: 14,
    windows: [{ weekday: 1, start: '09:00', end: '17:00' }],
  })
})

test('calendarBusyFor queries the calendar busy set location-scoped and maps to instants', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { starts_at: '2026-06-08T13:00:00.000Z', ends_at: '2026-06-08T13:30:00.000Z' },
  ]) // listByCalendarRange
  const busy = await calendarBusyFor(db, 'locA', cal, '2026-06-08')

  expect(busy).toEqual([
    { start: new Date('2026-06-08T13:00:00.000Z'), end: new Date('2026-06-08T13:30:00.000Z') },
  ])
  // location-scoped read: locationId is $1, the calendar id $2
  expect(db.calls[0]?.params[0]).toBe('locA')
  expect(db.calls[0]?.params).toContain('cal1')
  // excludes cancelled, as the public page requires
  expect(db.calls[0]?.sql).toMatch(/status <> 'cancelled'/i)
})
