import { Check, Clock, History, Minus, X } from 'lucide-react'
import type { WorkflowRun, WorkflowRunStep } from '../../lib/api'
import { cn } from '../../lib/utils'

/** Map a contact id to a display name; falls back to "No contact". */
export type ContactNameLookup = (contactId: string | null) => string

const RUN_STATUS: Record<string, { label: string; dot: string; text: string; chip: string }> = {
  completed: { label: 'Completed', dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50' },
  waiting: { label: 'Waiting', dot: 'bg-amber-500', text: 'text-amber-700', chip: 'bg-amber-50' },
  running: { label: 'Running', dot: 'bg-blue-500', text: 'text-blue-700', chip: 'bg-blue-50' },
  failed: { label: 'Failed', dot: 'bg-rose-500', text: 'text-rose-700', chip: 'bg-rose-50' },
}

function runStatusMeta(status: string) {
  return RUN_STATUS[status] ?? { label: status, dot: 'bg-slate-400', text: 'text-slate-600', chip: 'bg-slate-100' }
}

const fmtTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function StepIcon({ status }: { status: WorkflowRunStep['status'] }) {
  const map = {
    done: { Icon: Check, cls: 'bg-emerald-100 text-emerald-600' },
    skipped: { Icon: Minus, cls: 'bg-slate-100 text-slate-400' },
    waiting: { Icon: Clock, cls: 'bg-amber-100 text-amber-600' },
    failed: { Icon: X, cls: 'bg-rose-100 text-rose-600' },
  } as const
  const { Icon, cls } = map[status] ?? map.skipped
  return (
    <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', cls)}>
      <Icon className="h-3 w-3" />
    </span>
  )
}

function RunCard({ run, contactName }: { run: WorkflowRun; contactName: ContactNameLookup }) {
  const meta = runStatusMeta(run.status)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
          <span className="truncate text-sm font-medium text-slate-800">
            {contactName(run.contact_id)}
          </span>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            meta.chip,
            meta.text,
          )}
        >
          {meta.label}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{fmtTime(run.started_at)}</p>

      <ul className="mt-2.5 space-y-1.5">
        {run.steps.length === 0 ? (
          <li className="text-[11px] text-slate-400">No steps ran.</li>
        ) : (
          run.steps.map((step, i) => (
            <li key={`${run.id}-${i}`} className="flex items-start gap-2">
              <StepIcon status={step.status} />
              <span className="text-xs leading-5 text-slate-600">{step.detail}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

/**
 * Right rail: the real execution history for the selected workflow. Each card is
 * one run — who it ran for, when, its status, and exactly what each step did
 * (applied a tag, logged an SMS, waited). Honest by construction: it only renders
 * what the engine actually recorded in workflow_runs.
 */
export function RunsRail({
  runs,
  loading,
  contactName,
}: {
  runs: WorkflowRun[]
  loading: boolean
  contactName: ContactNameLookup
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-slate-200 bg-slate-50 lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3.5">
        <History className="h-4 w-4 text-slate-400" />
        <p className="text-sm font-semibold text-slate-700">Recent runs</p>
        {runs.length > 0 && (
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {runs.length}
          </span>
        )}
      </div>

      <div className="ol-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {loading ? (
          <p className="px-2 py-6 text-center text-xs text-slate-400">Loading runs…</p>
        ) : runs.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <History className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-2 text-xs font-medium text-slate-500">No runs yet</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Use “Test run” to push a contact through and watch each step execute.
            </p>
          </div>
        ) : (
          runs.map((run) => <RunCard key={run.id} run={run} contactName={contactName} />)
        )}
      </div>
    </aside>
  )
}
