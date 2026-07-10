import type { BadgeProps } from '../../components/ui/badge'
import type { ContactTask } from '../../lib/api'

export type TaskDueStatus = 'done' | 'overdue' | 'today' | 'upcoming' | 'none'

const DAY_MS = 86_400_000
const utcDay = (ms: number) => Math.floor(ms / DAY_MS)

/**
 * Web mirror of server/lib/task-math.ts `taskDueStatus`. Compares by UTC calendar
 * day so a task due any time today reads "today" and the pill on screen matches
 * the server worklist math exactly. A completed task is always "done"; a missing
 * or unparseable due date is "none".
 */
export function taskDueStatus(
  task: Pick<ContactTask, 'due_at' | 'completed_at'>,
  now: Date,
): TaskDueStatus {
  if (task.completed_at != null) return 'done'
  if (task.due_at == null) return 'none'
  const due = Date.parse(task.due_at)
  if (!Number.isFinite(due)) return 'none'
  const d = utcDay(due)
  const n = utcDay(now.getTime())
  if (d < n) return 'overdue'
  if (d === n) return 'today'
  return 'upcoming'
}

/**
 * A short absolute date label, formatted in UTC so the calendar day never shifts
 * under the viewer timezone (we anchor seeded/created due dates at noon UTC).
 */
export function formatDueDate(dueAt: string): string {
  const ms = Date.parse(dueAt)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * Convert a `<input type="date">` value (YYYY-MM-DD) to an ISO instant anchored at
 * noon UTC. Noon UTC lands on the same calendar day in every timezone we serve, so
 * the chosen due day is never pushed across a date boundary. Empty input -> null.
 */
export function dateInputToISO(value: string): string | null {
  if (!value) return null
  return `${value}T12:00:00.000Z`
}

/**
 * Convert a stored due_at ISO back to a YYYY-MM-DD value for the date input,
 * reading the UTC date so it round-trips the noon-UTC anchor. Empty/unparseable -> ''.
 */
export function isoToDateInput(dueAt: string | null): string {
  if (!dueAt) return ''
  const ms = Date.parse(dueAt)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The due pill text + tone for an open task. Returns null when there is nothing
 * to show — no due date, or the task is already done (done tasks render in their
 * own section, not with a due pill).
 */
export function taskDueBadge(
  task: Pick<ContactTask, 'due_at' | 'completed_at'>,
  now: Date,
): { label: string; variant: BadgeProps['variant'] } | null {
  const status = taskDueStatus(task, now)
  if (status === 'overdue' && task.due_at) {
    return { label: `Overdue · ${formatDueDate(task.due_at)}`, variant: 'rose' }
  }
  if (status === 'today') return { label: 'Due today', variant: 'amber' }
  if (status === 'upcoming' && task.due_at) {
    return { label: `Due ${formatDueDate(task.due_at)}`, variant: 'blue' }
  }
  return null
}
