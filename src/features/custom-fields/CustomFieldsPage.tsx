import {
  Calendar,
  CheckSquare,
  Hash,
  List,
  Pencil,
  Plus,
  SlidersHorizontal,
  TextCursorInput,
  Trash2,
  Type,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { Textarea } from '../../components/ui/textarea'
import { type CustomField, api } from '../../lib/api'
import { useTenant } from '../../state/location'

type FieldType = CustomField['type']

const TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
]

const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Text',
  textarea: 'Paragraph',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  checkbox: 'Checkbox',
}

const TYPE_ICON: Record<FieldType, typeof Type> = {
  text: Type,
  textarea: TextCursorInput,
  number: Hash,
  date: Calendar,
  dropdown: List,
  checkbox: CheckSquare,
}

interface FieldDraft {
  label: string
  type: FieldType
  options: string[]
  placeholder: string | null
}

/**
 * Custom Fields — the location-wide custom-field manager (the GHL "Custom Fields"
 * settings area). A field is a definition (label + type + options) with a stable,
 * auto-slugged key; the per-contact value lives in contacts.custom_fields under
 * that key. The key never changes once created, so relabeling a field leaves the
 * values already stored on contacts intact. Deleting a field also clears its value
 * from every contact. Editing here only shapes the form — it never sends anything
 * or moves money.
 */
export function CustomFieldsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [fields, setFields] = useState<CustomField[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.customFields(loc)
    setFields(r.fields)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setCreating(false)
    setEditing(null)
    setConfirm(null)
    api
      .customFields(loc)
      .then((r) => {
        if (!active) return
        setFields(r.fields)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function create(draft: FieldDraft) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.createCustomField(loc, draft)
      setCreating(false)
      await refresh()
    } catch {
      setError('Could not add the field.')
    } finally {
      setBusy(false)
    }
  }

  async function save(id: string, draft: FieldDraft) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.updateCustomField(loc, id, draft)
      setEditing(null)
      await refresh()
    } catch {
      setError('Could not save the field.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteCustomField(loc, id)
      setConfirm(null)
      await refresh()
    } catch {
      setError('Could not delete the field.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading') return <PageSpinner label="Loading custom fields" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Custom Fields</h1>
          <p className="text-xs text-slate-500">
            Extra fields on every contact — a dropdown, a date, a number. You decide the shape;
            each contact carries its own value.
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
            Add field
          </Button>
        ) : null}
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-2xl">
          {error ? <p className="mb-3 text-xs font-medium text-rose-600">{error}</p> : null}

          {creating ? (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">New custom field</h2>
              <FieldForm
                submitLabel="Add field"
                busy={busy}
                onSubmit={create}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : null}

          {fields.length === 0 && !creating ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <SlidersHorizontal className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No custom fields yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Add a field to capture something extra on every contact — lead source, budget,
                property type, whatever you track.
              </p>
            </div>
          ) : fields.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-2.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {fields.length} {fields.length === 1 ? 'field' : 'fields'}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {fields.map((f) => {
                  const Icon = TYPE_ICON[f.type]
                  return (
                    <li key={f.id} className="px-4 py-3">
                      {editing === f.id ? (
                        <FieldForm
                          submitLabel="Save"
                          busy={busy}
                          initial={f}
                          lockType
                          onSubmit={(d) => void save(f.id, d)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : confirm === f.id ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="min-w-0 text-sm text-rose-700">
                            Delete <span className="font-semibold">{f.label}</span>? Its value is
                            cleared from every contact.
                          </span>
                          <div className="flex shrink-0 gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => void remove(f.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">
                                {f.label}
                              </p>
                              <p className="truncate text-xs text-slate-400">
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">
                                  {TYPE_LABEL[f.type]}
                                </span>{' '}
                                <span className="font-mono">{f.key}</span>
                                {f.type === 'dropdown' && f.options.length > 0
                                  ? ` · ${f.options.join(', ')}`
                                  : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <IconBtn
                              title="Edit"
                              onClick={() => {
                                setEditing(f.id)
                                setConfirm(null)
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn
                              title="Delete"
                              onClick={() => {
                                setConfirm(f.id)
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
 * The shared create/edit form. On edit, `lockType` is set because the field's
 * key is derived from its first label and its stored values assume the current
 * type — so the type is shown read-only there to keep contact values coherent.
 */
function FieldForm({
  initial,
  submitLabel,
  busy,
  lockType,
  onSubmit,
  onCancel,
}: {
  initial?: Pick<CustomField, 'label' | 'type' | 'options' | 'placeholder'>
  submitLabel: string
  busy: boolean
  lockType?: boolean
  onSubmit: (draft: FieldDraft) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [type, setType] = useState<FieldType>(initial?.type ?? 'text')
  const [optionsText, setOptionsText] = useState((initial?.options ?? []).join('\n'))
  const [placeholder, setPlaceholder] = useState(initial?.placeholder ?? '')

  const showOptions = type === 'dropdown'
  const showPlaceholder =
    type === 'text' || type === 'textarea' || type === 'number' || type === 'date'
  const trimmed = label.trim()
  const options = optionsText
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean)
  const canSubmit = trimmed.length > 0 && (!showOptions || options.length > 0) && !busy

  function submit() {
    if (!canSubmit) return
    onSubmit({
      label: trimmed,
      type,
      options: showOptions ? options : [],
      placeholder: showPlaceholder && placeholder.trim() ? placeholder.trim() : null,
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <Label htmlFor="cf-label">Label</Label>
          <Input
            id="cf-label"
            value={label}
            autoFocus
            placeholder="e.g. Lead Source"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !showOptions) {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div>
          <Label htmlFor="cf-type">Type</Label>
          {lockType ? (
            <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
              {TYPE_LABEL[type]}
            </div>
          ) : (
            <select
              id="cf-type"
              value={type}
              onChange={(e) => setType(e.target.value as FieldType)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {showOptions ? (
        <div>
          <Label htmlFor="cf-options">Options</Label>
          <Textarea
            id="cf-options"
            rows={4}
            value={optionsText}
            placeholder={'One per line\nWebsite\nReferral\nWalk-in'}
            onChange={(e) => setOptionsText(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">One option per line.</p>
        </div>
      ) : null}

      {showPlaceholder ? (
        <div>
          <Label htmlFor="cf-placeholder">Placeholder (optional)</Label>
          <Input
            id="cf-placeholder"
            value={placeholder}
            placeholder="Hint text shown in the empty field"
            onChange={(e) => setPlaceholder(e.target.value)}
          />
        </div>
      ) : null}

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
