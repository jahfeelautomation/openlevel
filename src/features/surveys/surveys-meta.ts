// Surveys reuse the funnel/forms label→field mapping: a field labeled "Email"
// becomes { name: 'email', type: 'email' } so the public capture route maps it
// onto the contact's identity. Re-exported so the surveys feature keeps its
// imports local while the mapping stays single-sourced in sites-meta.
import { fieldFromLabel } from '../sites/sites-meta'

export { fieldFromLabel }

/** The field types a survey question can be. Short text / Email / Phone are the
 *  identity-capture types the public route can map onto a contact; Long text and
 *  Dropdown are survey-specific answer shapes the multi-step renderer supports. */
export const FIELD_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
]

/** Types whose input shape is derived from the label, so re-typing a label may
 *  re-derive them. `textarea` and `select` are explicit operator choices and are
 *  never overwritten when the operator edits the label afterwards. */
export const LABEL_DERIVED_TYPES = new Set(['text', 'email', 'tel'])

/** Humanize a raw field key for a fallback label ("full_name" → "Full name"). */
export function humanizeField(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** A stable id for a freshly added step (React keys + the public renderer's
 *  per-step anchors). Browser-only code, so crypto.randomUUID is available with a
 *  cheap fallback. */
export function uid(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${rnd}`
}
