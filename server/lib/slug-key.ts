/**
 * Shared key helpers for operator-defined data that needs a stable, rename-proof
 * token: custom fields (per-contact jsonb keys) and custom values (location merge
 * tags). Both slugify a human label once at creation and keep the slug forever,
 * so a token already placed in a template never orphans when the label changes.
 * Pure functions, no database — cheap to unit-test and safe to call from repos
 * and routes alike.
 */

/**
 * Slugify a human label into a stable key: lowercase, every run of
 * non-alphanumerics collapses to a single underscore, leading/trailing
 * underscores trimmed. Returns `fallback` when nothing alphanumeric remains, so
 * the key is never empty.
 */
export function slugifyKey(label: string, fallback: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || fallback
}

/**
 * Make `base` unique within a location by appending _2, _3, … against the set of
 * keys already taken. A second field/value labelled the same as an existing one
 * gets `<base>_2` rather than colliding on the unique index.
 */
export function uniqueKey(base: string, taken: Set<string>): string {
  let key = base
  let n = 2
  while (taken.has(key)) {
    key = `${base}_${n}`
    n++
  }
  return key
}
