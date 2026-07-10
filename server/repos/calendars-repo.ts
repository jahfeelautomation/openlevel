import { nanoid } from 'nanoid'
import type { AvailabilityWindow } from '../lib/availability'
import { LocationScopedRepo } from './base-repo'

export interface Calendar {
  id: string
  location_id: string
  name: string
  color: string
  duration_min: number
  position: number
  booking_enabled: boolean
  booking_slug: string | null
  timezone: string
  slot_interval_min: number
  buffer_min: number
  notice_min: number
  rolling_days: number
  availability: AvailabilityWindow[]
  booking_headline: string | null
  booking_blurb: string | null
  created_at: string
}

export interface CalendarInput {
  name: string
  color?: string
  durationMin?: number
  position?: number
}

/** Patch any subset of a calendar's columns (camelCase → snake_case). A
 *  `bookingSlug` of null clears the slug; `availability` is json-encoded. */
export interface CalendarPatch {
  name?: string
  color?: string
  durationMin?: number
  position?: number
  bookingEnabled?: boolean
  bookingSlug?: string | null
  timezone?: string
  slotIntervalMin?: number
  bufferMin?: number
  noticeMin?: number
  rollingDays?: number
  availability?: AvailabilityWindow[]
  bookingHeadline?: string | null
  bookingBlurb?: string | null
}

export class CalendarsRepo extends LocationScopedRepo {
  list(): Promise<Calendar[]> {
    return this.scopedSelect<Calendar>('SELECT * FROM calendars ORDER BY position, created_at')
  }

  async get(id: string): Promise<Calendar | undefined> {
    const rows = await this.scopedSelect<Calendar>('SELECT * FROM calendars WHERE id=$2', [id])
    return rows[0]
  }

  async create(input: CalendarInput): Promise<Calendar> {
    const id = nanoid()
    const rows = await this.scopedWrite<Calendar>(
      `INSERT INTO calendars (id, location_id, name, color, duration_min, position)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.name, input.color ?? 'indigo', input.durationMin ?? 30, input.position ?? 0],
    )
    return rows[0]!
  }

  /** Look up a calendar by its public booking slug, location-scoped so the
   *  unauthenticated booking page can never cross tenants. */
  async getByBookingSlug(slug: string): Promise<Calendar | undefined> {
    const rows = await this.scopedSelect<Calendar>('SELECT * FROM calendars WHERE booking_slug=$2', [
      slug,
    ])
    return rows[0]
  }

  /**
   * Patch only the provided columns. Dynamic SET numbered from $2 ($1 is the
   * location), id pinned last; `availability` is json-encoded. Returns undefined
   * when nothing was provided (no query issued).
   */
  async update(id: string, patch: CalendarPatch): Promise<Calendar | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.color !== undefined) push('color', patch.color)
    if (patch.durationMin !== undefined) push('duration_min', patch.durationMin)
    if (patch.position !== undefined) push('position', patch.position)
    if (patch.bookingEnabled !== undefined) push('booking_enabled', patch.bookingEnabled)
    if (patch.bookingSlug !== undefined) push('booking_slug', patch.bookingSlug)
    if (patch.timezone !== undefined) push('timezone', patch.timezone)
    if (patch.slotIntervalMin !== undefined) push('slot_interval_min', patch.slotIntervalMin)
    if (patch.bufferMin !== undefined) push('buffer_min', patch.bufferMin)
    if (patch.noticeMin !== undefined) push('notice_min', patch.noticeMin)
    if (patch.rollingDays !== undefined) push('rolling_days', patch.rollingDays)
    if (patch.availability !== undefined) push('availability', JSON.stringify(patch.availability))
    if (patch.bookingHeadline !== undefined) push('booking_headline', patch.bookingHeadline)
    if (patch.bookingBlurb !== undefined) push('booking_blurb', patch.bookingBlurb)
    if (sets.length === 0) return undefined

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Calendar>(
      `UPDATE calendars SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }
}
