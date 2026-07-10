import { type FormEvent, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { Calendar, Contact, NewAppointment } from '../../lib/api'
import { formatPhone } from '../../lib/utils'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

/** Today's date as a local YYYY-MM-DD string for the date input default. */
function todayLocal(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Modal to book an appointment. Pre-selects the calendar whose "+" was used and
 *  defaults the duration to that calendar's slot length. */
export function NewAppointmentDialog({
  calendars,
  contacts,
  defaultCalendarId,
  onCancel,
  onCreate,
}: {
  calendars: Calendar[]
  contacts: Contact[]
  defaultCalendarId: string
  onCancel: () => void
  onCreate: (input: NewAppointment) => Promise<void>
}) {
  const firstCal = defaultCalendarId || calendars[0]?.id || ''
  const [calendarId, setCalendarId] = useState(firstCal)
  const [title, setTitle] = useState('')
  const [contactId, setContactId] = useState('')
  const [locationText, setLocationText] = useState('')
  const [date, setDate] = useState(todayLocal)
  const [time, setTime] = useState('09:00')
  const [duration, setDuration] = useState(
    () => calendars.find((c) => c.id === firstCal)?.duration_min ?? 30,
  )
  const [saving, setSaving] = useState(false)

  // Switching calendars resets the duration to that calendar's default slot.
  function pickCalendar(id: string) {
    setCalendarId(id)
    const cal = calendars.find((c) => c.id === id)
    if (cal) setDuration(cal.duration_min)
  }

  const valid = useMemo(
    () => Boolean(title.trim() && calendarId && date && time && duration > 0),
    [title, calendarId, date, time, duration],
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || saving) return
    const start = new Date(`${date}T${time}`)
    if (Number.isNaN(start.getTime())) return
    setSaving(true)
    try {
      await onCreate({
        calendarId,
        title: title.trim(),
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + duration * 60_000).toISOString(),
        contactId: contactId || null,
        locationText: locationText.trim() || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">New appointment</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="appt-title">Title</Label>
            <Input
              id="appt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Inspection — 482 Oakland Ave"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="appt-calendar">Calendar</Label>
            <select
              id="appt-calendar"
              value={calendarId}
              onChange={(e) => pickCalendar(e.target.value)}
              className={selectClass}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
            <div>
              <Label htmlFor="appt-date">Date</Label>
              <Input
                id="appt-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="appt-time">Time</Label>
              <Input
                id="appt-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <div className="w-20">
              <Label htmlFor="appt-duration">Mins</Label>
              <Input
                id="appt-duration"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number.parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="appt-contact">Contact (optional)</Label>
            <select
              id="appt-contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={selectClass}
            >
              <option value="">— None —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="appt-location">Location (optional)</Label>
            <Input
              id="appt-location"
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              placeholder="Address or meeting link"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!valid || saving}>
            {saving ? 'Booking…' : 'Book appointment'}
          </Button>
        </div>
      </form>
    </div>
  )
}
