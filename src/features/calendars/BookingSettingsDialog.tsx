import { ExternalLink, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { ApiError, type AvailabilityWindow, type Calendar, type CalendarPatch, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { CopyButton, hostedUrl } from '../trigger-links/link-ui'

// Weekday rows, Monday-first for familiarity (data still keys 0=Sun).
const WEEKDAYS: { idx: number; label: string }[] = [
  { idx: 1, label: 'Monday' },
  { idx: 2, label: 'Tuesday' },
  { idx: 3, label: 'Wednesday' },
  { idx: 4, label: 'Thursday' },
  { idx: 5, label: 'Friday' },
  { idx: 6, label: 'Saturday' },
  { idx: 0, label: 'Sunday' },
]

// Color swatches mirror CalendarsPage's CAL_COLORS — full static classes so
// Tailwind keeps them through purge.
const COLOR_SWATCHES: { key: string; cls: string }[] = [
  { key: 'indigo', cls: 'bg-indigo-500' },
  { key: 'emerald', cls: 'bg-emerald-500' },
  { key: 'amber', cls: 'bg-amber-500' },
  { key: 'rose', cls: 'bg-rose-500' },
  { key: 'sky', cls: 'bg-sky-500' },
  { key: 'violet', cls: 'bg-violet-500' },
  { key: 'brand', cls: 'bg-brand-500' },
]

const COMMON_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Australia/Sydney',
  'UTC',
]

const timeInput =
  'h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'
const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

/** Keep a slug URL-safe as the operator types (spaces + punctuation → dashes)
 *  without stripping a trailing dash mid-word. */
function liveSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}
/** Final tidy before saving: collapse repeats and trim edge dashes. */
function cleanSlug(raw: string): string {
  return liveSlug(raw).replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

const intOr = (v: string, fallback: number) => {
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

/**
 * Per-calendar settings: its name + color, and the full public booking config —
 * enable, public link (slug) with a copyable hosted URL, headline/blurb,
 * timezone, slot duration/interval/buffer/notice/window, and a weekly
 * availability editor. Saving PATCHes the calendar and hands the fresh row back.
 */
export function BookingSettingsDialog({
  calendar,
  loc,
  onClose,
  onSaved,
}: {
  calendar: Calendar
  loc: string
  onClose: () => void
  onSaved: (updated: Calendar) => void
}) {
  const [name, setName] = useState(calendar.name)
  const [color, setColor] = useState(calendar.color)
  const [enabled, setEnabled] = useState(calendar.booking_enabled)
  const [slug, setSlug] = useState(calendar.booking_slug ?? '')
  const [timezone, setTimezone] = useState(calendar.timezone)
  const [durationMin, setDurationMin] = useState(calendar.duration_min)
  const [slotIntervalMin, setSlotIntervalMin] = useState(calendar.slot_interval_min)
  const [bufferMin, setBufferMin] = useState(calendar.buffer_min)
  const [noticeMin, setNoticeMin] = useState(calendar.notice_min)
  const [rollingDays, setRollingDays] = useState(calendar.rolling_days)
  const [headline, setHeadline] = useState(calendar.booking_headline ?? '')
  const [blurb, setBlurb] = useState(calendar.booking_blurb ?? '')
  const [availability, setAvailability] = useState<AvailabilityWindow[]>(calendar.availability ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Timezone list always includes the calendar's current zone.
  const zones = useMemo(
    () => (COMMON_ZONES.includes(timezone) ? COMMON_ZONES : [timezone, ...COMMON_ZONES]),
    [timezone],
  )

  const tidySlug = cleanSlug(slug)
  const previewUrl = hostedUrl(`/api/public/booking/${loc}/${tidySlug || 'your-link'}`)
  const canOpen = enabled && tidySlug.length > 0

  const dayEntries = (weekday: number) =>
    availability.map((w, i) => ({ i, w })).filter((e) => e.w.weekday === weekday)
  const addWindow = (weekday: number) =>
    setAvailability((prev) => [...prev, { weekday, start: '09:00', end: '17:00' }])
  const updateWindow = (i: number, patch: Partial<AvailabilityWindow>) =>
    setAvailability((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)))
  const removeWindow = (i: number) =>
    setAvailability((prev) => prev.filter((_, idx) => idx !== i))
  const applyWeekdays = () =>
    setAvailability([1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00' })))

  async function save() {
    if (saving) return
    setError(null)
    const finalSlug = cleanSlug(slug)
    if (enabled && !finalSlug) {
      setError('Add a booking link before turning the page on.')
      return
    }
    if (finalSlug && !/^[a-z0-9][a-z0-9-]*$/.test(finalSlug)) {
      setError('Booking link can use lowercase letters, numbers, and dashes.')
      return
    }
    const patch: CalendarPatch = {
      name: name.trim() || calendar.name,
      color,
      durationMin: Math.max(5, durationMin || 30),
      bookingEnabled: enabled,
      bookingSlug: finalSlug || null,
      timezone,
      slotIntervalMin: Math.max(0, slotIntervalMin || 0),
      bufferMin: Math.max(0, bufferMin || 0),
      noticeMin: Math.max(0, noticeMin || 0),
      rollingDays: Math.min(60, Math.max(1, rollingDays || 14)),
      availability: availability.map((w) => ({ weekday: w.weekday, start: w.start, end: w.end })),
      bookingHeadline: headline.trim() || null,
      bookingBlurb: blurb.trim() || null,
    }
    setSaving(true)
    try {
      const { calendar: updated } = await api.updateCalendar(loc, calendar.id, patch)
      onSaved(updated)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : ''
      setError(
        msg === 'slug taken'
          ? 'That booking link is already in use by another calendar.'
          : 'Could not save. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Calendar settings</h2>
            <p className="text-xs text-slate-500">Name, color, and the public booking page.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="ol-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* General */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="cal-name">Name</Label>
              <Input
                id="cal-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Seller Consultations"
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex gap-2">
                {COLOR_SWATCHES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-label={s.key}
                    aria-pressed={color === s.key}
                    onClick={() => setColor(s.key)}
                    className={cn(
                      'h-7 w-7 rounded-full ring-2 ring-offset-2 transition-transform',
                      s.cls,
                      color === s.key ? 'ring-slate-400' : 'ring-transparent hover:scale-110',
                    )}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Public booking toggle */}
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Public booking page</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Let people pick an open time and book themselves in.
                </p>
              </div>
              <Toggle checked={enabled} onChange={setEnabled} label="Enable booking page" />
            </div>

            {/* Booking link */}
            <div className="mt-4">
              <Label htmlFor="cal-slug">Booking link</Label>
              <Input
                id="cal-slug"
                value={slug}
                onChange={(e) => setSlug(liveSlug(e.target.value))}
                placeholder="cash-offer"
              />
              <div className="mt-2 flex items-center gap-2">
                <div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="truncate text-xs text-slate-500">{previewUrl}</p>
                </div>
                <CopyButton text={previewUrl} label="Copy" />
                {canOpen && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </a>
                )}
              </div>
            </div>
          </section>

          {/* Page copy */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="cal-headline">Headline</Label>
              <Input
                id="cal-headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Book a cash-offer consultation"
              />
            </div>
            <div>
              <Label htmlFor="cal-blurb">Intro (optional)</Label>
              <Textarea
                id="cal-blurb"
                rows={2}
                value={blurb}
                onChange={(e) => setBlurb(e.target.value)}
                placeholder="Pick a 30-minute slot that works for you and we will call to walk through your offer."
              />
            </div>
          </section>

          {/* Timing */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="cal-tz">Timezone</Label>
              <select
                id="cal-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={selectClass}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumField
                id="cal-duration"
                label="Meeting length (min)"
                min={5}
                step={5}
                value={durationMin}
                onChange={(v) => setDurationMin(v)}
              />
              <NumField
                id="cal-interval"
                label="Slot interval (min)"
                hint="Extra gap between start times"
                min={0}
                step={5}
                value={slotIntervalMin}
                onChange={(v) => setSlotIntervalMin(v)}
              />
              <NumField
                id="cal-buffer"
                label="Buffer after (min)"
                min={0}
                step={5}
                value={bufferMin}
                onChange={(v) => setBufferMin(v)}
              />
              <NumField
                id="cal-notice"
                label="Minimum notice (min)"
                min={0}
                step={15}
                value={noticeMin}
                onChange={(v) => setNoticeMin(v)}
              />
              <NumField
                id="cal-rolling"
                label="Days bookable ahead"
                min={1}
                max={60}
                step={1}
                value={rollingDays}
                onChange={(v) => setRollingDays(v)}
              />
            </div>
          </section>

          {/* Weekly availability */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <Label className="mb-0">Weekly availability</Label>
              <button
                type="button"
                onClick={applyWeekdays}
                className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700"
              >
                Use weekdays 9–5
              </button>
            </div>
            <div className="space-y-1 rounded-xl border border-slate-200 p-3">
              {WEEKDAYS.map(({ idx, label }) => {
                const entries = dayEntries(idx)
                return (
                  <div key={idx} className="flex items-start gap-3 py-1.5">
                    <div className="w-24 shrink-0 pt-2 text-sm font-medium text-slate-700">
                      {label}
                    </div>
                    <div className="flex-1 space-y-2">
                      {entries.length === 0 ? (
                        <div className="flex h-9 items-center text-sm text-slate-400">Closed</div>
                      ) : (
                        entries.map(({ i, w }) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={w.start}
                              onChange={(e) => updateWindow(i, { start: e.target.value })}
                              className={timeInput}
                            />
                            <span className="text-slate-400">–</span>
                            <input
                              type="time"
                              value={w.end}
                              onChange={(e) => updateWindow(i, { end: e.target.value })}
                              className={timeInput}
                            />
                            <button
                              type="button"
                              onClick={() => removeWindow(i)}
                              aria-label={`Remove ${label} hours`}
                              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))
                      )}
                      <button
                        type="button"
                        onClick={() => addWindow(idx)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 transition-colors hover:text-brand-700"
                      >
                        <Plus className="h-3 w-3" />
                        Add hours
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <footer className="flex items-center gap-3 border-t border-slate-100 px-5 py-3.5">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** A labelled integer field with an optional one-line hint. */
function NumField({
  id,
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  id: string
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(intOr(e.target.value, min ?? 0))}
      />
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

/** A compact accessible on/off switch (no external dependency). */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1',
        checked ? 'bg-brand-600' : 'bg-slate-200',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
