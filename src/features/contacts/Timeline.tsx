import { ArrowDownLeft, ArrowUpRight, Circle, Sparkles } from 'lucide-react'
import type { TimelineEvent } from '../../lib/api'
import { relativeTime } from '../../lib/utils'

function eventVisual(ev: TimelineEvent) {
  const direction = (ev.payload as { direction?: string }).direction
  if (ev.type === 'agent_draft') {
    return { icon: Sparkles, tint: 'text-brand-600 bg-brand-50', label: 'AI draft' }
  }
  if (ev.type === 'message' && direction === 'inbound') {
    return { icon: ArrowDownLeft, tint: 'text-emerald-600 bg-emerald-50', label: 'Inbound' }
  }
  if (ev.type === 'message' && direction === 'outbound') {
    return { icon: ArrowUpRight, tint: 'text-brand-600 bg-brand-50', label: 'Outbound' }
  }
  return { icon: Circle, tint: 'text-slate-500 bg-slate-100', label: ev.type }
}

/** Vertical activity feed for a contact (newest first, as the API returns it). */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="px-1 py-6 text-sm text-slate-400">No activity yet.</p>
  }
  return (
    <ol className="relative space-y-1">
      {events.map((ev, i) => {
        const { icon: Icon, tint, label } = eventVisual(ev)
        const body = (ev.payload as { body?: string }).body
        const last = i === events.length - 1
        return (
          <li key={ev.id} className="relative flex gap-3 pb-4">
            {!last ? <span className="absolute left-[15px] top-8 bottom-0 w-px bg-slate-200" /> : null}
            <span
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tint}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-700">{label}</span>
                <span className="text-xs text-slate-400">{relativeTime(ev.occurred_at)}</span>
              </div>
              {body ? <p className="mt-0.5 text-sm text-slate-600">{body}</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
