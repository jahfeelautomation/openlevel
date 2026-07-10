import {
  type AvailabilityWindow,
  type BookingConfig,
  addDays,
  bookableDates,
  dateLabel,
  formatZonedTime,
  slotsForDate,
  timeZoneOffsetMs,
  weekdayOf,
  zonedWallToUtc,
  zonedYmd,
} from './availability'

const NY = 'America/New_York'

// 2025-06-09 is a Monday; used as the canonical open day below.
test('weekdayOf is timezone-independent and 0=Sunday', () => {
  expect(weekdayOf(2025, 6, 9)).toBe(1) // Monday
  expect(weekdayOf(2025, 6, 8)).toBe(0) // Sunday
  expect(weekdayOf(2025, 6, 14)).toBe(6) // Saturday
})

test('timeZoneOffsetMs tracks DST for New York', () => {
  const hour = 60 * 60_000
  // Mid-January is EST (-5h); mid-July is EDT (-4h).
  expect(timeZoneOffsetMs(NY, new Date('2025-01-15T12:00:00Z'))).toBe(-5 * hour)
  expect(timeZoneOffsetMs(NY, new Date('2025-07-15T12:00:00Z'))).toBe(-4 * hour)
})

test('zonedWallToUtc converts wall-clock to the right instant on both sides of DST', () => {
  // 9:00 AM in NY is 14:00Z in winter (EST) and 13:00Z in summer (EDT).
  expect(zonedWallToUtc({ year: 2025, month: 1, day: 15, hour: 9, minute: 0 }, NY).toISOString()).toBe(
    '2025-01-15T14:00:00.000Z',
  )
  expect(zonedWallToUtc({ year: 2025, month: 7, day: 15, hour: 9, minute: 0 }, NY).toISOString()).toBe(
    '2025-07-15T13:00:00.000Z',
  )
  // The day after spring-forward (2025-03-09) is firmly EDT.
  expect(zonedWallToUtc({ year: 2025, month: 3, day: 10, hour: 9, minute: 0 }, NY).toISOString()).toBe(
    '2025-03-10T13:00:00.000Z',
  )
  // The day after fall-back (2025-11-02) is firmly EST.
  expect(zonedWallToUtc({ year: 2025, month: 11, day: 3, hour: 9, minute: 0 }, NY).toISOString()).toBe(
    '2025-11-03T14:00:00.000Z',
  )
})

test('zonedYmd returns the local calendar date even when UTC has rolled over', () => {
  // 2025-06-10T02:30Z is still 2025-06-09 22:30 in NY (EDT).
  expect(zonedYmd(new Date('2025-06-10T02:30:00Z'), NY)).toBe('2025-06-09')
  expect(zonedYmd(new Date('2025-06-09T16:00:00Z'), NY)).toBe('2025-06-09')
})

test('formatZonedTime renders a clock label in the calendar timezone', () => {
  // 13:00Z on a summer day is 9:00 AM EDT.
  expect(formatZonedTime(new Date('2025-06-09T13:00:00Z'), NY)).toBe('9:00 AM')
  expect(formatZonedTime(new Date('2025-06-09T15:30:00Z'), NY)).toBe('11:30 AM')
})

test('addDays and dateLabel are pure calendar arithmetic', () => {
  expect(addDays('2025-06-09', 1)).toBe('2025-06-10')
  expect(addDays('2025-06-30', 1)).toBe('2025-07-01')
  expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
  expect(dateLabel('2025-06-09')).toBe('Mon, Jun 9')
})

const MON_9_TO_12: AvailabilityWindow[] = [{ weekday: 1, start: '09:00', end: '12:00' }]

function config(over: Partial<BookingConfig> = {}): BookingConfig {
  return {
    timezone: NY,
    slotMinutes: 30,
    bufferMinutes: 0,
    noticeMinutes: 0,
    rollingDays: 14,
    windows: MON_9_TO_12,
    ...over,
  }
}

// A `now` well before the test dates so notice never interferes unless asked.
const LONG_AGO = new Date('2025-01-01T00:00:00Z')

test('slotsForDate produces back-to-back slots inside the window', () => {
  const slots = slotsForDate(config(), '2025-06-09', [], LONG_AGO)
  expect(slots.map((s) => s.label)).toEqual([
    '9:00 AM',
    '9:30 AM',
    '10:00 AM',
    '10:30 AM',
    '11:00 AM',
    '11:30 AM',
  ])
  // First slot is 9:00 EDT = 13:00Z, 30 minutes long.
  expect(slots[0]?.start).toBe('2025-06-09T13:00:00.000Z')
  expect(slots[0]?.end).toBe('2025-06-09T13:30:00.000Z')
})

test('slotsForDate returns nothing on a weekday with no window', () => {
  expect(slotsForDate(config(), '2025-06-08', [], LONG_AGO)).toEqual([]) // Sunday
})

test('a busy appointment removes exactly the overlapping slot when buffer is 0', () => {
  const busy = [{ start: new Date('2025-06-09T14:00:00Z'), end: new Date('2025-06-09T14:30:00Z') }] // 10:00 EDT
  const labels = slotsForDate(config(), '2025-06-09', busy, LONG_AGO).map((s) => s.label)
  expect(labels).toEqual(['9:00 AM', '9:30 AM', '10:30 AM', '11:00 AM', '11:30 AM'])
})

test('a buffer widens the block around a busy appointment', () => {
  const busy = [{ start: new Date('2025-06-09T14:00:00Z'), end: new Date('2025-06-09T14:30:00Z') }] // 10:00 EDT
  const labels = slotsForDate(config({ bufferMinutes: 30 }), '2025-06-09', busy, LONG_AGO).map((s) => s.label)
  // 30-min buffer blocks 9:30, 10:00, 10:30; 9:00, 11:00, 11:30 survive.
  expect(labels).toEqual(['9:00 AM', '11:00 AM', '11:30 AM'])
})

test('notice time drops slots that start too soon', () => {
  // now = 9:30 EDT; with 0 notice the 9:00 slot is already in the past.
  const now = new Date('2025-06-09T13:30:00Z')
  const labels = slotsForDate(config(), '2025-06-09', [], now).map((s) => s.label)
  expect(labels).toEqual(['9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM'])
})

test('intervalMinutes controls the step independently of slot length', () => {
  // 60-min appointments stepping every 30 min → overlapping start times.
  const labels = slotsForDate(
    config({ slotMinutes: 60, intervalMinutes: 30 }),
    '2025-06-09',
    [],
    LONG_AGO,
  ).map((s) => s.label)
  // Last start must leave a full 60 min before 12:00 → 11:00 is the last.
  expect(labels).toEqual(['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM'])
})

test('bookableDates lists only matching weekdays inside the rolling window', () => {
  const cfg = config({
    windows: [
      { weekday: 1, start: '09:00', end: '12:00' }, // Mon
      { weekday: 3, start: '09:00', end: '12:00' }, // Wed
    ],
    rollingDays: 7,
  })
  // now = Mon 2025-06-09 (08:00 EDT). Next 7 days: Mon 9, Wed 11.
  const dates = bookableDates(cfg, new Date('2025-06-09T12:00:00Z'))
  expect(dates).toEqual(['2025-06-09', '2025-06-11'])
})

test('bookableDates is empty when no windows are configured', () => {
  expect(bookableDates(config({ windows: [] }), LONG_AGO)).toEqual([])
})
