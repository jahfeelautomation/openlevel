/**
 * Booking availability math — pure, side-effect-free, and timezone-correct.
 *
 * A booking calendar stores its open hours as weekly *wall-clock* windows in a
 * named IANA timezone, while appointments are stored as UTC instants. To turn
 * "Mondays 9–5 in America/New_York" into a concrete list of bookable instants
 * for a given date — and to keep that correct across daylight-saving changes —
 * we convert wall-clock ↔ UTC using `Intl.DateTimeFormat`, which already knows
 * every zone's DST rules. No external date library, no stored offsets that rot.
 *
 * Everything here takes `now`/`busy` as explicit arguments so it is trivially
 * testable and deterministic; the route passes `new Date()` and the calendar's
 * real appointments.
 */

/** A weekly recurring open window in the calendar's timezone. `weekday` follows
 *  JS `Date.getDay()` (0 = Sunday … 6 = Saturday). `start`/`end` are 'HH:MM'
 *  24-hour wall-clock strings; `end` is exclusive. */
export interface AvailabilityWindow {
  weekday: number
  start: string
  end: string
}

/** Everything the slot math needs about a calendar's booking rules. */
export interface BookingConfig {
  timezone: string
  /** Appointment length in minutes (also the default step between slot starts). */
  slotMinutes: number
  /** Step between slot starts; <= 0 means "step by slotMinutes". */
  intervalMinutes?: number
  /** Clear gap kept before and after every existing appointment. */
  bufferMinutes: number
  /** Earliest a slot may start, measured forward from `now`. */
  noticeMinutes: number
  /** How many days ahead (including today) the page offers, 1..60. */
  rollingDays: number
  windows: AvailabilityWindow[]
}

/** An already-booked span, as UTC instants. */
export interface BusyRange {
  start: Date
  end: Date
}

/** One bookable opening: ISO instants plus a human label in the calendar's tz. */
export interface Slot {
  start: string
  end: string
  label: string
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

// --- parsing primitives ---------------------------------------------------

interface Ymd {
  year: number
  month: number
  day: number
}

/** Parse a strict 'YYYY-MM-DD' string. Throws on a malformed date. */
export function parseYmd(ymd: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) throw new Error(`invalid date (want YYYY-MM-DD): ${ymd}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/** 'HH:MM' → minutes from midnight, or NaN if malformed. */
function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm)
  if (!m) return Number.NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return Number.NaN
  return h * 60 + min
}

/** Day of week (0=Sun) for a wall-clock date. Computed in UTC so it never
 *  depends on the host machine's local zone. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

// --- timezone conversion --------------------------------------------------

/**
 * The offset (ms) of `timeZone` at a given instant: how far that zone's wall
 * clock is ahead of UTC (positive east of UTC, negative west). DST-aware.
 *
 * Works by formatting the instant in `timeZone`, reading the wall-clock parts
 * back, and re-interpreting them as if they were UTC — the difference from the
 * original instant is exactly the zone's offset at that moment.
 */
export function timeZoneOffsetMs(timeZone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, number> = {}
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  let hour = map.hour ?? 0
  if (hour === 24) hour = 0 // guard against the midnight "24" quirk
  const asUTC = Date.UTC(map.year ?? 1970, (map.month ?? 1) - 1, map.day ?? 1, hour, map.minute ?? 0, map.second ?? 0)
  return asUTC - instant.getTime()
}

/**
 * The UTC instant for a wall-clock time in `timeZone`. Two passes so it stays
 * correct across DST boundaries: the first offset is an estimate, and if the
 * resulting instant lands in a different offset (a spring-forward / fall-back
 * day) the second pass corrects it.
 */
export function zonedWallToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const off1 = timeZoneOffsetMs(timeZone, new Date(asUTC))
  let utc = asUTC - off1
  const off2 = timeZoneOffsetMs(timeZone, new Date(utc))
  if (off2 !== off1) utc = asUTC - off2
  return new Date(utc)
}

/** The 'YYYY-MM-DD' calendar date an instant falls on, in `timeZone`. */
export function zonedYmd(instant: Date, timeZone: string): string {
  // en-CA renders ISO-style YYYY-MM-DD, stable across Node's ICU.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** A 'h:mm AM/PM' clock label for an instant, in `timeZone`. */
export function formatZonedTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant)
}

// --- date helpers ---------------------------------------------------------

/** Add `n` calendar days to a 'YYYY-MM-DD' string (pure, UTC arithmetic). */
export function addDays(ymd: string, n: number): string {
  const { year, month, day } = parseYmd(ymd)
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10)
}

/** A 'Mon, Jun 9' label for a 'YYYY-MM-DD' date — no timezone round trip. */
export function dateLabel(ymd: string): string {
  const { year, month, day } = parseYmd(ymd)
  const wd = WEEKDAY_ABBR[weekdayOf(year, month, day)] ?? ''
  const mo = MONTH_ABBR[month - 1] ?? ''
  return `${wd}, ${mo} ${day}`
}

// --- the slot math --------------------------------------------------------

/** Step between slot starts: the explicit interval, or the slot length. */
function stepMinutes(config: BookingConfig): number {
  return config.intervalMinutes && config.intervalMinutes > 0
    ? config.intervalMinutes
    : config.slotMinutes
}

function dedupeByStart(slots: Slot[]): Slot[] {
  const seen = new Set<string>()
  const out: Slot[] = []
  for (const s of slots) {
    if (seen.has(s.start)) continue
    seen.add(s.start)
    out.push(s)
  }
  return out
}

/**
 * Every bookable slot for one local date, in chronological order.
 *
 * For each availability window whose weekday matches the date, walk wall-clock
 * starts from the window open up to (close − slotMinutes), convert each to a UTC
 * instant, then drop it when it is sooner than `now + noticeMinutes` or it
 * collides with a `busy` span (widened by `bufferMinutes` on each side).
 */
export function slotsForDate(
  config: BookingConfig,
  ymd: string,
  busy: BusyRange[],
  now: Date,
): Slot[] {
  const step = stepMinutes(config)
  if (step <= 0 || config.slotMinutes <= 0) return []

  const { year, month, day } = parseYmd(ymd)
  const weekday = weekdayOf(year, month, day)
  const windows = config.windows.filter((w) => w.weekday === weekday)
  if (windows.length === 0) return []

  const earliest = now.getTime() + config.noticeMinutes * 60_000
  const bufferMs = Math.max(0, config.bufferMinutes) * 60_000
  const slots: Slot[] = []

  for (const w of windows) {
    const open = parseHm(w.start)
    const close = parseHm(w.end)
    if (Number.isNaN(open) || Number.isNaN(close)) continue

    for (let mins = open; mins + config.slotMinutes <= close; mins += step) {
      const start = zonedWallToUtc(
        { year, month, day, hour: Math.floor(mins / 60), minute: mins % 60 },
        config.timezone,
      )
      const end = new Date(start.getTime() + config.slotMinutes * 60_000)
      if (start.getTime() < earliest) continue

      const blocked = busy.some(
        (b) =>
          start.getTime() < b.end.getTime() + bufferMs &&
          end.getTime() > b.start.getTime() - bufferMs,
      )
      if (blocked) continue

      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        label: formatZonedTime(start, config.timezone),
      })
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start))
  return dedupeByStart(slots)
}

/**
 * The dates (YYYY-MM-DD) within the rolling window — starting with today in the
 * calendar's timezone — whose weekday has at least one availability window. This
 * is the cheap "which days can I click" list for the date picker; the actual
 * open times for a chosen day come from `slotsForDate`, which is the only place
 * `busy` and `notice` are applied.
 */
export function bookableDates(config: BookingConfig, now: Date): string[] {
  const span = Math.max(1, Math.min(config.rollingDays || 1, 60))
  const openWeekdays = new Set(config.windows.map((w) => w.weekday))
  if (openWeekdays.size === 0) return []

  const today = zonedYmd(now, config.timezone)
  const out: string[] = []
  for (let i = 0; i < span; i++) {
    const ymd = addDays(today, i)
    const { year, month, day } = parseYmd(ymd)
    if (openWeekdays.has(weekdayOf(year, month, day))) out.push(ymd)
  }
  return out
}
