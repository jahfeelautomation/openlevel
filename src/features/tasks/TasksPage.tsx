import { CheckCircle2, Circle, ListTodo } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../../components/ui/avatar'
import { Badge } from '../../components/ui/badge'
import { PageSpinner } from '../../components/ui/spinner'
import { type ContactTaskWithContact, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { taskDueBadge, taskDueStatus } from './tasks-meta'

/**
 * The global Tasks worklist — every open and completed to-do across all contacts,
 * grouped by urgency (Overdue / Today / Upcoming) with a completed archive. Each
 * row links back to the contact it hangs off and can be checked off in place.
 *
 * Every KPI is the literal length of the section beneath it, computed from the
 * same rows the list renders, so the headline can never disagree with what you
 * see. Tasks are internal to-dos: checking one off never sends a message or moves
 * money.
 */
export function TasksPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [tasks, setTasks] = useState<ContactTaskWithContact[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Re-fetch the whole worklist (and its order) without flashing the spinner —
  // used after a toggle so the row jumps to its new section.
  const reload = useCallback(async () => {
    if (!loc) return
    const res = await api.tasks(loc)
    setTasks(res.tasks)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setTasks(null)
    api
      .tasks(loc)
      .then((res) => active && setTasks(res.tasks))
      .catch(() => active && setTasks([]))
    return () => {
      active = false
    }
  }, [loc])

  async function toggle(task: ContactTaskWithContact) {
    if (!loc) return
    setBusyId(task.id)
    try {
      await api.updateContactTask(loc, task.contact_id, task.id, {
        completed: task.completed_at == null,
      })
      await reload()
    } finally {
      setBusyId(null)
    }
  }

  if (tasks === null) return <PageSpinner label="Loading tasks" />

  const now = new Date()
  const open = tasks.filter((t) => t.completed_at == null)
  const overdue = open.filter((t) => taskDueStatus(t, now) === 'overdue')
  const today = open.filter((t) => taskDueStatus(t, now) === 'today')
  const upcoming = open.filter((t) => {
    const status = taskDueStatus(t, now)
    return status === 'upcoming' || status === 'none'
  })
  const completed = tasks.filter((t) => t.completed_at != null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Tasks</h1>
          <p className="text-xs text-slate-500">Every to-do across your contacts, in one worklist.</p>
        </div>
      </header>

      {/* KPI band — each figure is the length of the matching section below */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-5">
        <Kpi label="Open" value={open.length} sub="still to do" />
        <Kpi
          label="Overdue"
          value={overdue.length}
          sub="past due"
          tone={overdue.length ? 'rose' : undefined}
        />
        <Kpi
          label="Today"
          value={today.length}
          sub="due today"
          tone={today.length ? 'amber' : undefined}
        />
        <Kpi
          label="Upcoming"
          value={upcoming.length}
          sub="later or no date"
          tone={upcoming.length ? 'blue' : undefined}
        />
        <Kpi
          label="Completed"
          value={completed.length}
          sub="done"
          tone={completed.length ? 'emerald' : undefined}
        />
      </div>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
        {tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <ListTodo className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No tasks yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Add tasks from any contact record and they will show up here.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <Section title="Overdue" tone="rose" tasks={overdue} busyId={busyId} onToggle={toggle} now={now} />
            <Section title="Today" tone="amber" tasks={today} busyId={busyId} onToggle={toggle} now={now} />
            <Section title="Upcoming" tone="slate" tasks={upcoming} busyId={busyId} onToggle={toggle} now={now} />
            <Section
              title="Completed"
              tone="slate"
              tasks={completed}
              busyId={busyId}
              onToggle={toggle}
              now={now}
              muted
            />
          </div>
        )}
      </div>
    </div>
  )
}

const TONE: Record<string, string> = {
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  blue: 'text-blue-600',
  emerald: 'text-emerald-600',
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: number
  sub: string
  tone?: 'rose' | 'amber' | 'blue' | 'emerald'
}) {
  return (
    <div className="bg-white px-5 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-xl font-bold tabular-nums', tone ? TONE[tone] : 'text-slate-900')}>
        {value}
      </p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}

function Section({
  title,
  tone,
  tasks,
  busyId,
  onToggle,
  now,
  muted,
}: {
  title: string
  tone: 'rose' | 'amber' | 'slate'
  tasks: ContactTaskWithContact[]
  busyId: string | null
  onToggle: (task: ContactTaskWithContact) => void
  now: Date
  muted?: boolean
}) {
  if (tasks.length === 0) return null
  const dot = tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-slate-400'
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', dot)} />
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <span className="text-xs font-medium tabular-nums text-slate-400">{tasks.length}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            busy={busyId === task.id}
            onToggle={() => onToggle(task)}
            now={now}
            muted={muted}
          />
        ))}
      </ul>
    </section>
  )
}

function TaskRow({
  task,
  busy,
  onToggle,
  now,
  muted,
}: {
  task: ContactTaskWithContact
  busy: boolean
  onToggle: () => void
  now: Date
  muted?: boolean
}) {
  const done = task.completed_at != null
  const dueBadge = taskDueBadge(task, now)
  const name = task.contact_name ?? 'Unknown contact'
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-xl border border-slate-200 p-3.5 shadow-sm',
        muted ? 'bg-slate-50/60' : 'bg-white',
      )}
    >
      <button
        type="button"
        title={done ? 'Mark as open' : 'Mark complete'}
        onClick={onToggle}
        disabled={busy}
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
          done ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-500',
        )}
      >
        {done ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p
            className={cn(
              'text-sm font-medium',
              done ? 'text-slate-400 line-through' : 'text-slate-800',
            )}
          >
            {task.title}
          </p>
          {dueBadge ? (
            <Badge variant={dueBadge.variant} className="shrink-0">
              {dueBadge.label}
            </Badge>
          ) : null}
        </div>
        {task.body ? <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{task.body}</p> : null}
        <Link
          to={`/contacts/${task.contact_id}`}
          className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-600"
        >
          <Avatar name={name} size="sm" className="h-5 w-5 text-[10px]" />
          {name}
        </Link>
      </div>
    </li>
  )
}
