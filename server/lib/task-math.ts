/**
 * Honest math for Contact Tasks (the GHL task worklist). A task's "due status"
 * and the worklist KPI band are both COMPUTED here from the real row fields
 * (due_at, completed_at) against an explicit `now`, never stored — so a count
 * can never drift from the tasks that justify it and an empty list is an honest
 * all-zero.
 *
 * Comparisons are by UTC calendar day: a task due any time today reads "today"
 * even after its hour has passed, and "overdue" means an earlier calendar day,
 * not merely an earlier moment. Passing `now` in keeps every function pure and
 * deterministic (rows + clock in, status out) regardless of the machine's
 * timezone.
 */

const DAY_MS = 86_400_000

/** The whole-day bucket a UTC timestamp falls in (days since the epoch). Two
 *  instants on the same UTC date share a bucket. */
function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS)
}

/** Only the two row fields the math reads; accepts the DB row as-is. */
export interface TaskRow {
  due_at: string | null
  completed_at: string | null
}

export type TaskDueStatus = 'done' | 'overdue' | 'today' | 'upcoming' | 'none'

/**
 * The due status of one task relative to `now`. A completed task is always
 * `done` (its due date no longer matters); an open task with no — or an
 * unparseable — due date is `none`; otherwise it is `overdue` / `today` /
 * `upcoming` by UTC calendar day. Total over every task, never throws.
 */
export function taskDueStatus(task: TaskRow, now: Date): TaskDueStatus {
  if (task.completed_at != null) return 'done'
  if (task.due_at == null) return 'none'
  const due = Date.parse(task.due_at)
  if (!Number.isFinite(due)) return 'none'
  const dueDay = utcDay(due)
  const nowDay = utcDay(now.getTime())
  if (dueDay < nowDay) return 'overdue'
  if (dueDay === nowDay) return 'today'
  return 'upcoming'
}

export interface TaskSummary {
  /** Tasks not yet completed. */
  open: number
  /** Of the open tasks, those due on an earlier calendar day. */
  overdue: number
  /** Of the open tasks, those due today. */
  dueToday: number
  /** The remaining open tasks: due later, or with no due date. */
  upcoming: number
  /** Tasks marked done. */
  completed: number
}

/**
 * Fold a set of task rows into the worklist KPI band. Every open task is counted
 * in exactly one of overdue / dueToday / upcoming, so `upcoming` is precisely
 * `open − overdue − dueToday` and the buckets always reconcile to `open`. An
 * empty set is an honest all-zero.
 */
export function summarizeTasks(tasks: TaskRow[], now: Date): TaskSummary {
  let open = 0
  let overdue = 0
  let dueToday = 0
  let completed = 0
  for (const t of tasks) {
    if (t.completed_at != null) {
      completed += 1
      continue
    }
    open += 1
    const status = taskDueStatus(t, now)
    if (status === 'overdue') overdue += 1
    else if (status === 'today') dueToday += 1
  }
  return { open, overdue, dueToday, upcoming: open - overdue - dueToday, completed }
}
