import type { Database } from '../db/database'
import { AppointmentsRepo } from '../repos/appointments-repo'
import type { Calendar } from '../repos/calendars-repo'
import {
  type AvailabilityWindow,
  type BookingConfig,
  type BusyRange,
  parseYmd,
  zonedWallToUtc,
} from './availability'

const ONE_DAY_MS = 24 * 60 * 60_000

/**
 * Shared booking-availability glue: the small, impure bridge between a stored
 * calendar row and the pure slot math in `lib/availability`. Extracted out of the
 * public booking route so the conversation agent's `check_availability` /
 * `book_appointment` tools compute openings the EXACT same way the hosted booking
 * page does — one source of truth for "is this time free", never two drifting
 * copies.
 */

/** Read a calendar's availability windows defensively — jsonb usually arrives as
 *  an array, but a string-encoded column is tolerated. */
export function readWindows(raw: unknown): AvailabilityWindow[] {
  if (Array.isArray(raw)) return raw as AvailabilityWindow[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as AvailabilityWindow[]) : []
    } catch {
      return []
    }
  }
  return []
}

/** Project a calendar row onto the pure slot-math config. */
export function toConfig(cal: Calendar): BookingConfig {
  return {
    timezone: cal.timezone,
    slotMinutes: cal.duration_min,
    intervalMinutes: cal.slot_interval_min,
    bufferMinutes: cal.buffer_min,
    noticeMinutes: cal.notice_min,
    rollingDays: cal.rolling_days,
    windows: readWindows(cal.availability),
  }
}

/**
 * The calendar's busy spans around a local date — its own non-cancelled
 * appointments, widened by a day each side so events crossing local midnight are
 * still counted. Location-scoped through `AppointmentsRepo`, so it can never see
 * another tenant's calendar.
 */
export async function calendarBusyFor(
  db: Database,
  locationId: string,
  cal: Calendar,
  ymd: string,
): Promise<BusyRange[]> {
  const { year, month, day } = parseYmd(ymd)
  const midnight = zonedWallToUtc({ year, month, day, hour: 0, minute: 0 }, cal.timezone)
  const fromISO = new Date(midnight.getTime() - ONE_DAY_MS).toISOString()
  const toISO = new Date(midnight.getTime() + 2 * ONE_DAY_MS).toISOString()
  const appts = await new AppointmentsRepo(db, locationId).listByCalendarRange(cal.id, fromISO, toISO)
  return appts.map((a) => ({ start: new Date(a.starts_at), end: new Date(a.ends_at) }))
}
