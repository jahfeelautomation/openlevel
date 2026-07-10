import { ArrowLeft, CalendarDays, ChevronDown, ExternalLink, Globe, MapPin, Plus, Settings2 } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type Appointment,
  type AppointmentStatus,
  type Calendar,
  type Contact,
  type NewAppointment,
  api,
} from '../../lib/api'
import { cn, dayKey, formatDayLabel, formatTime } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { BookingSettingsDialog } from './BookingSettingsDialog'
import { NewAppointmentDialog } from './NewAppointmentDialog'
import { MonthView } from './MonthView'
import { hostedUrl } from '../trigger-links/link-ui'

// Full static class strings (no interpolation) so Tailwind keeps them on purge.
const DEFAULT_CAL_COLOR = { dot: 'bg-indigo-500', bar: 'bg-indigo-500' }
const CAL_COLORS: Record<string, { dot: string; bar: string }> = {
  indigo: DEFAULT_CAL_COLOR,
  emerald: { dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  amber: { dot: 'bg-amber-500', bar: 'bg-amber-500' },
  rose: { dot: 'bg-rose-500', bar: 'bg-rose-500' },
  sky: { dot: 'bg-sky-500', bar: 'bg-sky-500' },
  violet: { dot: 'bg-violet-500', bar: 'bg-violet-500' },
  brand: { dot: 'bg-brand-500', bar: 'bg-brand-500' },
}
const calColor = (color: string) => CAL_COLORS[color] ?? DEFAULT_CAL_COLOR

const STATUS_META: Record<AppointmentStatus, { label: string; pill: string }> = {
  scheduled: { label: 'Scheduled', pill: 'bg-slate-100 text-slate-700' },
  confirmed: { label: 'Confirmed', pill: 'bg-brand-50 text-brand-700' },
  completed: { label: 'Completed', pill: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Cancelled', pill: 'bg-amber-50 text-amber-700' },
  no_show: { label: 'No-show', pill: 'bg-rose-50 text-rose-700' },
}
const STATUS_ORDER: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
]

interface DayGroup {
  key: string
  label: string
  items: Appointment[]
}

/** Bucket pre-sorted appointments into contiguous day groups (API returns them
 *  in chronological order, so same-day rows are already adjacent). */
function groupByDay(items: Appointment[]): DayGroup[] {
  const out: DayGroup[] = []
  for (const a of items) {
    const key = dayKey(a.starts_at)
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(a)
    else out.push({ key, label: formatDayLabel(a.starts_at), items: [a] })
  }
  return out
}

export function CalendarsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [appts, setAppts] = useState<Appointment[]>([])
  const [contactsById, setContactsById] = useState<Record<string, Contact>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [selectedCalId, setSelectedCalId] = useState<string | null>(null)
  const [showDialog, setShowDialog] = useState(false)
  const [bookingCalId, setBookingCalId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [creatingSaving, setCreatingSaving] = useState(false)
  // mobile: drives list/detail visibility below lg. Starts open so a phone
  // lands on the agenda (the appointments) rather than a near-empty calendar
  // picker; the back button surfaces the picker. Desktop shows both panes.
  const [agendaOpen, setAgendaOpen] = useState(true)
  const [view, setView] = useState<'agenda' | 'month'>('month')

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    Promise.all([api.calendars(loc), api.appointments(loc), api.contacts(loc)])
      .then(([cal, appt, c]) => {
        if (!active) return
        setCalendars(cal.calendars)
        setAppts(appt.appointments)
        setContactsById(Object.fromEntries(c.contacts.map((x) => [x.id, x])))
        setStatus(cal.calendars.length > 0 ? 'ready' : 'empty')
      })
      .catch(() => active && setStatus('empty'))
    return () => {
      active = false
    }
  }, [loc])

  const calById = useMemo(
    () => Object.fromEntries(calendars.map((c) => [c.id, c])),
    [calendars],
  )

  const countByCal = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of appts) m[a.calendar_id] = (m[a.calendar_id] ?? 0) + 1
    return m
  }, [appts])

  const filtered = useMemo(
    () => (selectedCalId ? appts.filter((a) => a.calendar_id === selectedCalId) : appts),
    [appts, selectedCalId],
  )
  const groups = useMemo(() => groupByDay(filtered), [filtered])
  const selectedCal = selectedCalId ? calById[selectedCalId] : undefined
  const bookingCal = bookingCalId ? calById[bookingCalId] : undefined

  const reload = async () => {
    if (!loc) return
    const r = await api.appointments(loc)
    setAppts(r.appointments)
  }

  function setStatusOf(id: string, next: AppointmentStatus) {
    if (!loc) return
    setAppts((prev) => prev.map((a) => (a.id === id ? { ...a, status: next } : a)))
    api.setAppointmentStatus(loc, id, next).catch(() => void reload())
  }

  async function createAppt(input: NewAppointment) {
    if (!loc) return
    await api.createAppointment(loc, input)
    setShowDialog(false)
    await reload()
  }

  async function createCalendar(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!loc || !name || creatingSaving) return
    setCreatingSaving(true)
    try {
      const { calendar } = await api.createCalendar(loc, { name })
      setCalendars((prev) => [...prev, calendar])
      setSelectedCalId(calendar.id)
      setNewName('')
      setCreating(false)
    } finally {
      setCreatingSaving(false)
    }
  }

  // A booking-settings save returns the fresh calendar row — swap it in place so
  // the rail's live dot and the header link update without a full reload.
  function onCalendarSaved(updated: Calendar) {
    setCalendars((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    setBookingCalId(null)
  }

  const contactName = (a: Appointment) =>
    a.contact_id ? (contactsById[a.contact_id]?.name ?? undefined) : undefined

  if (!loc) return <Empty message="Select a sub-account to view calendars." />
  if (status === 'loading') return <PageSpinner />
  if (status === 'empty') return <Empty message="No calendars yet." />

  return (
    <div className="flex h-full min-h-0">
      {/* Calendar rail — list pane (full-width on mobile, fixed sidebar on desktop) */}
      <div
        className={cn(
          'w-full flex-col border-r border-slate-200 bg-white lg:flex lg:w-64 lg:shrink-0',
          agendaOpen ? 'hidden' : 'flex',
        )}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Calendars
          </p>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            aria-label="New calendar"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {creating && (
          <form onSubmit={createCalendar} className="px-3 pb-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
              placeholder="Calendar name"
              className="h-9"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCreating(false)
                  setNewName('')
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!newName.trim() || creatingSaving}>
                {creatingSaving ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </form>
        )}
        <nav className="ol-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          <RailRow
            label="All calendars"
            count={appts.length}
            active={selectedCalId === null}
            onClick={() => {
              setSelectedCalId(null)
              setAgendaOpen(true)
            }}
          />
          {calendars.map((cal) => (
            <RailRow
              key={cal.id}
              label={cal.name}
              count={countByCal[cal.id] ?? 0}
              dot={calColor(cal.color).dot}
              live={cal.booking_enabled}
              active={selectedCalId === cal.id}
              onClick={() => {
                setSelectedCalId(cal.id)
                setAgendaOpen(true)
              }}
            />
          ))}
        </nav>
      </div>

      {/* Agenda — detail pane */}
      <div
        className={cn(
          'min-w-0 flex-1 flex-col lg:flex',
          agendaOpen ? 'flex' : 'hidden',
        )}
      >
        {/* Mobile back button */}
        <button
          type="button"
          onClick={() => setAgendaOpen(false)}
          className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          All Calendars
        </button>

        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3.5 lg:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-slate-900">
              {selectedCal?.name ?? 'Calendars'}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>
                {filtered.length} upcoming{' '}
                {filtered.length === 1 ? 'appointment' : 'appointments'}
              </span>
              {selectedCal?.booking_enabled && selectedCal.booking_slug && (
                <a
                  href={hostedUrl(`/api/public/booking/${loc}/${selectedCal.booking_slug}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-emerald-600 transition-colors hover:text-emerald-700"
                >
                  <Globe className="h-3 w-3" />
                  Booking page live
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-1 mr-2 hidden sm:flex">
              <button
                type="button"
                onClick={() => setView('month')}
                className={cn('rounded px-2.5 py-1 text-xs font-medium transition-colors', view === 'month' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700')}
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => setView('agenda')}
                className={cn('rounded px-2.5 py-1 text-xs font-medium transition-colors', view === 'agenda' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700')}
              >
                Agenda
              </button>
            </div>
            {selectedCal && (
              <Button variant="outline" size="sm" onClick={() => setBookingCalId(selectedCal.id)}>
                <Settings2 className="h-4 w-4" />
                Booking page
              </Button>
            )}
            <Button size="sm" onClick={() => setShowDialog(true)}>
              <Plus className="h-4 w-4" />
              New appointment
            </Button>
          </div>
        </header>

        {view === 'month' ? (
          <MonthView appts={filtered} calendars={calById} onStatus={setStatusOf} contactName={contactName} />
        ) : (
          <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-4 lg:px-6 lg:py-5">
            {filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                <CalendarDays className="h-8 w-8" />
                <p className="text-sm">No upcoming appointments.</p>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6">
                {groups.map((group) => (
                  <section key={group.key}>
                    <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {group.label}
                    </h2>
                    <div className="space-y-2">
                      {group.items.map((appt) => (
                        <AppointmentRow
                          key={appt.id}
                          appt={appt}
                          calendar={calById[appt.calendar_id]}
                          contactName={contactName(appt)}
                          onStatus={setStatusOf}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showDialog && (
        <NewAppointmentDialog
          calendars={calendars}
          contacts={Object.values(contactsById)}
          defaultCalendarId={selectedCalId ?? calendars[0]?.id ?? ''}
          onCancel={() => setShowDialog(false)}
          onCreate={createAppt}
        />
      )}

      {bookingCal && loc && (
        <BookingSettingsDialog
          calendar={bookingCal}
          loc={loc}
          onClose={() => setBookingCalId(null)}
          onSaved={onCalendarSaved}
        />
      )}
    </div>
  )
}

function RailRow({
  label,
  count,
  dot,
  live,
  active,
  onClick,
}: {
  label: string
  count: number
  dot?: string
  live?: boolean
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
        active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50',
      )}
    >
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot ?? 'bg-slate-300')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {live && (
        <Globe
          className="h-3.5 w-3.5 shrink-0 text-emerald-500"
          aria-label="Booking page live"
        />
      )}
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 text-[11px] font-medium',
          active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500',
        )}
      >
        {count}
      </span>
    </button>
  )
}

function AppointmentRow({
  appt,
  calendar,
  contactName,
  onStatus,
}: {
  appt: Appointment
  calendar?: Calendar
  contactName?: string
  onStatus: (id: string, next: AppointmentStatus) => void
}) {
  const color = calColor(calendar?.color ?? 'indigo')
  const meta = STATUS_META[appt.status]
  const dimmed = appt.status === 'cancelled' || appt.status === 'no_show'
  return (
    <div
      className={cn(
        'group rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md',
        dimmed && 'opacity-60',
      )}
    >
      {/* Top row: time + color bar + title + status select */}
      <div className="flex items-start gap-3">
        <div className="w-16 shrink-0 pt-0.5 text-right lg:w-20">
          <p className="text-sm font-semibold text-slate-900">{formatTime(appt.starts_at)}</p>
          <p className="text-[11px] text-slate-400">{formatTime(appt.ends_at)}</p>
        </div>
        <div className={cn('mt-1 w-1 shrink-0 self-stretch rounded-full', color.bar)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{appt.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', color.dot)} />
              <span className="truncate">{calendar?.name ?? 'Calendar'}</span>
            </span>
            {contactName && (
              <span className="min-w-0 truncate text-slate-400">
                · <span className="text-slate-500">{contactName}</span>
              </span>
            )}
            {appt.location_text && (
              <span className="inline-flex min-w-0 items-center gap-1 text-slate-400">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{appt.location_text}</span>
              </span>
            )}
          </div>
        </div>
        <div className="relative flex shrink-0 items-center self-start">
          <select
            aria-label="Appointment status"
            value={appt.status}
            onChange={(e) => onStatus(appt.id, e.target.value as AppointmentStatus)}
            className={cn(
              'cursor-pointer appearance-none rounded-full py-1 pl-2 pr-6 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30 lg:pl-3 lg:pr-7',
              meta.pill,
            )}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 opacity-50 lg:right-2" />
        </div>
      </div>
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-xs text-sm text-slate-400">{message}</p>
    </div>
  )
}
