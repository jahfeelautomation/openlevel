import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  GraduationCap,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Avatar } from '../../components/ui/avatar'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { Textarea } from '../../components/ui/textarea'
import {
  type Contact,
  type CourseDetail,
  type EnrollmentWithProgress,
  type Lesson,
  api,
} from '../../lib/api'
import { cn, formatPhone, relativeTime } from '../../lib/utils'
import { EnrollDialog } from './EnrollDialog'
import { LessonDialog, type LessonDraft } from './LessonDialog'
import { progressTone, statusLabel } from './memberships-meta'

/**
 * The course builder: edit the course's details, manage its ordered lessons, and
 * enroll/track students. Every progress figure shown here is the same
 * server-derived number the student sees on their player — read straight from the
 * detail payload, never recomputed or padded. Publishing only flips a flag; it
 * can't change anyone's real completion.
 */
export function CourseEditor({
  loc,
  courseId,
  contacts,
  onBack,
  onChanged,
  onDeleted,
}: {
  loc: string
  courseId: string
  contacts: Contact[]
  onBack: () => void
  /** Bubble up so the catalog list + KPI band re-derive after any edit. */
  onChanged: () => void
  onDeleted: () => void
}) {
  const [detail, setDetail] = useState<CourseDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [editingLesson, setEditingLesson] = useState<Lesson | 'new' | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const d = await api.course(loc, courseId)
    setDetail(d)
    return d
  }, [loc, courseId])

  useEffect(() => {
    let active = true
    setStatus('loading')
    api
      .course(loc, courseId)
      .then((d) => {
        if (!active) return
        setDetail(d)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc, courseId])

  async function afterMutation() {
    await refresh()
    onChanged()
  }

  async function togglePublish() {
    if (!detail) return
    setBusy(true)
    const next = detail.course.status === 'published' ? 'draft' : 'published'
    try {
      await api.updateCourse(loc, courseId, { status: next })
      await afterMutation()
    } finally {
      setBusy(false)
    }
  }

  async function saveLesson(draft: LessonDraft) {
    if (editingLesson === 'new') {
      await api.addLesson(loc, courseId, draft)
    } else if (editingLesson) {
      await api.updateLesson(loc, courseId, editingLesson.id, draft)
    }
    setEditingLesson(null)
    await afterMutation()
  }

  async function deleteLesson(lesson: Lesson) {
    await api.deleteLesson(loc, courseId, lesson.id)
    await afterMutation()
  }

  // Reorder by swapping this lesson's position with its neighbour's, then
  // persisting both. The list index === array order, so we swap with the
  // adjacent row in the requested direction.
  async function moveLesson(index: number, dir: -1 | 1) {
    if (!detail) return
    const lessons = detail.lessons
    const target = lessons[index]
    const swap = lessons[index + dir]
    if (!target || !swap) return
    setBusy(true)
    try {
      await Promise.all([
        api.updateLesson(loc, courseId, target.id, { position: swap.position }),
        api.updateLesson(loc, courseId, swap.id, { position: target.position }),
      ])
      await afterMutation()
    } finally {
      setBusy(false)
    }
  }

  async function enroll(contactId: string | null): Promise<string> {
    const r = await api.enrollContact(loc, courseId, contactId)
    await afterMutation()
    return `${window.location.origin}${r.link}`
  }

  async function removeEnrollment(e: EnrollmentWithProgress) {
    await api.removeEnrollment(loc, courseId, e.id)
    await afterMutation()
  }

  async function reallyDelete() {
    setBusy(true)
    try {
      await api.deleteCourse(loc, courseId)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  const enrolledContactIds = useMemo(
    () => new Set((detail?.enrollments ?? []).map((e) => e.contact_id).filter((x): x is string => !!x)),
    [detail],
  )

  if (status === 'loading' || !detail) return <PageSpinner />

  const { course, lessons, enrollments } = detail
  const published = course.status === 'published'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Back to courses"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold text-slate-900">{course.title}</h1>
            <Badge variant={published ? 'green' : 'amber'}>{statusLabel(course.status)}</Badge>
          </div>
          <p className="text-xs text-slate-500">
            {lessons.length} lesson{lessons.length === 1 ? '' : 's'} · {enrollments.length} student
            {enrollments.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button size="sm" variant={published ? 'outline' : 'brand'} disabled={busy} onClick={() => void togglePublish()}>
          {published ? 'Unpublish' : 'Publish'}
        </Button>
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50">
        {/* grid-cols-1 (minmax(0,1fr)) is load-bearing on mobile: without it the
            implicit auto track grows to the widest lesson line's max-content and
            every card overflows the 390px viewport */}
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_20rem]">
          {/* Left: details + lessons */}
          <div className="flex flex-col gap-5">
            <DetailsCard
              key={course.id}
              course={detail.course}
              onSave={async (patch) => {
                await api.updateCourse(loc, courseId, patch)
                await afterMutation()
              }}
            />

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-slate-400" />
                  <h2 className="text-sm font-semibold text-slate-900">Lessons</h2>
                  <span className="text-xs text-slate-400">{lessons.length}</span>
                </div>
                <Button size="sm" variant="subtle" onClick={() => setEditingLesson('new')}>
                  <Plus className="h-4 w-4" />
                  Add lesson
                </Button>
              </div>

              {lessons.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <ListChecks className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-medium text-slate-600">No lessons yet</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Add your first lesson to build out this course.
                  </p>
                  <Button className="mt-3" size="sm" onClick={() => setEditingLesson('new')}>
                    <Plus className="h-4 w-4" />
                    Add lesson
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {lessons.map((lesson, i) => (
                    <LessonRow
                      key={lesson.id}
                      index={i}
                      lesson={lesson}
                      isFirst={i === 0}
                      isLast={i === lessons.length - 1}
                      busy={busy}
                      onUp={() => void moveLesson(i, -1)}
                      onDown={() => void moveLesson(i, 1)}
                      onEdit={() => setEditingLesson(lesson)}
                      onDelete={() => void deleteLesson(lesson)}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* Danger zone */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              {confirmDelete ? (
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-sm text-slate-600">
                    Delete <span className="font-medium text-slate-900">{course.title}</span> and all
                    its lessons and enrollments? This can't be undone.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void reallyDelete()}>
                      Delete course
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">Remove this course permanently.</p>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4" />
                    Delete course
                  </Button>
                </div>
              )}
            </section>
          </div>

          {/* Right: students */}
          <aside className="lg:sticky lg:top-0">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-slate-400" />
                  <h2 className="text-sm font-semibold text-slate-900">Students</h2>
                  <span className="text-xs text-slate-400">{enrollments.length}</span>
                </div>
                <Button size="sm" variant="subtle" onClick={() => setEnrolling(true)}>
                  <Plus className="h-4 w-4" />
                  Enroll
                </Button>
              </div>

              {enrollments.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <GraduationCap className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-medium text-slate-600">No students yet</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Enroll a contact to share the course and track real progress.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {enrollments.map((e) => (
                    <EnrollmentRow
                      key={e.id}
                      enrollment={e}
                      contacts={contacts}
                      onRemove={() => void removeEnrollment(e)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>

      {editingLesson && (
        <LessonDialog
          lesson={editingLesson === 'new' ? undefined : editingLesson}
          onCancel={() => setEditingLesson(null)}
          onSave={saveLesson}
        />
      )}
      {enrolling && (
        <EnrollDialog
          courseTitle={course.title}
          contacts={contacts}
          enrolledContactIds={enrolledContactIds}
          onCancel={() => setEnrolling(false)}
          onEnroll={enroll}
        />
      )}
    </div>
  )
}

/** Editable course title + description. The Save button only lights up when the
 *  fields actually differ from what's stored, so there's no phantom-save. */
function DetailsCard({
  course,
  onSave,
}: {
  course: CourseDetail['course']
  onSave: (patch: { title?: string; description?: string | null }) => Promise<void>
}) {
  const [title, setTitle] = useState(course.title)
  const [description, setDescription] = useState(course.description ?? '')
  const [saving, setSaving] = useState(false)

  const trimmedTitle = title.trim()
  const trimmedDesc = description.trim()
  const dirty =
    trimmedTitle.length > 0 &&
    (trimmedTitle !== course.title || trimmedDesc !== (course.description ?? ''))

  async function save() {
    if (!dirty) return
    setSaving(true)
    try {
      await onSave({
        title: trimmedTitle,
        description: trimmedDesc ? trimmedDesc : null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Course details</h2>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="course-title">Title</Label>
          <Input id="course-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="course-desc">Description</Label>
          <Textarea
            id="course-desc"
            value={description}
            rows={3}
            placeholder="A short summary students see at the top of the course."
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save details'}
          </Button>
        </div>
      </div>
    </section>
  )
}

function LessonRow({
  index,
  lesson,
  isFirst,
  isLast,
  busy,
  onUp,
  onDown,
  onEdit,
  onDelete,
}: {
  index: number
  lesson: Lesson
  isFirst: boolean
  isLast: boolean
  busy: boolean
  onUp: () => void
  onDown: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li className="group flex items-center gap-3 px-4 py-3">
      <div className="flex flex-col">
        <button
          type="button"
          disabled={isFirst || busy}
          onClick={onUp}
          className="text-slate-300 transition-colors hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300"
          title="Move up"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={isLast || busy}
          onClick={onDown}
          className="text-slate-300 transition-colors hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300"
          title="Move down"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold tabular-nums text-slate-500">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">{lesson.title}</p>
          {lesson.video_url && <Video className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
        </div>
        {lesson.content && <p className="truncate text-xs text-slate-400">{lesson.content}</p>}
      </div>
      {/* Always visible on touch; fade in on hover for pointer devices */}
      <div className="flex shrink-0 items-center gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Edit lesson"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
          title="Delete lesson"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  )
}

function EnrollmentRow({
  enrollment,
  contacts,
  onRemove,
}: {
  enrollment: EnrollmentWithProgress
  contacts: Contact[]
  onRemove: () => void
}) {
  const [copied, setCopied] = useState(false)
  const contact = enrollment.contact_id
    ? contacts.find((c) => c.id === enrollment.contact_id)
    : undefined
  const name = contact?.name ?? formatPhone(contact?.phones[0]) ?? 'Generic link'
  const { progress } = enrollment

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${enrollment.link}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — operator can still open the player link manually */
    }
  }

  return (
    <li className="group px-4 py-3">
      <div className="flex items-center gap-2.5">
        <Avatar name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{name}</p>
          <p className="text-xs text-slate-400">Enrolled {relativeTime(enrollment.created_at)}</p>
        </div>
        {progress.complete ? (
          <Badge variant="green">Completed</Badge>
        ) : (
          <Badge variant="amber">Active</Badge>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full rounded-full transition-all', progressTone(progress.percent))}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {progress.completed}/{progress.total}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs tabular-nums text-slate-400">{progress.percent}% complete</span>
        {/* Always visible on touch; fade in on hover for pointer devices */}
        <div className="flex items-center gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="Copy course link"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Link'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
            title="Un-enroll"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  )
}
