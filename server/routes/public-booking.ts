import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { bookableDates, parseYmd, slotsForDate, zonedYmd } from '../lib/availability'
import { calendarBusyFor, toConfig } from '../lib/booking-availability'
import { renderBookingNotFound, renderBookingPage } from '../lib/booking-page'
import { isUniqueViolation } from '../lib/db-errors'
import { AppointmentsRepo } from '../repos/appointments-repo'
import { type Calendar, CalendarsRepo } from '../repos/calendars-repo'
import { ContactsRepo } from '../repos/contacts-repo'
import { LocationsRepo } from '../repos/locations-repo'
import { TimelineRepo } from '../repos/timeline-repo'

const bookSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
})

/**
 * Public, UNAUTHENTICATED booking pages — mounted at `/api/public/booking`
 * BEFORE the operatorAuth boundary, so the location comes from the URL (`:loc`).
 * A calendar is reachable here only while it is `booking_enabled`:
 *
 *   GET  /:loc/:slug              → the hosted booking page (visitor render)
 *   GET  /:loc/:slug/slots?date=  → open times for one local date (JSON)
 *   POST /:loc/:slug/book         → reserve a slot (creates contact + appointment)
 *
 * The slot math lives in lib/availability and is recomputed on every request, so
 * the page can never offer — or accept — a time that the calendar's own
 * appointments, notice window, or buffer have since closed. Booking dispatches
 * `appointment_booked`, closing the capture → automation loop.
 */
export function publicBookingRoute(deps: {
  db: Database
  /** Fired after a booking so live `appointment_booked` workflows enroll the lead. */
  dispatch?: WorkflowDispatch
  /** Injectable clock — defaults to wall-clock; tests pin it for determinism. */
  now?: () => Date
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const clock = () => deps.now?.() ?? new Date()

  /** Load a booking-enabled calendar by slug, or undefined. */
  async function enabledCalendar(loc: string, slug: string): Promise<Calendar | undefined> {
    const cal = await new CalendarsRepo(deps.db, loc).getByBookingSlug(slug)
    return cal && cal.booking_enabled ? cal : undefined
  }

  /** The location's branding color, or undefined. */
  async function brandColor(loc: string): Promise<string | undefined> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return typeof color === 'string' ? color : undefined
  }

  // The hosted booking page. Unknown or not-enabled → a styled 404.
  app.get('/:loc/:slug', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const cal = await enabledCalendar(loc, slug)
    if (!cal) return c.html(renderBookingNotFound(), 404)
    const dates = bookableDates(toConfig(cal), clock())
    return c.html(
      renderBookingPage(cal, {
        actionBase: `/api/public/booking/${loc}/${slug}`,
        dates,
        brandColor: await brandColor(loc),
      }),
    )
  })

  // Open times for one local date — the source of truth (busy + notice + buffer).
  app.get('/:loc/:slug/slots', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const date = c.req.query('date') ?? ''
    const cal = await enabledCalendar(loc, slug)
    if (!cal) return c.json({ error: 'not found' }, 404)
    try {
      parseYmd(date)
    } catch {
      return c.json({ slots: [] })
    }
    const config = toConfig(cal)
    const busy = await calendarBusyFor(deps.db, loc, cal, date)
    return c.json({ slots: slotsForDate(config, date, busy, clock()) })
  })

  // Reserve a slot. Recomputes the offered slots RIGHT NOW and rejects a start
  // that is no longer free (someone booked it, or notice has passed) — the
  // double-book guard. Then upserts the contact and creates the appointment.
  app.post('/:loc/:slug/book', zValidator('json', bookSchema), async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const input = c.req.valid('json')
    const cal = await enabledCalendar(loc, slug)
    if (!cal) return c.json({ error: 'not found' }, 404)

    const config = toConfig(cal)
    const ymd = zonedYmd(new Date(input.start), config.timezone)
    const busy = await calendarBusyFor(deps.db, loc, cal, ymd)
    const match = slotsForDate(config, ymd, busy, clock()).find((s) => s.start === input.start)
    if (!match) return c.json({ error: 'slot taken' }, 409)

    const phone = input.phone?.trim() || undefined
    const contact = await new ContactsRepo(deps.db, loc).upsertByMatch(
      { name: input.name, email: input.email, phone },
      `booking:${slug}`,
    )
    const apptRepo = new AppointmentsRepo(deps.db, loc)
    let appointment: Awaited<ReturnType<typeof apptRepo.create>>
    try {
      appointment = await apptRepo.create({
        calendarId: cal.id,
        title: `${cal.name} — ${input.name}`,
        startsAt: match.start,
        endsAt: match.end,
        contactId: contact.id,
        notes: input.notes?.trim() || null,
      })
    } catch (err) {
      // We lost the write race: between our slot snapshot above and this INSERT,
      // another visitor claimed the same calendar+instant. The partial unique
      // index turns that into a 23505, which is an honest "slot taken" — never a
      // 500, and never a silent double-book. Any other error is a real fault.
      if (isUniqueViolation(err)) return c.json({ error: 'slot taken' }, 409)
      throw err
    }
    await new TimelineRepo(deps.db, loc).add({
      contactId: contact.id,
      type: 'appointment_booked',
      refTable: 'appointments',
      refId: appointment.id,
      payload: { calendar: cal.name, start: match.start },
    })

    // Drive the capture → automation loop: a live appointment_booked workflow runs.
    await deps.dispatch?.({ locationId: loc, triggerType: 'appointment_booked', contactId: contact.id })

    return c.json({ ok: true, appointmentId: appointment.id, contactId: contact.id })
  })

  return app
}
