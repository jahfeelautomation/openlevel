import {
  BarChart3,
  CalendarDays,
  DollarSign,
  type LucideIcon,
  Send,
  Target,
  Trophy,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { PageSpinner } from '../../components/ui/spinner'
import { type ReportingStage, type ReportingSummary, api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { useTenant } from '../../state/location'

interface Kpi {
  key: string
  label: string
  icon: LucideIcon
  tile: string
  value: string | number
  sub: string
}

export function ReportingPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [summary, setSummary] = useState<ReportingSummary | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    api
      .reporting(loc)
      .then((r) => {
        if (!active) return
        setSummary(r.summary)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  if (!loc) return <Empty message="Select a sub-account to view the dashboard." />
  if (status === 'loading') return <PageSpinner />
  if (!summary) return <Empty message="Couldn't load the dashboard right now." />

  const kpis: Kpi[] = [
    {
      key: 'contacts',
      label: 'Contacts',
      icon: Users,
      tile: 'bg-brand-50 text-brand-600',
      value: summary.contacts,
      sub: 'Total contacts',
    },
    {
      key: 'open-opps',
      label: 'Open deals',
      icon: Target,
      tile: 'bg-sky-50 text-sky-600',
      value: summary.openOpportunities.count,
      sub: 'Open in pipeline',
    },
    {
      key: 'open-value',
      label: 'Pipeline value',
      icon: DollarSign,
      tile: 'bg-emerald-50 text-emerald-600',
      value: formatMoney(summary.openOpportunities.valueCents),
      sub: 'Open deal value',
    },
    {
      key: 'won-value',
      label: 'Won value',
      icon: Trophy,
      tile: 'bg-amber-50 text-amber-600',
      value: formatMoney(summary.wonOpportunities.valueCents),
      sub: `${summary.wonOpportunities.count} closed won`,
    },
    {
      key: 'appointments',
      label: 'Appointments',
      icon: CalendarDays,
      tile: 'bg-violet-50 text-violet-600',
      value: summary.upcomingAppointments,
      sub: 'Scheduled ahead',
    },
    {
      key: 'messages',
      label: 'Messages sent',
      icon: Send,
      tile: 'bg-rose-50 text-rose-600',
      value: summary.messagesSent,
      sub: `${summary.campaignsSent} ${summary.campaignsSent === 1 ? 'campaign' : 'campaigns'} sent`,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-3.5">
        <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
        <p className="text-xs text-slate-500">Snapshot of {current?.name ?? 'this sub-account'}</p>
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-6 py-5">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {kpis.map((k) => (
              <KpiCard key={k.key} kpi={k} />
            ))}
          </div>

          {summary.pipeline ? (
            <PipelineFunnel
              name={summary.pipeline.name}
              stages={summary.pipeline.stages}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
              <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-900">No pipeline yet</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Add a pipeline in Opportunities to see your deal funnel here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${kpi.tile}`}>
          <Icon className="h-5 w-5" />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {kpi.label}
        </p>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{kpi.value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{kpi.sub}</p>
    </div>
  )
}

function PipelineFunnel({ name, stages }: { name: string; stages: ReportingStage[] }) {
  const totalDeals = stages.reduce((n, s) => n + s.count, 0)
  const totalValue = stages.reduce((n, s) => n + s.valueCents, 0)
  const maxValue = Math.max(0, ...stages.map((s) => s.valueCents))

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{name}</h2>
          <p className="text-xs text-slate-500">Deals by stage</p>
        </div>
        <Badge variant="slate">
          {totalDeals} {totalDeals === 1 ? 'deal' : 'deals'} · {formatMoney(totalValue)}
        </Badge>
      </div>
      <div className="space-y-4 px-5 py-4">
        {stages.map((stage) => (
          <StageBar key={stage.id} stage={stage} maxValue={maxValue} />
        ))}
      </div>
    </div>
  )
}

function StageBar({ stage, maxValue }: { stage: ReportingStage; maxValue: number }) {
  const pct = maxValue > 0 ? Math.round((stage.valueCents / maxValue) * 100) : 0
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="flex items-baseline gap-2">
          <span className="font-medium text-slate-800">{stage.name}</span>
          <span className="text-xs text-slate-400">
            {stage.count} {stage.count === 1 ? 'deal' : 'deals'}
          </span>
        </span>
        <span className="font-medium text-slate-900">{formatMoney(stage.valueCents)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
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
