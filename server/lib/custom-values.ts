/**
 * Custom-value vocabulary: the merge-tag namespace, the name→key slugifier, and
 * the token builder. Custom values are location-level constants (business name,
 * booking link, support phone) referenced in templates and automations as
 * {{custom_values.<key>}}. The renderer that actually substitutes them lives in
 * merge-fields.ts alongside the contact tokens; this module only owns the naming
 * so the repo, routes, and UI agree on one spelling. Pure functions, no database.
 */
import { slugifyKey } from './slug-key'

/** The namespace that distinguishes a custom-value token from a flat contact
 *  token. `{{custom_values.business_name}}` resolves here; `{{first_name}}`
 *  resolves against the contact. */
export const CUSTOM_VALUES_NAMESPACE = 'custom_values'

/**
 * Slugify a custom-value name into its stable merge key. Same rules as a custom
 * field, with a 'value' fallback so an all-symbol name still yields a usable key
 * rather than an empty one. Computed once at creation and never changed.
 */
export function customValueKey(name: string): string {
  return slugifyKey(name, 'value')
}

/** The literal token an author inserts for a custom value, e.g.
 *  "{{custom_values.business_name}}". The single spelling the insert menu and
 *  the renderer both rely on. */
export function customValueToken(key: string): string {
  return `{{${CUSTOM_VALUES_NAMESPACE}.${key}}}`
}
