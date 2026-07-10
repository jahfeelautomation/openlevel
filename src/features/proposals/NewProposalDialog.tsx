import { type FormEvent, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { Contact, NewProposal } from '../../lib/api'
import { formatPhone } from '../../lib/utils'

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

/** Create a proposal: give it a title (the slug auto-derives but stays editable —
 *  it's the public link) and, optionally, the contact it's for. A working starter
 *  body is seeded server-side, so the operator edits a real quote from the first
 *  moment instead of a blank page. */
export function NewProposalDialog({
  contacts,
  onCancel,
  onCreate,
}: {
  contacts: Contact[]
  onCancel: () => void
  onCreate: (input: NewProposal) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [contactId, setContactId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveSlug = slugEdited ? slug : slugify(title)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !effectiveSlug || saving) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({ title: title.trim(), slug: effectiveSlug, contactId: contactId || null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create proposal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">New proposal</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="pr-new-title">Title</Label>
            <Input
              id="pr-new-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Growth proposal — Acme Co."
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="pr-new-slug">URL slug</Label>
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30">
              <span className="text-sm text-slate-400">/proposals/</span>
              <input
                id="pr-new-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugEdited(true)
                  setSlug(slugify(e.target.value))
                }}
                placeholder="growth-acme"
                className="h-10 flex-1 bg-transparent px-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              The public web address the recipient will sign at.
            </p>
          </div>

          <div>
            <Label htmlFor="pr-new-contact">For (optional)</Label>
            <select
              id="pr-new-contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={selectClass}
            >
              <option value="">— No contact yet —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim() || !effectiveSlug || saving}>
            {saving ? 'Creating…' : 'Create proposal'}
          </Button>
        </div>
      </form>
    </div>
  )
}
