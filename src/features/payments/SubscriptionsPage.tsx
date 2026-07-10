import { Ban, PauseCircle, PlayCircle, Plus, Repeat, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type Contact,
  type NewSubscription,
  type Product,
  type SubscriptionStatus,
  type SubscriptionSummary,
  type SubscriptionWithSchedule,
  api,
} from '../../lib/api'
import { cn, formatDateOnly, formatMoney, formatPhone } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { priceLabel } from './products-meta'
import { subscriptionAmountLabel, subscriptionStatusMeta } from './subscriptions-meta'

type SubFilter = SubscriptionStatus | 'all'

const EMPTY_SUMMARY: SubscriptionSummary = { active: 0, paused: 0, canceled: 0, mrr_cents: 0 }

interface SubscriptionDraft {
  productId: string
  contactId: string
  startedAt: string
}

/** A full date label for a started-on / renews-on line, e.g. "Jun 15, 2026".
 *  These are calendar dates (UTC midnight), so format tz-immune — see
 *  formatDateOnly — or an Arizona viewer reads each one a day early. */
function formatDate(iso: string | null): string {
  return formatDateOnly(iso)
}

/**
 * Subscriptions — the recurring-commitment ledger (the GHL "Payments →
 * Subscriptions" area). Each row records that a contact is on a recurring
 * arrangement; the schedule (next renewal) and the MRR are DERIVED server-side
 * from those rows, never stored. This module is bookkeeping only: starting,
 * pausing, resuming or canceling a subscription only changes OpenLevel's own
 * ledger — it never charges a card, sends an invoice, or moves money. A
 * subscription can only be started from a recurring catalog product, so its
 * amount and cadence are a snapshot the operator actually set.
 */
export function SubscriptionsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [subs, setSubs] = useState<SubscriptionWithSchedule[]>([])
  const [summary, setSummary] = useState<SubscriptionSummary>(EMPTY_SUMMARY)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [filter, setFilter] = useState<SubFilter>('active')
  const [creating, setCreating] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.subscriptions(loc)
    setSubs(r.subscriptions)
    setSummary(r.summary)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setCreating(false)
    setConfirm(null)
    Promise.all([api.subscriptions(loc), api.contacts(loc), api.products(loc)])
      .then(([s, c, p]) => {
        if (!active) return
        setSubs(s.subscriptions)
        setSummary(s.summary)
        setContacts(c.contacts)
        setProducts(p.products)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  // Only active recurring products can seed a new subscription — a one-time or
  // archived product has no live cadence to record.
  const recurringProducts = useMemo(
    () => products.filter((p) => p.type === 'recurring' && p.status === 'active'),
    [products],
  )

  const contactName = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c]))
    return (id: string | null): string | null => {
      if (!id) return null
      const c = byId.get(id)
      if (!c) return null
      return c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'
    }
  }, [contacts])

  async function start(draft: SubscriptionDraft) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      const input: NewSubscription = { productId: draft.productId }
      if (draft.contactId) input.contactId = draft.contactId
      if (draft.startedAt) input.startedAt = draft.startedAt
      await api.createSubscription(loc, input)
      setCreating(false)
      await refresh()
    } catch {
      setError('Could not start the subscription.')
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(id: string, next: SubscriptionStatus) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.updateSubscription(loc, id, { status: next })
      await refresh()
    } catch {
      setError('Could not update the subscription.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteSubscription(loc, id)
      setConfirm(null)
      await refresh()
    } catch {
      setError('Could not delete the subscription.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading') return <PageSpinner label="Loading subscriptions" />

  const visible = filter === 'all' ? subs : subs.filter((s) => s.status === filter)

  const FILTERS: { key: SubFilter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: summary.active },
    { key: 'paused', label: 'Paused', count: summary.paused },
    { key: 'canceled', label: 'Canceled', count: summary.canceled },
    { key: 'all', label: 'All', count: subs.length },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* KPI band — honest aggregates derived from the loaded subscription rows */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Kpi label="Active" value={String(summary.active)} sub="recurring" />
        <Kpi
          label="Monthly recurring"
          value={formatMoney(summary.mrr_cents)}
          sub="from active"
          accent
        />
        <Kpi label="Paused" value={String(summary.paused)} sub="on hold" />
        <Kpi label="Canceled" value={String(summary.canceled)} sub="ended" />
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Subscriptions</h1>
          <p className="text-xs text-slate-500">
            Recurring commitments your contacts are on. OpenLevel tracks the schedule and monthly
            total — it never charges a card or moves money.
          </p>
        </div>
        {!creating ? (
          <Button
            size="sm"
            onClick={() => {
              setCreating(true)
              setConfirm(null)
            }}
          >
            <Plus className="h-4 w-4" />
            New subscription
          </Button>
        ) : null}
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-3xl">
          {error ? <p className="mb-3 text-xs font-medium text-rose-600">{error}</p> : null}

          {creating ? (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">New subscription</h2>
              <SubscriptionForm
                products={recurringProducts}
                contacts={contacts}
                busy={busy}
                onSubmit={start}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : null}

          {subs.length === 0 && !creating ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <Repeat className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No subscriptions yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Start one from a recurring product to track a contact&rsquo;s ongoing plan and its
                monthly total — no card is ever charged.
              </p>
            </div>
          ) : subs.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        filter === f.key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      {f.label}
                      <span className="ml-1 tabular-nums text-slate-400">{f.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-slate-400">
                  {filter === 'active'
                    ? 'No active subscriptions — switch to All to see paused or canceled ones.'
                    : `No ${filter === 'all' ? '' : filter} subscriptions.`}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {visible.map((s) => (
                    <li key={s.id} className="px-4 py-3">
                      {confirm === s.id ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-rose-700">
                            Delete <span className="font-semibold">{s.name}</span>? This only removes
                            the record — no money is involved.
                          </span>
                          <div className="flex shrink-0 gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => void remove(s.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <SubscriptionRow
                          sub={s}
                          contactName={contactName(s.contact_id)}
                          busy={busy}
                          onPause={() => void changeStatus(s.id, 'paused')}
                          onResume={() => void changeStatus(s.id, 'active')}
                          onCancel={() => void changeStatus(s.id, 'canceled')}
                          onDelete={() => setConfirm(s.id)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** One subscription row: an icon tile, the snapshot name + status badge, the
 *  contact and start date, the amount-with-cadence, the next renewal for an active
 *  one, and lifecycle actions keyed to the current status. */
function SubscriptionRow({
  sub,
  contactName,
  busy,
  onPause,
  onResume,
  onCancel,
  onDelete,
}: {
  sub: SubscriptionWithSchedule
  contactName: string | null
  busy: boolean
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const meta = subscriptionStatusMeta(sub.status)
  const muted = sub.status === 'canceled'
  return (
    <div className="flex items-center justify-between gap-3">
      <div className={cn('flex min-w-0 items-center gap-3', muted && 'opacity-60')}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Repeat className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          {/* Badge wraps below name on mobile instead of squeezing the name */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-medium text-slate-900">{sub.name}</p>
            <Badge variant={meta.badge}>{meta.label}</Badge>
          </div>
          <p className="truncate text-xs text-slate-500">
            {/* Amount shown inline on mobile; hidden on desktop where the right column shows it */}
            <span
              className={cn(
                'lg:hidden font-semibold tabular-nums text-slate-700',
                muted && 'text-slate-400',
              )}
            >
              {subscriptionAmountLabel(sub)}{' '}
              <span className="font-normal text-slate-300">· </span>
            </span>
            {contactName ?? <span className="italic text-slate-400">No contact</span>}
            <span className="text-slate-300"> · </span>
            Started {formatDate(sub.started_at)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 lg:gap-3">
        <div className="hidden text-right lg:block">
          <p
            className={cn(
              'text-sm font-semibold tabular-nums text-slate-900',
              muted && 'text-slate-400',
            )}
          >
            {subscriptionAmountLabel(sub)}
          </p>
          {sub.status === 'active' && sub.next_renewal ? (
            <p className="text-xs text-slate-400">Renews {formatDate(sub.next_renewal)}</p>
          ) : sub.status === 'paused' ? (
            <p className="text-xs text-slate-400">Paused</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {sub.status === 'active' ? (
            <IconBtn title="Pause" onClick={onPause} disabled={busy}>
              <PauseCircle className="h-4 w-4" />
            </IconBtn>
          ) : null}
          {sub.status === 'paused' ? (
            <IconBtn title="Resume" onClick={onResume} disabled={busy}>
              <PlayCircle className="h-4 w-4" />
            </IconBtn>
          ) : null}
          {sub.status === 'canceled' ? (
            <IconBtn title="Reactivate" onClick={onResume} disabled={busy}>
              <RotateCcw className="h-4 w-4" />
            </IconBtn>
          ) : (
            <IconBtn title="Cancel" onClick={onCancel} disabled={busy}>
              <Ban className="h-4 w-4" />
            </IconBtn>
          )}
          <IconBtn title="Delete" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>
    </div>
  )
}

/**
 * The start form. A subscription must begin from an active recurring product, so
 * the picker only offers those; the amount and cadence come from whichever product
 * is chosen (shown as a read-only preview), never typed free-hand. Contact and
 * start date are optional — an omitted start date means it begins today.
 */
function SubscriptionForm({
  products,
  contacts,
  busy,
  onSubmit,
  onCancel,
}: {
  products: Product[]
  contacts: Contact[]
  busy: boolean
  onSubmit: (draft: SubscriptionDraft) => void
  onCancel: () => void
}) {
  const [productId, setProductId] = useState('')
  const [contactId, setContactId] = useState('')
  const [startedAt, setStartedAt] = useState('')

  const selected = products.find((p) => p.id === productId)
  const canSubmit = productId.length > 0 && !busy

  function submit() {
    if (!canSubmit) return
    onSubmit({ productId, contactId, startedAt })
  }

  if (products.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          You need an active recurring product first. Add one on the Products tab, then start a
          subscription from it.
        </p>
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <Label htmlFor="sub-product">Product</Label>
          <select
            id="sub-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {priceLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sub-contact">Contact (optional)</Label>
          <select
            id="sub-contact"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">No contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-44">
          <Label htmlFor="sub-start">Start date (optional)</Label>
          <Input
            id="sub-start"
            type="date"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />
        </div>
        {selected ? (
          <p className="text-sm text-slate-500">
            Records{' '}
            <span className="font-semibold text-slate-900">{priceLabel(selected)}</span> — no card
            is charged.
          </p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          Start subscription
        </Button>
      </div>
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
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          accent ? 'text-emerald-600' : 'text-slate-900',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}
