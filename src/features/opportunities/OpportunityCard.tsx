import { Badge } from '../../components/ui/badge'
import type { Opportunity } from '../../lib/api'
import { cn, formatMoney } from '../../lib/utils'

/** One draggable deal card on the kanban board. */
export function OpportunityCard({
  opp,
  contactName,
  onDragStart,
  onWon,
  onLost,
}: {
  opp: Opportunity
  contactName?: string
  onDragStart: (id: string) => void
  onWon: (id: string) => void
  onLost: (id: string) => void
}) {
  const closed = opp.status === 'won' || opp.status === 'lost'
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', opp.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(opp.id)
      }}
      className={cn(
        'group cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing',
        closed && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight text-slate-900">{opp.name}</p>
        {opp.status === 'won' && <Badge variant="green">Won</Badge>}
        {opp.status === 'lost' && <Badge variant="slate">Lost</Badge>}
      </div>
      {contactName && <p className="mt-1 truncate text-xs text-slate-500">{contactName}</p>}
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">{formatMoney(opp.value_cents)}</span>
        {!closed && (
          // On touch (no-hover) devices the buttons are always visible; on pointer devices they appear on hover.
          <div className="flex gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onWon(opp.id)}
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              Won
            </button>
            <button
              type="button"
              onClick={() => onLost(opp.id)}
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
            >
              Lost
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
