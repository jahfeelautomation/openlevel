import { type FormEvent, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { NewFunnel } from '../../lib/api'

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Create a funnel: name it (slug auto-derives, still editable). A starter
 *  opt-in + thank-you page are seeded server-side. */
export function NewFunnelDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (input: NewFunnel) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveSlug = slugEdited ? slug : slugify(name)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !effectiveSlug || saving) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({ name: name.trim(), slug: effectiveSlug })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create funnel')
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
          <h2 className="text-base font-semibold text-slate-900">New funnel</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="fn-name">Funnel name</Label>
            <Input
              id="fn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sell your house fast"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="fn-slug">URL slug</Label>
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30">
              <span className="text-sm text-slate-400">/f/</span>
              <input
                id="fn-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugEdited(true)
                  setSlug(slugify(e.target.value))
                }}
                placeholder="sell-fast"
                className="h-10 flex-1 bg-transparent px-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              The public web address visitors will see.
            </p>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!name.trim() || !effectiveSlug || saving}>
            {saving ? 'Creating…' : 'Create funnel'}
          </Button>
        </div>
      </form>
    </div>
  )
}
