import type { Calendar } from '../repos/calendars-repo'
import { renderBookingNotFound, renderBookingPage } from './booking-page'

function calendar(over: Partial<Calendar> = {}): Calendar {
  return {
    id: 'cal1',
    location_id: 'loc1',
    name: 'Seller Consultations',
    color: 'emerald',
    duration_min: 30,
    position: 0,
    booking_enabled: true,
    booking_slug: 'cash-offer',
    timezone: 'America/New_York',
    slot_interval_min: 0,
    buffer_min: 0,
    notice_min: 120,
    rolling_days: 14,
    availability: [{ weekday: 1, start: '09:00', end: '12:00' }],
    booking_headline: 'Book your cash-offer call',
    booking_blurb: 'Pick a time that works — it takes 30 minutes.',
    created_at: '2025-06-01T00:00:00Z',
    ...over,
  }
}

const DATA = {
  actionBase: '/api/public/booking/loc1/cash-offer',
  dates: ['2025-06-09', '2025-06-16'],
}

test('renderBookingPage is a self-contained, noindex html document', () => {
  const html = renderBookingPage(calendar(), DATA)
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('name="robots" content="noindex"')
})

test('renderBookingPage shows the headline, blurb, calendar name, and timezone', () => {
  const html = renderBookingPage(calendar(), DATA)
  expect(html).toContain('Book your cash-offer call')
  expect(html).toContain('Pick a time that works')
  expect(html).toContain('Seller Consultations')
  // friendly tz label, not the raw IANA zone
  expect(html).toContain('New York time')
})

test('renderBookingPage renders a date pill per bookable date and wires the action base', () => {
  const html = renderBookingPage(calendar(), DATA)
  expect(html).toContain('data-date="2025-06-09"')
  expect(html).toContain('data-date="2025-06-16"')
  expect(html).toContain('Mon, Jun 9')
  expect(html).toContain('Mon, Jun 16')
  // the script targets this calendar's public endpoints
  expect(html).toContain('/api/public/booking/loc1/cash-offer')
})

test('renderBookingPage defaults the headline and omits the blurb when unset', () => {
  const html = renderBookingPage(calendar({ booking_headline: null, booking_blurb: null }), DATA)
  expect(html).toContain('Book a time')
  expect(html).not.toContain('ol-sub">') // no blurb paragraph rendered in the pick view
})

test('renderBookingPage auto-advances past an empty leading date to the first open one', () => {
  const html = renderBookingPage(calendar(), DATA)
  // The initial selection kicks off an auto-advancing load (the date index is
  // passed), so a visitor landing late in the day is never stranded on an empty
  // "today" when a later date has openings.
  expect(html).toContain('loadSlots(activeDate,0)')
  // The auto-advance applies ONLY to that initial load; a manual date click
  // (no index) still shows the honest per-day "No open times" message.
  expect(html).toContain("typeof autoIdx==='number'")
})

test('renderBookingPage shows an honest empty state when no dates are open', () => {
  const html = renderBookingPage(calendar(), { ...DATA, dates: [] })
  expect(html).toContain('No times are open right now')
  expect(html).not.toContain('class="ob-date"')
})

test('renderBookingPage escapes operator-controlled copy', () => {
  const html = renderBookingPage(
    calendar({ booking_headline: '<script>alert(1)</script>', name: 'A & B' }),
    DATA,
  )
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('A &amp; B')
})

test('renderBookingNotFound is a styled html page', () => {
  const html = renderBookingNotFound()
  expect(html).toContain('<!doctype html>')
  expect(html.toLowerCase()).toContain('unavailable')
})
