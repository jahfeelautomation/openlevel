// Web mirror of server/lib/merge-fields.ts. The frontend can't import from
// server/, so the merge-field vocabulary and the renderer live here in lockstep
// with the backend — letting the editor show a live preview with no round-trip.
// Keep this in sync with merge-fields.ts (the merge-fields.test.ts MERGE_FIELDS
// test guards the backend half).

import type { TemplateChannel } from '../../lib/api'

export interface MergeField {
  token: string
  label: string
}

/** The merge tokens renderTemplate() substitutes — the insert-menu vocabulary. */
export const MERGE_FIELDS: readonly MergeField[] = [
  { token: '{{first_name}}', label: 'First name' },
  { token: '{{last_name}}', label: 'Last name' },
  { token: '{{name}}', label: 'Full name' },
]

export interface MergeContact {
  first_name: string | null
  last_name: string | null
  name: string | null
}

/**
 * A stand-in contact the editor previews against, so an author sees what a real
 * send looks like ("Hi Derek," rather than "Hi {{first_name}},"). Picked to match
 * a seeded contact so the preview feels like live data.
 */
export const SAMPLE_CONTACT: MergeContact = {
  first_name: 'Derek',
  last_name: 'Sull',
  name: 'Derek Sull',
}

/** Mirror of server renderTemplate(): substitute known contact tokens and the
 *  location's {{custom_values.<key>}} constants, leave unknown ones verbatim, and
 *  tidy the spacing a blanked token leaves behind. Keep in lockstep with
 *  server/lib/merge-fields.ts. */
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

  const substituted = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, rawKey: string) => {
    const key = rawKey.toLowerCase()
    const dot = key.indexOf('.')
    if (dot !== -1) {
      if (key.slice(0, dot) !== 'custom_values') return match // unknown namespace
      const vKey = key.slice(dot + 1)
      return vKey in customValues ? customValues[vKey]! : match // unknown value -> as-is
    }
    return key in values ? values[key]! : match
  })

  return substituted
    .replace(/ {2,}/g, ' ') // collapse runs left by a blanked token
    .replace(/\s+([,.!?;:])/g, '$1') // drop a space stranded before punctuation
    .trim()
}

export function channelLabel(channel: string): string {
  return channel === 'sms' ? 'SMS' : 'Email'
}

export const TEMPLATE_CHANNELS: TemplateChannel[] = ['email', 'sms']
