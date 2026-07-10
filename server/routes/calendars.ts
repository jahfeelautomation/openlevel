import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import { isUniqueViolation } from '../lib/db-errors'
import { AppointmentsRepo } from '../repos/appointments-repo'
import { CalendarsRepo } from '../repos/calendars-repo'
import type { Database } from '../db/database'

const APPOINTMENT_STATUS = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const

// starts_at/ends_at are timestamptz NOT NULL columns. Validating them as real
// ISO datetimes (not just any non-empty string) keeps a typo like "soon" from
// reaching the DB as a 500, and the refine rejects a backwards appointment
// (end at or before start) that the plain unique double-book index wouldn't catch.
const createApptSchema = z
  .object({
    calendarId: z.string().min(1),
    title: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    contactId: z.string().nullable().optional(),
    locationText: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })

const patchApptSchema = z
  .object({
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    status: z.enum(APPOINTMENT_STATUS).optional(),
  })
  // Only enforce ordering when a reschedule supplies both ends; a status-only
  // patch leaves both undefined and passes untouched.
  .refine(
    (v) => v.startsAt === undefined || v.endsAt === undefined || new Date(v.endsAt) > new Date(v.startsAt),
    { message: 'endsAt must be after startsAt', path: ['endsAt'] },
  )

const createCalSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1).optional(),
  durationMin: z.number().int().positive().optional(),
  position: z.number().int().optional(),
})

// A weekly open window in the calendar's timezone (weekday 0=Sun, 'HH:MM' wall
// clock). Matches AvailabilityWindow in lib/availability.
const availabilityWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{1,2}:\d{2}$/),
  end: z.string().regex(/^\d{1,2}:\d{2}$/),
})

// Booking slugs live in a public URL, so keep them lowercase + URL-safe; the UI
// slugifies before sending. A null clears the slug (and so the public page).
const bookingSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase letters, numbers, or dashes')

const patchCalSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  durationMin: z.number().int().positive().optional(),
  position: z.number().int().optional(),
  bookingEnabled: z.boolean().optional(),
  bookingSlug: bookingSlugSchema.nullable().optional(),
  timezone: z.string().min(1).optional(),
  slotIntervalMin: z.number().int().min(0).optional(),
  bufferMin: z.number().int().min(0).optional(),
  noticeMin: z.number().int().min(0).optional(),
  rollingDays: z.number().int().min(1).max(60).optional(),
  availability: z.array(availabilityWindowSchema).optional(),
  bookingHeadline: z.string().nullable().optional(),
  bookingBlurb: z.string().nullable().optional(),
})

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Calendars + appointments for the current location. Mounted behind
 * operatorAuth + locationAccess. The agenda UI reads GET / (calendars) and
 * GET /appointments?from&to (defaults: now .. +30d); POST /appointments books;
 * PATCH /appointments/:id reschedules ({startsAt,endsAt}) or sets {status}.
 */
export function calendarsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const calendars = await new CalendarsRepo(deps.db, loc).list()
    return c.json({ calendars })
  })

  app.post('/', zValidator('json', createCalSchema), async (c) => {
    const loc = c.get('locationId')
    const calendar = await new CalendarsRepo(deps.db, loc).create(c.req.valid('json'))
    return c.json({ ok: true, calendar }, 201)
  })

  // Patch a calendar — its name/color/duration AND its public-booking config
  // (enable, slug, timezone, weekly availability, interval/buffer/notice/window,
  // headline/blurb). A booking slug must be unique within the location.
  app.patch('/:id', zValidator('json', patchCalSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const patch = c.req.valid('json')
    if (Object.keys(patch).length === 0) return c.json({ error: 'empty patch' }, 400)

    const repo = new CalendarsRepo(deps.db, loc)
    // Slug-uniqueness guard: a non-null slug must be free, or already this one's.
    if (typeof patch.bookingSlug === 'string') {
      const owner = await repo.getByBookingSlug(patch.bookingSlug)
      if (owner && owner.id !== id) return c.json({ error: 'slug taken' }, 409)
    }
    const calendar = await repo.update(id, patch)
    if (!calendar) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, calendar })
  })

  app.get('/appointments', async (c) => {
    const loc = c.get('locationId')
    const now = new Date()
    const from = c.req.query('from') ?? now.toISOString()
    const to = c.req.query('to') ?? new Date(now.getTime() + THIRTY_DAYS_MS).toISOString()
    const appointments = await new AppointmentsRepo(deps.db, loc).listByRange(from, to)
    return c.json({ appointments })
  })

  app.post('/appointments', zValidator('json', createApptSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    // An appointment may only be booked on a calendar this location owns. The
    // lookup is scoped, so a foreign or missing calendarId is a 400 rather than
    // an appointment attached to another tenant's calendar.
    const calendar = await new CalendarsRepo(deps.db, loc).get(input.calendarId)
    if (!calendar) return c.json({ error: 'unknown calendar' }, 400)
    try {
      const appointment = await new AppointmentsRepo(deps.db, loc).create(input)
      return c.json({ ok: true, appointment }, 201)
    } catch (err) {
      // The no-double-book index refused this calendar+instant. An honest 409,
      // not a 500 — the operator must pick another time.
      if (isUniqueViolation(err)) return c.json({ error: 'time already booked' }, 409)
      throw err
    }
  })

  app.patch('/appointments/:id', zValidator('json', patchApptSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const repo = new AppointmentsRepo(deps.db, loc)

    // One concern per call: reschedule (needs both timestamps) > status change.
    let appointment
    if (body.startsAt !== undefined && body.endsAt !== undefined) {
      try {
        appointment = await repo.reschedule(id, body.startsAt, body.endsAt)
      } catch (err) {
        // Moving onto a slot another live appointment already holds → 409.
        if (isUniqueViolation(err)) return c.json({ error: 'time already booked' }, 409)
        throw err
      }
    } else if (body.status !== undefined) {
      appointment = await repo.setStatus(id, body.status)
    } else {
      return c.json({ error: 'startsAt+endsAt or status required' }, 400)
    }
    if (!appointment) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, appointment })
  })

  return app
}
