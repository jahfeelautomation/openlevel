# OpenLevel Slice 3 — Calendars & Appointments (design)

**Date:** 2026-06-03
**Status:** building (autonomous; AL directive "work non-stop, whatever you recommend")

## Goal

A GoHighLevel-style Calendars module: named calendars (per service / team
member) and appointments booked against them, scoped per sub-account. This is
the booking backbone clients' AI-employees use to schedule inspections /
consultations.

## Scope (this slice)

In: calendars list, appointments CRUD-lite (create, reschedule, change status),
an agenda UI grouped by day with a calendar filter, seeded demo data.

Out (later slices): public booking links + availability rules, recurring
appointments, reminders/automation triggers, a month/week time-grid view,
team-member round-robin. Noted here so the omission is explicit, not silent.

## Data model

Mirrors the slice-2 conventions: text PK, `location_id` first FK with
`ON DELETE CASCADE`, composite indexes lead with `location_id`.

```
calendars
  id text PK, location_id FK->locations cascade,
  name text, color text default 'indigo', duration_min int default 30,
  position int, created_at

appointments
  id text PK, location_id FK->locations cascade,
  calendar_id FK->calendars cascade,
  contact_id  FK->contacts set null (nullable),
  title text,
  starts_at timestamptz, ends_at timestamptz,
  status text default 'scheduled',     -- scheduled|confirmed|completed|cancelled|no_show
  location_text text null, notes text null,
  created_at, updated_at
index appointments_by_time (location_id, starts_at)
```

`color` is a token (`indigo|emerald|amber|rose|sky|violet`) mapped to Tailwind
classes in the UI — keeps theming out of the DB.

## Repos (extend LocationScopedRepo, TDD)

- `CalendarsRepo`: `list()` (ordered by position), `get(id)`, `create(input)`.
- `AppointmentsRepo`:
  - `listByRange(fromISO, toISO)` — `WHERE starts_at >= $2 AND starts_at < $3 ORDER BY starts_at`
  - `get(id)`
  - `create(input)` — sets `location_id` explicitly ($1), nanoid id
  - `reschedule(id, startsAt, endsAt)` — UPDATE scoped to location+id
  - `setStatus(id, status)` — UPDATE scoped to location+id

Tests assert the tenancy invariant: every call's `params[0] === locationId`.

## Routes (`calendarsRoute`, mounted `/api/loc/:loc/calendars`)

- `GET /` → `{ calendars }`
- `GET /appointments?from&to` → `{ appointments }` (defaults: from=now, to=+30d)
- `POST /appointments` (zod) → 201 `{ ok, appointment }`
- `PATCH /appointments/:id` (zod) — precedence: `startsAt` → reschedule,
  else `status` → setStatus; 404 if not found

## UI (`CalendarsPage`)

Agenda layout that hits the GHL polish bar without a full time-grid:

- Left rail: each calendar as a row — color dot, name, count of upcoming.
  "All calendars" selected by default; clicking filters.
- Header: "Calendars", upcoming count; "New appointment" brand button.
- Main: appointments grouped by day (Today / Tomorrow / weekday, date),
  each row shows time range, title, contact name (muted), a colored calendar
  tag, and a status badge. Empty state when none.
- `NewAppointmentDialog`: title, calendar select, contact select (optional),
  date + start time, duration (prefills from calendar.duration_min). Computes
  `ends_at` from start + duration.

Status badges: scheduled=slate, confirmed=brand, completed=green,
cancelled/no_show=amber/slate muted.

## Verification

`npm run typecheck` (src+server+db) + `npm test` green; `npm run shoot` adds a
`calendars` board shot; visual GHL-grade confirm; commit with screenshot ref;
send AL.

