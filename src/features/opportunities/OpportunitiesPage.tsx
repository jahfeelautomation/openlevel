import { Plus } from 'lucide-react'
import { type DragEvent, useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import { type Contact, type NewOpportunity, type Opportunity, type Pipeline, api } from '../../lib/api'
import { cn, formatMoney } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { NewOpportunityDialog } from './NewOpportunityDialog'
import { OpportunityCard } from './OpportunityCard'

export function OpportunitiesPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [pipelineId, setPipelineId] = useState<string>('')
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [contactsById, setContactsById] = useState<Record<string, Contact>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const [dialogStageId, setDialogStageId] = useState<string | null>(null)

  // Load pipelines + contacts when the sub-account changes.
  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    Promise.all([api.pipelines(loc), api.contacts(loc)])
      .then(([p, c]) => {
        if (!active) return
        setPipelines(p.pipelines)
        setContactsById(Object.fromEntries(c.contacts.map((x) => [x.id, x])))
        setPipelineId((prev) => prev || p.pipelines[0]?.id || '')
        setStatus(p.pipelines.length > 0 ? 'ready' : 'empty')
      })
      .catch(() => active && setStatus('empty'))
    return () => {
      active = false
    }
  }, [loc])

  // Load opportunities whenever the selected pipeline changes.
  useEffect(() => {
    if (!loc || !pipelineId) return
    let active = true
    api
      .opportunities(loc, pipelineId)
      .then((r) => active && setOpps(r.opportunities))
      .catch(() => active && setOpps([]))
    return () => {
      active = false
    }
  }, [loc, pipelineId])

  const pipeline = pipelines.find((p) => p.id === pipelineId)
  const stages = pipeline?.stages ?? []

  const reloadOpps = async () => {
    if (!loc || !pipelineId) return
    const r = await api.opportunities(loc, pipelineId)
    setOpps(r.opportunities)
  }

  const nameFor = (opp: Opportunity) =>
    opp.contact_id ? (contactsById[opp.contact_id]?.name ?? undefined) : undefined

  const openValue = useMemo(
    () => opps.filter((o) => o.status === 'open').reduce((sum, o) => sum + o.value_cents, 0),
    [opps],
  )

  function onDrop(e: DragEvent, stageId: string) {
    e.preventDefault()
    setDragOverStage(null)
    const id = e.dataTransfer.getData('text/plain')
    const opp = opps.find((o) => o.id === id)
    if (!loc || !opp || opp.stage_id === stageId) return
    setOpps((prev) => prev.map((o) => (o.id === id ? { ...o, stage_id: stageId } : o))) // optimistic
    api.moveOpportunity(loc, id, stageId).catch(() => void reloadOpps())
  }

  function setStatusOf(id: string, next: 'won' | 'lost') {
    if (!loc) return
    setOpps((prev) => prev.map((o) => (o.id === id ? { ...o, status: next } : o)))
    api.setOpportunityStatus(loc, id, next).catch(() => void reloadOpps())
  }

  async function createOpp(input: Omit<NewOpportunity, 'pipelineId'>) {
    if (!loc || !pipelineId) return
    await api.createOpportunity(loc, { pipelineId, ...input })
    setDialogStageId(null)
    await reloadOpps()
  }

  if (!loc) return <Empty message="Select a sub-account to view opportunities." />
  if (status === 'loading') return <PageSpinner />
  if (status === 'empty' || !pipeline) return <Empty message="No pipelines yet." />

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* flex-wrap: on narrow screens the action cluster wraps below the title */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3.5 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900">Opportunities</h1>
          <p className="min-w-0 truncate text-xs text-slate-500">
            {opps.length} {opps.length === 1 ? 'opportunity' : 'opportunities'} ·{' '}
            {formatMoney(openValue)} open
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pipelines.length > 1 && (
            <select
              value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-sm focus:outline-none"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" onClick={() => setDialogStageId(stages[0]?.id ?? '')}>
            <Plus className="h-4 w-4" />
            Add opportunity
          </Button>
        </div>
      </header>

      {/* overflow-x-auto + shrink-0 lanes = kanban scrolls horizontally on all viewports */}
      <div className="ol-scroll min-h-0 flex-1 overflow-x-auto bg-slate-50 p-4">
        <div className="flex h-full min-h-[400px] gap-4">
          {stages.map((stage) => {
            const cards = opps.filter((o) => o.stage_id === stage.id)
            const colValue = cards
              .filter((o) => o.status !== 'lost' && o.status !== 'abandoned')
              .reduce((sum, o) => sum + o.value_cents, 0)
            const over = dragOverStage === stage.id
            return (
              <div key={stage.id} className="flex w-72 shrink-0 flex-col">
                <div className="mb-2 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">{stage.name}</span>
                    <span className="rounded-full bg-slate-200 px-1.5 text-[11px] font-medium text-slate-600">
                      {cards.length}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-slate-400">{formatMoney(colValue)}</span>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOverStage(stage.id)
                  }}
                  onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
                  onDrop={(e) => onDrop(e, stage.id)}
                  className={cn(
                    'ol-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border-2 border-dashed border-transparent bg-slate-100/70 p-2 transition-colors',
                    over && 'border-brand-300 bg-brand-50',
                  )}
                >
                  {cards.map((opp) => (
                    <OpportunityCard
                      key={opp.id}
                      opp={opp}
                      contactName={nameFor(opp)}
                      onDragStart={() => setDragOverStage(null)}
                      onWon={(id) => setStatusOf(id, 'won')}
                      onLost={(id) => setStatusOf(id, 'lost')}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setDialogStageId(stage.id)}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {dialogStageId !== null && (
        <NewOpportunityDialog
          stages={stages}
          contacts={Object.values(contactsById)}
          defaultStageId={dialogStageId || (stages[0]?.id ?? '')}
          onCancel={() => setDialogStageId(null)}
          onCreate={createOpp}
        />
      )}
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-xs text-sm text-slate-400">{message}</p>
    </div>
  )
}
