import {
  Bot,
  FileText,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import { ApiError, type CallRow, type CallStats, type Contact, api } from '../../lib/api'
import { cn, formatPhone, relativeTime } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { PlaceCallDialog } from './PlaceCallDialog'

function formatDuration(seconds: number | null): string {
  if (typeof seconds !== 'number') return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function statusBadge(status: string) {
  if (status === 'completed') return <Badge variant="green">Completed</Badge>
  if (status === 'no-answer' || status === 'busy' || status === 'failed') {
    return <Badge variant="rose">{status === 'no-answer' ? 'No answer' : status}</Badge>
  }
  return <Badge variant="amber">{status}</Badge>
}

/**
 * The call log (Module 52). Click-to-call rings the contact through this
 * location's OWN provider (their Twilio number or Vapi assistant); the rows and
 * KPIs below mirror exactly what the provider reported back through the
 * verified webhook — durations, transcripts and summaries are theirs, never
 * invented here. Placing a call is an operator action only: the AI conversation
 * agent has no tool that reaches this.
 */
export function CallsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [calls, setCalls] = useState<CallRow[]>([])
  const [stats, setStats] = useState<CallStats | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [dialing, setDialing] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'refused'; text: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const res = await api.calls(loc)
    setCalls(res.calls)
    setStats(res.stats)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setNotice(null)
    Promise.all([api.calls(loc), api.contacts(loc)])
      .then(([res, con]) => {
        if (!active) return
        setCalls(res.calls)
        setStats(res.stats)
        setContacts(con.contacts)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  const contactName = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c]))
    return (id: string | null) => {
      if (!id) return null
      const c = byId.get(id)
      return c ? (c.name ?? formatPhone(c.phones[0]) ?? null) : null
    }
  }, [contacts])

  async function handlePlaceCall(contactId: string) {
    if (!loc) return
    try {
      const res = await api.placeCall(loc, contactId)
      setNotice({
        kind: 'ok',
        text: `Calling ${contactName(contactId) ?? 'contact'} — ${res.call.provider} accepted the call.`,
      })
      await refresh()
    } catch (err) {
      // 409/422/502 carry the honest refusal reason — show it verbatim.
      setNotice({
        kind: 'refused',
        text: err instanceof ApiError ? err.message : 'Could not place the call.',
      })
    } finally {
      setDialing(false)
    }
  }

  if (!loc || status === 'loading' || !stats) return <PageSpinner label="Loading calls" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Calls</h1>
          <p className="text-xs text-slate-500">
            Click-to-call and the AI voice agent, on this sub-account's own provider.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialing(true)}>
          <Phone className="h-4 w-4" />
          Place call
        </Button>
      </header>

      {notice && (
        <div
          className={cn(
            'border-b px-5 py-2 text-xs font-medium',
            notice.kind === 'ok'
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
              : 'border-amber-100 bg-amber-50 text-amber-700',
          )}
        >
          {notice.text}
        </div>
      )}

      {/* KPI band — every figure derived from the real call rows */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Kpi
          label="Total calls"
          value={String(stats.total)}
          sub={`${stats.outbound} outbound · ${stats.inbound} inbound`}
        />
        <Kpi label="Completed" value={String(stats.completed)} sub="connected and finished" />
        <Kpi
          label="Connect rate"
          value={`${stats.connectedRate}%`}
          sub="completed of all calls"
          accent
        />
        <Kpi
          label="Avg duration"
          value={formatDuration(stats.avgDurationSeconds)}
          sub="across timed calls"
        />
      </div>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
        {calls.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Phone className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No calls yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Connect a voice provider in Settings, then place your first call.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setDialing(true)}>
                <Phone className="h-4 w-4" />
                Place call
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {calls.map((call) => (
              <CallCard
                key={call.id}
                call={call}
                name={contactName(call.contact_id)}
                expanded={expanded === call.id}
                onToggle={() => setExpanded(expanded === call.id ? null : call.id)}
              />
            ))}
          </div>
        )}
      </div>

      {dialing && (
        <PlaceCallDialog
          contacts={contacts}
          onCancel={() => setDialing(false)}
          onCall={handlePlaceCall}
        />
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <div className="bg-white px-5 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-xl font-bold tabular-nums', accent ? 'text-emerald-600' : 'text-slate-900')}>
        {value}
      </p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}

function CallCard({
  call,
  name,
  expanded,
  onToggle,
}: {
  call: CallRow
  name: string | null
  expanded: boolean
  onToggle: () => void
}) {
  const inbound = call.direction === 'inbound'
  const missed = call.status === 'no-answer' || call.status === 'busy' || call.status === 'failed'
  const DirectionIcon = missed ? PhoneMissed : inbound ? PhoneIncoming : PhoneOutgoing
  const otherNumber = inbound ? call.from_number : call.to_number
  const hasDetail = Boolean(call.transcript || call.summary)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            missed ? 'bg-rose-50 text-rose-500' : 'bg-brand-50 text-brand-600',
          )}
        >
          <DirectionIcon className="h-[18px] w-[18px]" />
        </span>
        {/* min-w floor keeps the name readable: when the line gets tighter than
            this, the status/details group wraps below instead of crushing it */}
        <div className="min-w-[9rem] flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 truncate text-sm font-medium text-slate-800">
              {name ?? formatPhone(otherNumber) ?? 'Unknown number'}
            </p>
            {call.provider === 'vapi' ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700"
                title="Handled by the AI voice agent"
              >
                <Bot className="h-3 w-3" />
                AI agent
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-400">
            {inbound ? 'Inbound' : 'Outbound'} · {relativeTime(call.created_at)} ·{' '}
            {formatDuration(call.duration_seconds)}
          </p>
        </div>
        {/* badge + details button stay on the same line on lg; wrap below the name on mobile */}
        <div className="flex shrink-0 items-center gap-2">
          {statusBadge(call.status)}
          {hasDetail ? (
            <Button size="sm" variant="outline" onClick={onToggle}>
              <FileText className="h-4 w-4" />
              {expanded ? 'Hide' : 'Details'}
            </Button>
          ) : null}
        </div>
      </div>

      {expanded && hasDetail ? (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {call.summary ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Summary
              </p>
              <p className="mt-1 text-sm text-slate-700">{call.summary}</p>
            </div>
          ) : null}
          {call.transcript ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Transcript
              </p>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-600">
                {call.transcript}
              </pre>
            </div>
          ) : null}
          {call.recording_url ? (
            <p className="text-xs text-slate-400">
              Recording:{' '}
              <a
                href={call.recording_url}
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 underline"
              >
                listen
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
