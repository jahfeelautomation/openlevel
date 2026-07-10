import { Braces, Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type CustomValue, api } from '../../lib/api'
import { useTenant } from '../../state/location'

interface ValueDraft {
  name: string
  value: string
}

/**
 * Custom Values — the location-level constant manager (the GHL "Custom Values"
 * settings area). Each value is a name + text the operator references as a stable
 * {{custom_values.<key>}} merge tag in templates and automations. The key is
 * auto-slugged from the name once and never changes, so a tag already placed in a
 * template keeps resolving even after the value is renamed. There is one value per
 * key per location and no per-contact storage — editing here only changes stored
 * text; it never sends anything or moves money.
 */
export function CustomValuesPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [values, setValues] = useState<CustomValue[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.customValues(loc)
    setValues(r.values)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setCreating(false)
    setEditing(null)
    setConfirm(null)
    api
      .customValues(loc)
      .then((r) => {
        if (!active) return
        setValues(r.values)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function create(draft: ValueDraft) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.createCustomValue(loc, draft)
      setCreating(false)
      await refresh()
    } catch {
      setError('Could not add the value.')
    } finally {
      setBusy(false)
    }
  }

  async function save(id: string, draft: ValueDraft) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.updateCustomValue(loc, id, draft)
      setEditing(null)
      await refresh()
    } catch {
      setError('Could not save the value.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteCustomValue(loc, id)
      setConfirm(null)
      await refresh()
    } catch {
      setError('Could not delete the value.')
    } finally {
      setBusy(false)
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(token)
      window.setTimeout(() => setCopied((c) => (c === token ? null : c)), 1200)
    } catch {
      // Clipboard unavailable (e.g. insecure context). The token is on screen to
      // select manually, so there is nothing to surface here.
    }
  }

  if (!loc || status === 'loading') return <PageSpinner label="Loading custom values" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Custom Values</h1>
          <p className="text-xs text-slate-500">
            Reusable business constants — your business name, booking link, support number. Drop
            one into a template as a merge tag and it fills in everywhere.
          </p>
        </div>
        {!creating ? (
          <Button
            size="sm"
            onClick={() => {
              setCreating(true)
              setEditing(null)
              setConfirm(null)
            }}
          >
            <Plus className="h-4 w-4" />
            Add value
          </Button>
        ) : null}
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-2xl">
          {error ? <p className="mb-3 text-xs font-medium text-rose-600">{error}</p> : null}

          {creating ? (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">New custom value</h2>
              <ValueForm
                submitLabel="Add value"
                busy={busy}
                onSubmit={create}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : null}

          {values.length === 0 && !creating ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <Braces className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No custom values yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Add a value like your business name or booking link, then reference it in any
                template as a merge tag — change it once, and every message updates.
              </p>
            </div>
          ) : values.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-2.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {values.length} {values.length === 1 ? 'value' : 'values'}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {values.map((v) => {
                  const token = `{{custom_values.${v.key}}}`
                  return (
                    <li key={v.id} className="px-4 py-3">
                      {editing === v.id ? (
                        <ValueForm
                          submitLabel="Save"
                          busy={busy}
                          initial={v}
                          onSubmit={(d) => void save(v.id, d)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : confirm === v.id ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="min-w-0 text-sm text-rose-700">
                            Delete <span className="font-semibold">{v.name}</span>? Templates that
                            still use its tag will show the tag as-is.
                          </span>
                          <div className="flex shrink-0 gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => void remove(v.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                              <Braces className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">{v.name}</p>
                              <p className="truncate text-xs text-slate-500">
                                {v.value || <span className="italic text-slate-400">Empty</span>}
                              </p>
                              <button
                                type="button"
                                title="Copy merge tag"
                                onClick={() => void copyToken(token)}
                                className="mt-1 inline-flex max-w-full items-center gap-1 overflow-hidden rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 transition-colors hover:bg-slate-200"
                              >
                                {copied === token ? (
                                  <Check className="h-3 w-3 shrink-0 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3 w-3 shrink-0" />
                                )}
                                <span className="truncate">{token}</span>
                              </button>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <IconBtn
                              title="Edit"
                              onClick={() => {
                                setEditing(v.id)
                                setConfirm(null)
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn
                              title="Delete"
                              onClick={() => {
                                setConfirm(v.id)
                                setEditing(null)
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconBtn>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * The shared create/edit form. The merge key is derived from the name on first
 * save and then frozen, so renaming a value keeps its {{custom_values.<key>}} tag
 * working — only the display name and the stored text change here.
 */
function ValueForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Pick<CustomValue, 'name' | 'value' | 'key'>
  submitLabel: string
  busy: boolean
  onSubmit: (draft: ValueDraft) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [value, setValue] = useState(initial?.value ?? '')

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && !busy

  function submit() {
    if (!canSubmit) return
    onSubmit({ name: trimmedName, value: value.trim() })
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <Label htmlFor="cv-name">Name</Label>
          <Input
            id="cv-name"
            value={name}
            autoFocus
            placeholder="e.g. Business Name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div>
          <Label htmlFor="cv-value">Value</Label>
          <Input
            id="cv-value"
            value={value}
            placeholder="e.g. Lighthouse Realty"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
      </div>

      {initial ? (
        <p className="text-xs text-slate-400">
          Merge tag{' '}
          <span className="font-mono text-slate-500">{`{{custom_values.${initial.key}}}`}</span>{' '}
          stays the same when you rename.
        </p>
      ) : (
        <p className="text-xs text-slate-400">
          A merge tag is generated from the name (for example{' '}
          <span className="font-mono text-slate-500">{'{{custom_values.business_name}}'}</span>) and
          never changes after.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          {submitLabel}
        </Button>
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
