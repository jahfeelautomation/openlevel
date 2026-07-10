/**
 * Custom-field helpers: the field-type vocabulary, the label→key slugifier, and
 * a value coercer. Pure functions, no database — so they are cheap to unit-test
 * and safe to call from both the repo and the routes.
 */
import { slugifyKey } from './slug-key'

/** The input controls a custom field can render as. Stored as a plain text
 *  column so adding a type later needs no migration. */
export const CUSTOM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'dropdown',
  'checkbox',
] as const

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

/**
 * Slugify a human label into a stable jsonb key: lowercase, every run of
 * non-alphanumerics collapses to a single underscore, leading/trailing
 * underscores trimmed. Falls back to 'field' when nothing alphanumeric remains,
 * so the key is never empty. The key is computed once at creation and never
 * changes — relabeling a field leaves its stored values intact.
 */
export function customFieldKey(label: string): string {
  return slugifyKey(label, 'field')
}

/**
 * Coerce a raw value (from a JSON body or a form field) into the representation
 * stored in the contact's custom_fields jsonb. Returns null when the value is
 * empty/unset so the caller can remove the key rather than store a ghost. A
 * checkbox always resolves to a concrete boolean (it is either checked or not).
 */
export function coerceCustomFieldValue(
  type: string,
  raw: unknown,
): string | number | boolean | null {
  if (type === 'checkbox') {
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase()
      return s === 'true' || s === '1' || s === 'yes' || s === 'on'
    }
    return Boolean(raw)
  }
  if (raw === null || raw === undefined) return null
  if (type === 'number') {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    const s = String(raw).trim()
    if (s === '') return null // Number('') is 0, so reject empties before coercing
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  const s = String(raw).trim()
  return s === '' ? null : s
}
