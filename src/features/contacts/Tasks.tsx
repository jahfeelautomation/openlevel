import { CheckCircle2, Circle, ListTodo, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { type ContactTask, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { dateInputToISO, isoToDateInput, taskDueBadge } from '../tasks/tasks-meta'

/**
 * The contact-record Tasks panel (GHL "Tasks"). An operator adds to-dos with an
 * optional due date, checks them off, edits, or deletes them. Open tasks float
 * above done ones, soonest due first — the server owns that order and we reload
 * after every change. Tasks are internal only: completing one never sends a
 * message or moves money.
 */
export function Tasks({ locationId, contactId }: { locationId: string; contactId: string }) {
  const [tasks, setTasks] = useState<ContactTask[] | null>(null)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDue, setEditDue] = useState('')
  const [editBody, setEditBody] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await api.contactTasks(locationId, contactId)
    setTasks(r.tasks)
  }

  useEffect(() => {
    let active = true
    setTasks(null)
    api
      .contactTasks(locationId, contactId)
      .then((r) => active && setTasks(r.tasks))
      .catch(() => active && setError('Could not load tasks.'))
    return () => {
      active = false
    }
  }, [locationId, contactId])

  async function add() {
    const t = title.trim()
    if (!t || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.createContactTask(locationId, contactId, { title: t, dueAt: dateInputToISO(due) })
      setTitle('')
      setDue('')
      await load()
    } catch {
      setError('Could not save the task.')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(task: ContactTask) {
    setBusyId(task.id)
    setError(null)
    try {
      await api.updateContactTask(locationId, contactId, task.id, {
        completed: task.completed_at == null,
      })
      await load()
    } catch {
      setError('Could not update the task.')
    } finally {
      setBusyId(null)
    }
  }

  function startEdit(task: ContactTask) {
    setEditingId(task.id)
    setEditTitle(task.title)
    setEditDue(isoToDateInput(task.due_at))
    setEditBody(task.body ?? '')
    setConfirmId(null)
  }

  async function saveEdit(task: ContactTask) {
    const t = editTitle.trim()
    if (!t) return
    setBusyId(task.id)
    setError(null)
    try {
      await api.updateContactTask(locationId, contactId, task.id, {
        title: t,
        dueAt: dateInputToISO(editDue),
        body: editBody.trim() || null,
      })
      setEditingId(null)
      await load()
    } catch {
      setError('Could not update the task.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(task: ContactTask) {
    setBusyId(task.id)
    setError(null)
    try {
      await api.deleteContactTask(locationId, contactId, task.id)
      setConfirmId(null)
      await load()
    } catch {
      setError('Could not delete the task.')
    } finally {
      setBusyId(null)
    }
  }

  const openCount = tasks?.filter((t) => t.completed_at == null).length ?? 0
  const now = new Date()

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-900">Tasks</h3>
        {openCount > 0 ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {openCount} open
          </span>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <Input
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            Due
            <Input
              type="date"
              className="h-9 w-auto px-2 text-slate-600"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <Button size="sm" onClick={() => void add()} disabled={!title.trim() || saving}>
            {saving ? 'Saving…' : 'Add task'}
          </Button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}

      <div className="mt-3">
        {tasks === null ? (
          <p className="px-1 py-6 text-sm text-slate-400">Loading tasks…</p>
        ) : tasks.length === 0 ? (
          <p className="px-1 py-6 text-sm text-slate-400">No tasks yet. Add the first one above.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => {
              const done = task.completed_at != null
              const dueBadge = taskDueBadge(task, now)
              return (
                <li
                  key={task.id}
                  className={cn(
                    'rounded-xl border p-3 shadow-sm',
                    done ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      title={done ? 'Mark as open' : 'Mark complete'}
                      onClick={() => void toggle(task)}
                      disabled={busyId === task.id}
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
                        done ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-500',
                      )}
                    >
                      {done ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </button>

                    {editingId === task.id ? (
                      <div className="min-w-0 flex-1">
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Task title"
                        />
                        <Textarea
                          rows={2}
                          className="mt-2"
                          placeholder="Add details (optional)"
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                        />
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-slate-400">
                            Due
                            <Input
                              type="date"
                              className="h-9 w-auto px-2 text-slate-600"
                              value={editDue}
                              onChange={(e) => setEditDue(e.target.value)}
                            />
                          </label>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void saveEdit(task)}
                              disabled={!editTitle.trim() || busyId === task.id}
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p
                              className={cn(
                                'text-sm font-medium',
                                done ? 'text-slate-400 line-through' : 'text-slate-800',
                              )}
                            >
                              {task.title}
                            </p>
                            {task.body ? (
                              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">
                                {task.body}
                              </p>
                            ) : null}
                            {dueBadge ? (
                              <Badge variant={dueBadge.variant} className="mt-1.5">
                                {dueBadge.label}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-0.5">
                            <IconBtn
                              title="Edit"
                              onClick={() => startEdit(task)}
                              disabled={busyId === task.id}
                            >
                              <Pencil className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn
                              title="Delete"
                              onClick={() => setConfirmId(confirmId === task.id ? null : task.id)}
                              disabled={busyId === task.id}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconBtn>
                          </div>
                        </div>

                        {confirmId === task.id ? (
                          <div className="mt-2.5 flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2">
                            <span className="text-xs font-medium text-rose-700">
                              Delete this task?
                            </span>
                            <div className="flex gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => void remove(task)}
                                disabled={busyId === task.id}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
