import { Pencil, Tag, Tags as TagsIcon, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageSpinner } from '../../components/ui/spinner'
import { type TagSummary, api } from '../../lib/api'
import { useTenant } from '../../state/location'

/**
 * Tags — the location-wide tag manager (the GHL "Tags" settings area). Tags live
 * inside contacts.tags; this lists the distinct set busiest-first with a contact
 * count on each, and lets the operator rename a tag (merging it into another
 * everywhere it appears) or delete it from every contact. Counts are derived from
 * real contacts, never stored, so an unused tag simply stops appearing. Editing a
 * tag here only relabels contacts — it never sends a message or moves money.
 */
export function TagsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [tags, setTags] = useState<TagSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.tags(loc)
    setTags(r.tags)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setEditing(null)
    setConfirm(null)
    api
      .tags(loc)
      .then((r) => {
        if (!active) return
        setTags(r.tags)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function rename(tag: string) {
    const name = draft.trim()
    if (!loc || !name || busy) return
    // Renaming to the same label is a no-op; just close the editor.
    if (name === tag) {
      setEditing(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.renameTag(loc, tag, name)
      setEditing(null)
      setDraft('')
      await refresh()
    } catch {
      setError('Could not rename the tag.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(tag: string) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteTag(loc, tag)
      setConfirm(null)
      await refresh()
    } catch {
      setError('Could not delete the tag.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading') return <PageSpinner label="Loading tags" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-base font-semibold text-slate-900">Tags</h1>
        <p className="text-xs text-slate-500">
          Every label across your contacts. Rename to merge two together, or delete to
          clear one from everyone.
        </p>
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-2xl">
          {error ? <p className="mb-3 text-xs font-medium text-rose-600">{error}</p> : null}

          {tags.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <TagsIcon className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No tags yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Tags you add to a contact — or that an automation applies — show up here.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
                </span>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Contacts
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {tags.map((t) => (
                  <li key={t.tag} className="px-4 py-2.5">
                    {editing === t.tag ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={draft}
                          autoFocus
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void rename(t.tag)
                            }
                            if (e.key === 'Escape') setEditing(null)
                          }}
                          className="h-8"
                        />
                        <Button
                          size="sm"
                          disabled={!draft.trim() || busy}
                          onClick={() => void rename(t.tag)}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : confirm === t.tag ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-rose-700">
                          Delete <span className="font-semibold">{t.tag}</span> from {t.count}{' '}
                          {t.count === 1 ? 'contact' : 'contacts'}?
                        </span>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => void remove(t.tag)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
                          <Tag className="h-3.5 w-3.5" />
                          {t.tag}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="mr-1 text-sm tabular-nums text-slate-500">{t.count}</span>
                          <IconBtn
                            title="Rename"
                            onClick={() => {
                              setEditing(t.tag)
                              setDraft(t.tag)
                              setConfirm(null)
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </IconBtn>
                          <IconBtn
                            title="Delete"
                            onClick={() => {
                              setConfirm(t.tag)
                              setEditing(null)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconBtn>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
    >
      {children}
    </button>
  )
}
