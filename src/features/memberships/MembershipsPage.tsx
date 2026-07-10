import { BookOpen, GraduationCap, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type Contact, type CourseListItem, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { CourseEditor } from './CourseEditor'
import { catalogTotals, progressTone, statusLabel } from './memberships-meta'

/**
 * Memberships — build courses, enroll students, and watch real progress. The list
 * view is a KPI band of honest catalog totals (courses, how many are live, total
 * students, total completions) over a grid of course cards; selecting a course
 * opens the builder. Every per-course figure is the server-derived rollup — an
 * empty course shows an honest zero, never a flattering estimate.
 */
export function MembershipsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [courses, setCourses] = useState<CourseListItem[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    if (!loc) return
    const c = await api.courses(loc)
    setCourses(c.courses)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setSelectedId(null)
    Promise.all([api.courses(loc), api.contacts(loc)])
      .then(([c, con]) => {
        if (!active) return
        setCourses(c.courses)
        setContacts(con.contacts)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function createCourse(title: string) {
    if (!loc) return
    const r = await api.createCourse(loc, { title })
    setCreating(false)
    await refresh()
    setSelectedId(r.course.id)
  }

  if (!loc || status === 'loading') return <PageSpinner />

  // Detail view — the builder for the selected course.
  if (selectedId) {
    return (
      <CourseEditor
        loc={loc}
        courseId={selectedId}
        contacts={contacts}
        onBack={() => {
          setSelectedId(null)
          void refresh()
        }}
        onChanged={() => void refresh()}
        onDeleted={() => {
          setSelectedId(null)
          void refresh()
        }}
      />
    )
  }

  const totals = catalogTotals(courses)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Memberships</h1>
          <p className="text-xs text-slate-500">Build courses and track your students' progress.</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New course
        </Button>
      </header>

      {/* KPI band — real catalog totals, summed from the server-derived rollups */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Kpi label="Courses" value={String(totals.courses)} sub={`${totals.published} published`} />
        <Kpi
          label="Published"
          value={String(totals.published)}
          sub={totals.courses - totals.published > 0 ? `${totals.courses - totals.published} in draft` : 'all live'}
        />
        <Kpi label="Students" value={String(totals.students)} sub="enrolled across courses" />
        <Kpi label="Completions" value={String(totals.completed)} sub="finished a course" accent />
      </div>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
        {courses.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <GraduationCap className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No courses yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Create your first course to start enrolling students.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New course
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} onOpen={() => setSelectedId(course.id)} />
            ))}
          </div>
        )}
      </div>

      {creating && <NewCourseDialog onCancel={() => setCreating(false)} onCreate={createCourse} />}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <div className="min-w-0 bg-white px-3 py-3 lg:px-5 lg:py-3.5">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          accent ? 'text-emerald-600' : 'text-slate-900',
        )}
      >
        {value}
      </p>
      <p className="truncate text-xs text-slate-400">{sub}</p>
    </div>
  )
}

function CourseCard({ course, onOpen }: { course: CourseListItem; onOpen: () => void }) {
  const { summary, lessonCount } = course
  const published = course.status === 'published'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <BookOpen className="h-[18px] w-[18px]" />
        </span>
        <Badge variant={published ? 'green' : 'amber'}>{statusLabel(course.status)}</Badge>
      </div>
      <h3 className="mt-3 line-clamp-1 text-sm font-semibold text-slate-900">{course.title}</h3>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs text-slate-500">
        {course.description || 'No description yet.'}
      </p>

      <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
        <span className="tabular-nums">
          {lessonCount} lesson{lessonCount === 1 ? '' : 's'}
        </span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">
          {summary.enrollments} student{summary.enrollments === 1 ? '' : 's'}
        </span>
      </div>

      {/* Average progress — server-derived; only shown once someone's enrolled */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        {summary.enrollments === 0 ? (
          <p className="text-xs text-slate-400">No students yet</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Average progress</span>
              <span className="font-medium tabular-nums text-slate-700">{summary.averagePercent}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn('h-full rounded-full', progressTone(summary.averagePercent))}
                style={{ width: `${summary.averagePercent}%` }}
              />
            </div>
            {summary.completed > 0 && (
              <p className="mt-1.5 text-xs text-emerald-600">
                {summary.completed} completed
              </p>
            )}
          </>
        )}
      </div>
    </button>
  )
}

/** Minimal create modal — just a title; everything else is edited in the builder. */
function NewCourseDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (title: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await onCreate(title.trim())
    } catch {
      setError('Could not create the course. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">New course</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Name it to get started — you'll add lessons and students next.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="new-course-title">Course title</Label>
            <Input
              id="new-course-title"
              value={title}
              autoFocus
              placeholder="e.g. Wholesaling Playbook"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create()
              }}
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!title.trim() || saving} onClick={() => void create()}>
            {saving ? 'Creating…' : 'Create course'}
          </Button>
        </div>
      </div>
    </div>
  )
}
