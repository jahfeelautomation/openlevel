// Tiny merge-field renderer for automation message bodies. Supports the handful
// of contact tokens GHL users reach for first; unknown tokens are left verbatim
// (never invented) so a typo is visible rather than silently blanked. When a
// known token resolves empty, the surrounding spacing is tidied so a missing
// first name never produces "Hi  ," in an outgoing message.

export interface MergeContact {
  first_name: string | null
  last_name: string | null
  name: string | null
}

export interface MergeField {
  /** The literal token an author types/inserts, e.g. "{{first_name}}". */
  token: string
  /** Human label for the insert menu, e.g. "First name". */
  label: string
}

/**
 * The merge tokens renderTemplate() is guaranteed to substitute. This is the
 * single source the UI reads for its "insert merge field" menu, so we never
 * advertise a token the renderer would leave verbatim. (`{{full_name}}` is also
 * accepted as an alias of `{{name}}` but isn't listed separately — it would be a
 * redundant choice in the menu.)
 */
export const MERGE_FIELDS: readonly MergeField[] = [
  { token: '{{first_name}}', label: 'First name' },
  { token: '{{last_name}}', label: 'Last name' },
  { token: '{{name}}', label: 'Full name' },
]

/**
 * Render a template body. Contact tokens ({{first_name}}, {{name}}, …) resolve
 * against `contact`; location merge tags ({{custom_values.<key>}}) resolve
 * against `customValues`, a key→value map the caller supplies for the location.
 * Unknown tokens in either namespace are left verbatim (never invented) so a typo
 * is visible rather than silently blanked, and the spacing around a token that
 * resolves empty is tidied so a missing value never leaves "Hi  ,".
 */
export function renderTemplate(
  body: string,
  contact: MergeContact | null,
  customValues: Record<string, string> = {},
): string {
  const values: Record<string, string> = {
    first_name: contact?.first_name ?? '',
    last_name: contact?.last_name ?? '',
    name: contact?.name ?? '',
    full_name: contact?.name ?? '',
  }

  // [\w.] so a dotted custom-value token is captured in the same pass; before
  // this the dot broke the match and the token fell through to "leave as-is",
  // which is still the outcome for any custom value the caller did not supply.
  const substituted = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, rawKey: string) => {
    const key = rawKey.toLowerCase()
    const dot = key.indexOf('.')
    if (dot !== -1) {
      if (key.slice(0, dot) !== 'custom_values') return match // unknown namespace
      const vKey = key.slice(dot + 1)
      return vKey in customValues ? customValues[vKey]! : match // unknown value -> as-is
    }
    return key in values ? values[key]! : match // unknown contact token -> as-is
  })

  return substituted
    .replace(/ {2,}/g, ' ') // collapse runs left by a blanked token
    .replace(/\s+([,.!?;:])/g, '$1') // drop a space stranded before punctuation
    .trim()
}
