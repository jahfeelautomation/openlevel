import { Inbox } from 'lucide-react'
import type { Form, FormSubmission } from '../../lib/api'
import { relativeTime } from '../../lib/utils'

/** Humanize a raw field key for a column header when the form has no matching
 *  field label (e.g. "full_name" → "Full name"). */
function humanize(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Column order: the form's declared fields first (in their order), then any
 *  extra keys that appear in stored submissions but aren't current fields —
 *  so the table shows exactly what was captured, nothing invented, nothing
 *  hidden. Only keys that actually appear in at least one submission are shown. */
function deriveColumns(form: Form, submissions: FormSubmission[]): { key: string; label: string }[] {
  const present = new Set<string>()
  for (const s of submissions) for (const k of Object.keys(s.values)) present.add(k)

  const ordered: { key: string; label: string }[] = []
  const seen = new Set<string>()
  for (const f of form.content.fields ?? []) {
    if (present.has(f.name) && !seen.has(f.name)) {
      ordered.push({ key: f.name, label: f.label || humanize(f.name) })
      seen.add(f.name)
    }
  }
  for (const k of present) {
    if (!seen.has(k)) {
      ordered.push({ key: k, label: humanize(k) })
      seen.add(k)
    }
  }
  return ordered
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/**
 * The stored submissions for one form — the capability that distinguishes a
 * form from a funnel step (which only counts). Reads back the real rows the
 * public capture route persisted; the counter and this table are the same
 * honest data.
 */
export function SubmissionsTable({
  form,
  submissions,
}: {
  form: Form
  submissions: FormSubmission[]
}) {
  if (submissions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
        <div>
          <Inbox className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">No submissions yet</p>
          <p className="mt-1 text-sm text-slate-400">
            When someone fills out this form, their answers land here.
          </p>
        </div>
      </div>
    )
  }

  const columns = deriveColumns(form, submissions)

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="ol-scroll overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {col.label}
                  </th>
                ))}
                <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 align-top text-slate-700">
                      {cellText(s.values[col.key]) || <span className="text-slate-300">—</span>}
                    </td>
                  ))}
                  <td
                    className="whitespace-nowrap px-4 py-3 text-right align-top text-xs text-slate-400"
                    title={new Date(s.created_at).toLocaleString()}
                  >
                    {relativeTime(s.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
