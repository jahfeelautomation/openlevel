import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Appointment {
  id: string
  location_id: string
  calendar_id: string
  contact_id: string | null
  title: string
  starts_at: string
  ends_at: string
  status: string
  location_text: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface AppointmentInput {
  calendarId: string
  title: string
  startsAt: string
  endsAt: string
  contactId?: string | null
  locationText?: string | null
  notes?: string | null
}

export class AppointmentsRepo extends LocationScopedRepo {
  /** Appointments whose start falls in [from, to). Ordered chronologically. */
  listByRange(fromISO: string, toISO: string): Promise<Appointment[]> {
    return this.scopedSelect<Appointment>(
      'SELECT * FROM appointments WHERE starts_at >= $2 AND starts_at < $3 ORDER BY starts_at',
      [fromISO, toISO],
    )
  }

  /** The busy set for ONE calendar in [from, to), excluding cancelled
   *  appointments — what a public booking page must keep its slots clear of. */
  listByCalendarRange(calendarId: string, fromISO: string, toISO: string): Promise<Appointment[]> {
    return this.scopedSelect<Appointment>(
      `SELECT * FROM appointments
        WHERE calendar_id=$2 AND starts_at >= $3 AND starts_at < $4 AND status <> 'cancelled'
        ORDER BY starts_at`,
      [calendarId, fromISO, toISO],
    )
  }

  async get(id: string): Promise<Appointment | undefined> {
    const rows = await this.scopedSelect<Appointment>('SELECT * FROM appointments WHERE id=$2', [id])
    return rows[0]
  }

  async create(input: AppointmentInput): Promise<Appointment> {
    const id = nanoid()
    const rows = await this.scopedWrite<Appointment>(
      `INSERT INTO appointments
        (id, location_id, calendar_id, contact_id, title, starts_at, ends_at, location_text, notes)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id,
        input.calendarId,
        input.contactId ?? null,
        input.title,
        input.startsAt,
        input.endsAt,
        input.locationText ?? null,
        input.notes ?? null,
      ],
    )
    return rows[0]!
  }

  /** Move an appointment to a new time (drag or edit). */
  async reschedule(id: string, startsAt: string, endsAt: string): Promise<Appointment | undefined> {
    const rows = await this.scopedWrite<Appointment>(
      `UPDATE appointments SET starts_at=$2, ends_at=$3, updated_at=now()
       WHERE location_id=$1 AND id=$4 RETURNING *`,
      [startsAt, endsAt, id],
    )
    return rows[0]
  }

  async setStatus(id: string, status: string): Promise<Appointment | undefined> {
    const rows = await this.scopedWrite<Appointment>(
      `UPDATE appointments SET status=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [status, id],
    )
    return rows[0]
  }
}
