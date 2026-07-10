import { Check, Loader2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { type CustomField, api } from '../../lib/api'

/**
 * The contact-record Custom Fields editor. Lists the location's field definitions
 * and the contact's value for each, editing in place: text/number/date inputs save
 * on blur, dropdowns and checkboxes save on change. The value is coerced server-side
 * by the field's declared type, and clearing one (empty, or the blank dropdown
 * choice) removes it. If the location has defined no custom fields, the whole
 * section stays hidden rather than showing an empty shell. Nothing here sends a
 * message or moves money — it only records data on the contact.
 */
export function ContactCustomFields({
  locationId,
  contactId,
  initialValues,
}: {
  locationId: string
  contactId: string
  initialValues: Record<string, unknown>
}) {
  const [fields, setFields] = useState<CustomField[]>([])
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Pull the field definitions; seed the editable values from the contact record.
  useEffect(() => {
    let active = true
    api
      .customFields(locationId)
      .then((r) => {
        if (!active) return
        setFields(r.fields)
        const seed: Record<string, string | boolean> = {}
        for (const f of r.fields) seed[f.key] = toEditable(f.type, initialValues[f.key])
        setValues(seed)
      })
      .catch(() => {
        /* the section is additive; a load failure just leaves it hidden */
      })
    return () => {
      active = false
    }
  }, [locationId, initialValues])

  async function persist(field: CustomField, next: string | boolean) {
    setValues((v) => ({ ...v, [field.key]: next }))
    setSavingKey(field.key)
    setSavedKey(null)
    setError(null)
    const payload = toPayload(field.type, next)
    try {
      await api.setContactCustomField(locationId, contactId, field.key, payload)
      setSavedKey(field.key)
    } catch {
      setError(`Could not save ${field.label}.`)
    } finally {
      setSavingKey(null)
    }
  }

  if (fields.length === 0) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
      <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        <SlidersHorizontal className="h-4 w-4" />
        Custom Fields
      </div>

      <div className="space-y-3">
        {fields.map((f) => {
          const value = values[f.key]
          return (
            <div key={f.id}>
              <div className="mb-1 flex items-center gap-1.5">
                <label htmlFor={`cf-${f.id}`} className="text-xs font-medium text-slate-600">
                  {f.label}
                </label>
                {savingKey === f.key ? (
                  <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                ) : savedKey === f.key ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : null}
              </div>
              <FieldInput
                id={`cf-${f.id}`}
                field={f}
                value={value ?? (f.type === 'checkbox' ? false : '')}
                onCommit={(next) => void persist(f, next)}
              />
            </div>
          )
        })}
      </div>

      {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  )
}

/** Renders the right control for the field type. Text-like inputs hold a local
 *  draft and commit on blur/Enter; dropdown and checkbox commit immediately. */
function FieldInput({
  id,
  field,
  value,
  onCommit,
}: {
  id: string
  field: CustomField
  value: string | boolean
  onCommit: (next: string | boolean) => void
}) {
  const [draft, setDraft] = useState(typeof value === 'string' ? value : '')

  // Keep the local draft aligned when the committed value changes (e.g. after a
  // save round-trip or a contact switch).
  useEffect(() => {
    if (typeof value === 'string') setDraft(value)
  }, [value])

  if (field.type === 'checkbox') {
    const checked = value === true
    return (
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onCommit(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
        />
        {checked ? 'Yes' : 'No'}
      </label>
    )
  }

  if (field.type === 'dropdown') {
    return (
      <select
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onCommit(e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      >
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }

  if (field.type === 'textarea') {
    return (
      <Textarea
        id={id}
        rows={3}
        value={draft}
        placeholder={field.placeholder ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
      />
    )
  }

  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'
  return (
    <Input
      id={id}
      type={inputType}
      value={draft}
      placeholder={field.placeholder ?? ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** A stored value (jsonb, so anything) into the editable form for its type. */
function toEditable(type: CustomField['type'], raw: unknown): string | boolean {
  if (type === 'checkbox') return raw === true || raw === 'true'
  if (raw === null || raw === undefined) return ''
  return String(raw)
}

/** The editable form back into the payload the value endpoint coerces. An empty
 *  text value clears the field (null); a checkbox is always a boolean. */
function toPayload(type: CustomField['type'], next: string | boolean): string | boolean | null {
  if (type === 'checkbox') return Boolean(next)
  const s = String(next).trim()
  return s === '' ? null : s
}
