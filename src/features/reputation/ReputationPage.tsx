import { Plus, RefreshCw, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Avatar } from '../../components/ui/avatar'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type Contact,
  type Review,
  type ReviewRequest,
  type ReviewStats,
  type ReviewSyncResult,
  api,
} from '../../lib/api'
import { cn, formatPhone, relativeTime } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { RequestReviewDialog } from './RequestReviewDialog'
import { StarRating } from './StarRating'
import { RATING_BUCKETS, responseRate, sourceLabel } from './reputation-meta'

interface ReputationData {
  reviews: Review[]
  requests: ReviewRequest[]
  stats: ReviewStats
}

/**
 * Reputation — collect and manage customer reviews. A KPI band of real,
 * server-derived aggregates (average, totals, response rate), a feed of the
 * actual review rows with per-review moderation, and a sidebar with the rating
 * breakdown + pending asks. Every number comes from the stored reviews/requests;
 * nothing here invents a rating or a count. Hiding a review is moderation only —
 * it never changes the average, so the headline figure can't be inflated by
 * burying the bad ones.
 */
export function ReputationPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [data, setData] = useState<ReputationData | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [requesting, setRequesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState<ReviewSyncResult[] | null>(null)

  // Re-fetch reviews + requests (and the derived stats) without flashing the
  // spinner — used after generating a request so the sidebar/KPIs update.
  const refresh = useCallback(async () => {
    if (!loc) return
    const rev = await api.reviews(loc)
    setData({ reviews: rev.reviews, requests: rev.requests, stats: rev.stats })
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    Promise.all([api.reviews(loc), api.contacts(loc)])
      .then(([rev, con]) => {
        if (!active) return
        setData({ reviews: rev.reviews, requests: rev.requests, stats: rev.stats })
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
    return (id: string | null): string | null => {
      if (!id) return null
      const c = byId.get(id)
      if (!c) return null
      return c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'
    }
  }, [contacts])

  async function handleGenerate(contactId: string | null): Promise<string> {
    if (!loc) throw new Error('no location')
    const r = await api.requestReview(loc, contactId)
    await refresh()
    return `${window.location.origin}${r.link}`
  }

  // Mirror in the reviews customers left on the location's Google Business
  // Profile / Facebook Page. The per-source results render verbatim — an
  // unconnected platform shows its reason, never a fake zero-success.
  async function handleSync() {
    if (!loc || syncing) return
    setSyncing(true)
    setSyncResults(null)
    try {
      const r = await api.syncReviews(loc)
      setSyncResults(r.results)
      await refresh()
    } catch {
      setSyncResults([{ source: 'sync', ok: false, reason: 'request failed — try again' }])
    } finally {
      setSyncing(false)
    }
  }

  async function toggleStatus(r: Review) {
    if (!loc) return
    const next = r.status === 'hidden' ? 'published' : 'hidden'
    const res = await api.setReviewStatus(loc, r.id, next)
    setData((d) => (d ? { ...d, reviews: d.reviews.map((x) => (x.id === r.id ? res.review : x)) } : d))
  }

  if (status === 'loading' || !data) return <PageSpinner />

  const { reviews, requests, stats } = data
  const pending = requests.filter((r) => r.status === 'pending')
  const rr = responseRate(requests)
  const hidden = reviews.filter((r) => r.status === 'hidden').length
  const shown = stats.count - hidden

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Reputation</h1>
          <p className="text-xs text-slate-500">Collect and manage your customer reviews.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={syncing} onClick={() => void handleSync()}>
            <RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {syncing ? 'Syncing…' : 'Sync reviews'}
          </Button>
          <Button size="sm" onClick={() => setRequesting(true)}>
            <Plus className="h-4 w-4" />
            Request review
          </Button>
        </div>
      </header>

      {/* Per-source sync readout — exactly what each platform did, verbatim */}
      {syncResults && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-slate-50 px-5 py-2">
          {syncResults.map((r) => (
            <span key={r.source} className="inline-flex items-center gap-1.5 text-xs">
              <span className="font-medium text-slate-600">{sourceLabel(r.source)}:</span>
              {r.ok ? (
                <span className="text-emerald-600">
                  {r.imported} imported · {r.updated} updated
                </span>
              ) : (
                <span className="text-slate-500">{r.reason}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* KPI band — every figure derived from the real review/request rows */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <div className="bg-white px-5 py-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Average rating
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="text-xl font-bold tabular-nums text-slate-900">
              {stats.count ? stats.average.toFixed(1) : '—'}
            </p>
            <StarRating value={stats.average} size={15} />
          </div>
          <p className="text-xs text-slate-400">
            across {stats.count} review{stats.count === 1 ? '' : 's'}
          </p>
        </div>
        <Kpi
          label="Total reviews"
          value={String(stats.count)}
          sub={hidden > 0 ? `${shown} shown · ${hidden} hidden` : 'all published'}
        />
        <Kpi label="Awaiting response" value={String(pending.length)} sub="not yet answered" />
        <Kpi
          label="Response rate"
          value={`${rr.rate}%`}
          sub={`${rr.completed} of ${rr.total} answered`}
          accent
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Reviews feed */}
        <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
          {reviews.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <Star className="mx-auto h-9 w-9 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-600">No reviews yet</p>
                <p className="mt-1 text-sm text-slate-400">
                  Request a review from a happy customer to get started.
                </p>
                <Button className="mt-4" size="sm" onClick={() => setRequesting(true)}>
                  <Plus className="h-4 w-4" />
                  Request review
                </Button>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-3">
              {reviews.map((r) => (
                <ReviewCard
                  key={r.id}
                  review={r}
                  name={r.reviewer_name ?? contactName(r.contact_id) ?? 'Anonymous'}
                  onToggle={() => void toggleStatus(r)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar — rating breakdown + pending asks; full-width below feed on mobile, fixed-width panel on desktop */}
        <aside className="ol-scroll flex w-full shrink-0 flex-col gap-5 overflow-y-auto border-t border-slate-200 bg-white p-5 lg:w-80 lg:border-l lg:border-t-0">
          <section>
            <h3 className="text-sm font-semibold text-slate-900">Rating breakdown</h3>
            <div className="mt-3 space-y-2">
              {RATING_BUCKETS.map((bucket) => {
                const n = stats.distribution[bucket]
                const pct = stats.count ? (n / stats.count) * 100 : 0
                return (
                  <div key={bucket} className="flex items-center gap-2.5">
                    <span className="flex w-8 items-center justify-end gap-0.5 text-xs font-medium text-slate-500">
                      {bucket}
                      <Star className="h-3 w-3 fill-current text-amber-400" strokeWidth={0} />
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-5 text-right text-xs tabular-nums text-slate-500">{n}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-900">Awaiting response</h3>
            {pending.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">
                No pending requests. Ask a happy customer for a review.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {pending.map((rq) => {
                  const name = contactName(rq.contact_id)
                  return (
                    <li key={rq.id} className="flex items-center gap-2.5">
                      <Avatar name={name ?? 'Link'} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-700">
                          {name ?? 'Generic link'}
                        </p>
                        <p className="text-xs text-slate-400">Asked {relativeTime(rq.created_at)}</p>
                      </div>
                      <Badge variant="amber">Pending</Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {requesting && (
        <RequestReviewDialog
          contacts={contacts}
          onCancel={() => setRequesting(false)}
          onGenerate={handleGenerate}
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

function ReviewCard({
  review,
  name,
  onToggle,
}: {
  review: Review
  name: string
  onToggle: () => void
}) {
  const isHidden = review.status === 'hidden'
  return (
    <article
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-opacity',
        isHidden && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={name} size="sm" />
          <div>
            <p className="text-sm font-semibold text-slate-900">{name}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <StarRating value={review.rating} size={14} />
              <span className="text-xs text-slate-400">{relativeTime(review.created_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline">{sourceLabel(review.source)}</Badge>
          {isHidden && <Badge variant="slate">Hidden</Badge>}
        </div>
      </div>
      {review.body && (
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{review.body}</p>
      )}
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {isHidden ? 'Publish' : 'Hide'}
        </Button>
      </div>
    </article>
  )
}
