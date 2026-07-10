import { Plus, Tag, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { api } from '../../lib/api'

/**
 * The contact-record Tags editor. Shows the contact's tags as removable chips and
 * an add box that autocompletes from the location's existing tags (so an operator
 * reuses "cash-offer" instead of coining a near-duplicate "Cash Offer"). Add trims
 * and is case-preserving — matching the automation runner's add_tag — and a tag the
 * contact already wears is a silent no-op. Tags only label the contact; nothing
 * here sends a message or moves money.
 */
export function ContactTags({
  locationId,
  contactId,
  initialTags,
}: {
  locationId: string
  contactId: string
  initialTags: string[]
}) {
  const [tags, setTags] = useState<string[]>(initialTags)
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync when the parent switches to a different contact (the component is
  // reused across selections) — otherwise the previous contact's chips linger.
  useEffect(() => {
    setTags(initialTags)
    setDraft('')
    setError(null)
  }, [contactId, initialTags])

  // Pull the location's existing tags to power the add-box autocomplete.
  useEffect(() => {
    let active = true
    api
      .tags(locationId)
      .then((r) => active && setSuggestions(r.tags.map((t) => t.tag)))
      .catch(() => {
        /* autocomplete is a nicety; a failure just means no suggestions */
      })
    return () => {
      active = false
    }
  }, [locationId])

  const has = (tag: string) => tags.some((t) => t.toLowerCase() === tag.toLowerCase())

  async function add() {
    const tag = draft.trim()
    if (!tag || busy) return
    if (has(tag)) {
      setDraft('')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await api.addContactTag(locationId, contactId, tag)
      setTags(r.contact.tags)
      setDraft('')
      if (!suggestions.some((s) => s.toLowerCase() === tag.toLowerCase())) {
        setSuggestions((s) => [...s, tag])
      }
    } catch {
      setError('Could not add the tag.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(tag: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.removeContactTag(locationId, contactId, tag)
      setTags(r.contact.tags)
    } catch {
      setError('Could not remove the tag.')
    } finally {
      setBusy(false)
    }
  }

  // Only suggest tags the contact does not already wear; scope the datalist id to
  // the contact so two editors could never share one list.
  const unused = suggestions.filter((s) => !has(s))
  const listId = `contact-tags-${contactId}`

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        <Tag className="h-4 w-4" />
        Tags
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-700"
            >
              {t}
              <button
                type="button"
                title={`Remove ${t}`}
                onClick={() => void remove(t)}
                disabled={busy}
                className="flex h-4 w-4 items-center justify-center rounded-full text-brand-400 transition-colors hover:bg-brand-100 hover:text-brand-700 disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No tags yet.</p>
      )}

      <form
        className="mt-2.5 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <Input
          list={listId}
          value={draft}
          placeholder="Add a tag…"
          onChange={(e) => setDraft(e.target.value)}
          className="h-8 w-48"
        />
        <datalist id={listId}>
          {unused.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Button type="submit" size="sm" variant="dark" disabled={!draft.trim() || busy}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </form>

      {error ? <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  )
}
