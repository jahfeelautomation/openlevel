import { Pencil, Pin, PinOff, StickyNote, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { type ContactNote, api } from '../../lib/api'
import { cn, relativeTime } from '../../lib/utils'
import { useAuth } from '../../state/auth'

/**
 * The contact-record Notes panel (GHL "Notes"). An operator jots free-text
 * notes; pinned ones float to the top. Add, pin/unpin, inline-edit, and delete
 * all hit the per-contact notes API and reload so the server's pinned-first
 * order stays authoritative. Notes are internal only — nothing here sends a
 * message or moves money.
 */
export function Notes({ locationId, contactId }: { locationId: string; contactId: string }) {
  const { operator } = useAuth()
  const author = operator?.name?.trim() || operator?.email || undefined

  const [notes, setNotes] = useState<ContactNote[] | null>(null)
  const [composer, setComposer] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await api.contactNotes(locationId, contactId)
    setNotes(r.notes)
  }

  useEffect(() => {
    let active = true
    setNotes(null)
    api
      .contactNotes(locationId, contactId)
      .then((r) => active && setNotes(r.notes))
      .catch(() => active && setError('Could not load notes.'))
    return () => {
      active = false
    }
  }, [locationId, contactId])

  async function add() {
    const body = composer.trim()
    if (!body || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.createContactNote(locationId, contactId, body, author)
      setComposer('')
      await load()
    } catch {
      setError('Could not save the note.')
    } finally {
      setSaving(false)
    }
  }

  async function togglePin(note: ContactNote) {
    setBusyId(note.id)
    setError(null)
    try {
      await api.updateContactNote(locationId, contactId, note.id, { pinned: !note.pinned })
      await load()
    } catch {
      setError('Could not update the note.')
    } finally {
      setBusyId(null)
    }
  }

  async function saveEdit(note: ContactNote) {
    const body = editDraft.trim()
    if (!body) return
    setBusyId(note.id)
    setError(null)
    try {
      await api.updateContactNote(locationId, contactId, note.id, { body })
      setEditingId(null)
      await load()
    } catch {
      setError('Could not update the note.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(note: ContactNote) {
    setBusyId(note.id)
    setError(null)
    try {
      await api.deleteContactNote(locationId, contactId, note.id)
      setConfirmId(null)
      await load()
    } catch {
      setError('Could not delete the note.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-900">Notes</h3>
        {notes && notes.length > 0 ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {notes.length}
          </span>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <Textarea
          rows={3}
          placeholder="Write a note about this contact…"
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-400">Cmd + Enter to save</span>
          <Button size="sm" onClick={() => void add()} disabled={!composer.trim() || saving}>
            {saving ? 'Saving…' : 'Add note'}
          </Button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}

      <div className="mt-3">
        {notes === null ? (
          <p className="px-1 py-6 text-sm text-slate-400">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="px-1 py-6 text-sm text-slate-400">No notes yet. Add the first one above.</p>
        ) : (
          <ul className="space-y-2.5">
            {notes.map((note) => (
              <li
                key={note.id}
                className={cn(
                  'rounded-xl border p-3.5 shadow-sm',
                  note.pinned ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={note.author} size="sm" />
                    <div className="leading-tight">
                      <div className="text-sm font-medium text-slate-800">
                        {note.author ?? 'Unknown'}
                      </div>
                      <div className="text-xs text-slate-400">{relativeTime(note.created_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {note.pinned ? (
                      <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <Pin className="h-3 w-3" /> Pinned
                      </span>
                    ) : null}
                    <IconBtn
                      title={note.pinned ? 'Unpin' : 'Pin'}
                      onClick={() => void togglePin(note)}
                      disabled={busyId === note.id}
                    >
                      {note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </IconBtn>
                    <IconBtn
                      title="Edit"
                      onClick={() => {
                        setEditingId(note.id)
                        setEditDraft(note.body)
                        setConfirmId(null)
                      }}
                      disabled={busyId === note.id}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      title="Delete"
                      onClick={() => setConfirmId(confirmId === note.id ? null : note.id)}
                      disabled={busyId === note.id}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconBtn>
                  </div>
                </div>

                {editingId === note.id ? (
                  <div className="mt-2.5">
                    <Textarea
                      rows={3}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void saveEdit(note)}
                        disabled={!editDraft.trim() || busyId === note.id}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {note.body}
                  </p>
                )}

                {confirmId === note.id ? (
                  <div className="mt-2.5 flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2">
                    <span className="text-xs font-medium text-rose-700">Delete this note?</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void remove(note)}
                        disabled={busyId === note.id}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
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
