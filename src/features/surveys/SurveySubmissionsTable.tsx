import { Inbox } from 'lucide-react'
import type { Survey, SurveySubmission } from '../../lib/api'
import { relativeTime } from '../../lib/utils'
import { humanizeField } from './surveys-meta'

/** Column order: the survey's declared fields first (flattened across steps, in
 *  order), then any extra keys that appear in stored submissions but aren't
 *  current fields — so the table shows exactly what was captured, nothing
 *  invented, nothing hidden. Only keys present in at least one submission show. */
function deriveColumns(
  survey: Survey,
  submissions: SurveySubmission[],
): { key: string; label: string }[] {
  const present = new Set<string>()
  for (const s of submissions) for (const k of Object.keys(s.values)) present.add(k)

  const ordered: { key: string; label: string }[] = []
  const seen = new Set<string>()
  for (const step of survey.content.steps ?? []) {
    for (const f of step.fields ?? []) {
      if (present.has(f.name) && !seen.has(f.name)) {
        ordered.push({ key: f.name, label: f.label || humanizeField(f.name) })
        seen.add(f.name)
      }
    }
  }
  for (const k of present) {
    if (!seen.has(k)) {
      ordered.push({ key: k, label: humanizeField(k) })
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
 * The stored submissions for one survey — the real answer rows the public
 * capture route persisted across every step. The counter beside the tab and this
 * table are the same honest data; an unanswered survey is an honest zero.
 */
export function SurveySubmissionsTable({
  survey,
  submissions,
}: {
  survey: Survey
  submissions: SurveySubmission[]
}) {
  if (submissions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
        <div>
          <Inbox className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">No submissions yet</p>
          <p className="mt-1 text-sm text-slate-400">
            When someone completes this survey, their answers land here.
          </p>
        </div>
      </div>
    )
  }

  const columns = deriveColumns(survey, submissions)

  return (
    <div className="mx-auto w-full max-w-5xl">
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
