import { Archive, DollarSign, Percent, Plus, RotateCcw, Ticket, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import {
  ApiError,
  type CouponStatus,
  type CouponSummary,
  type CouponWithRedeemable,
  type DiscountType,
  type NewCoupon,
  api,
} from '../../lib/api'
import { cn, formatDateOnly } from '../../lib/utils'
import { useTenant } from '../../state/location'
import {
  couponBlockReason,
  couponDiscountLabel,
  couponStatusMeta,
  couponUsageLabel,
} from './coupons-meta'

type CouponFilter = CouponStatus | 'all'

const EMPTY_SUMMARY: CouponSummary = { active: 0, redeemable: 0, redemptions: 0, archived: 0 }

interface CouponDraft {
  code: string
  discountType: DiscountType
  discountValue: number
  description: string
  maxRedemptions: number | null
  expiresAt: string | null
}

/** Parse a dollars-and-cents string to integer cents, ignoring stray text so the
 *  field never submits garbage (mirrors the catalog editor's inputToCents). */
function inputToCents(value: string): number {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

/** A full date label for an expiry line, e.g. "Sep 30, 2026". Expiry is a
 *  calendar date (UTC midnight), so format tz-immune — see formatDateOnly. */
function formatDate(iso: string | null): string {
  return formatDateOnly(iso)
}

/**
 * Coupons — the discount-code book (the GHL "Payments → Coupons" area). Each row
 * defines a reusable discount a later step can apply to an invoice's recorded
 * total. This module is bookkeeping only: defining, archiving, restoring or
 * deleting a coupon only changes the OpenLevel ledger — it never charges a card or
 * moves money. The "redeemable" state and every KPI total are DERIVED server-side
 * from the rows, so the usage figures can never overstate reality.
 */
export function CouponsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [coupons, setCoupons] = useState<CouponWithRedeemable[]>([])
  const [summary, setSummary] = useState<CouponSummary>(EMPTY_SUMMARY)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [filter, setFilter] = useState<CouponFilter>('active')
  const [creating, setCreating] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.coupons(loc)
    setCoupons(r.coupons)
    setSummary(r.summary)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setCreating(false)
    setConfirm(null)
    api
      .coupons(loc)
      .then((r) => {
        if (!active) return
        setCoupons(r.coupons)
        setSummary(r.summary)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function create(draft: CouponDraft) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      const input: NewCoupon = {
        code: draft.code,
        discountType: draft.discountType,
        discountValue: draft.discountValue,
      }
      if (draft.description) input.description = draft.description
      if (draft.maxRedemptions !== null) input.maxRedemptions = draft.maxRedemptions
      if (draft.expiresAt !== null) input.expiresAt = draft.expiresAt
      await api.createCoupon(loc, input)
      setCreating(false)
      await refresh()
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? 'A coupon with that code already exists. Pick a different code.'
          : 'Could not save the coupon.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(id: string, next: CouponStatus) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.updateCoupon(loc, id, { status: next })
      await refresh()
    } catch {
      setError('Could not update the coupon.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteCoupon(loc, id)
      setConfirm(null)
      await refresh()
    } catch {
      setError('Could not delete the coupon.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading') return <PageSpinner label="Loading coupons" />

  const visible = filter === 'all' ? coupons : coupons.filter((c) => c.status === filter)
  const nowISO = new Date().toISOString()

  const FILTERS: { key: CouponFilter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: summary.active },
    { key: 'archived', label: 'Archived', count: summary.archived },
    { key: 'all', label: 'All', count: coupons.length },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* KPI band — honest aggregates derived from the loaded coupon rows */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Kpi label="Active" value={String(summary.active)} sub="defined" />
        <Kpi label="Redeemable" value={String(summary.redeemable)} sub="usable now" accent />
        <Kpi label="Redemptions" value={String(summary.redemptions)} sub="times applied" />
        <Kpi label="Archived" value={String(summary.archived)} sub="retired" />
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Coupons</h1>
          <p className="text-xs text-slate-500">
            Reusable discount codes you can apply to an invoice total. OpenLevel defines and tracks
            them — it never charges a card or moves money.
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
            New coupon
          </Button>
        ) : null}
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-3xl">
          {error ? <p className="mb-3 text-xs font-medium text-rose-600">{error}</p> : null}

          {creating ? (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">New coupon</h2>
              <CouponForm busy={busy} onSubmit={create} onCancel={() => setCreating(false)} />
            </div>
          ) : null}

          {coupons.length === 0 && !creating ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <Ticket className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No coupons yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Define a discount code to apply to an invoice total later — no card is ever charged.
              </p>
            </div>
          ) : coupons.length > 0 ? (
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
                    ? 'No active coupons — switch to All to see archived ones.'
                    : `No ${filter === 'all' ? '' : filter} coupons.`}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {visible.map((c) => (
                    <li key={c.id} className="px-4 py-3">
                      {confirm === c.id ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="min-w-0 text-sm text-rose-700">
                            Delete <span className="font-semibold">{c.code}</span>? This only removes
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
                              onClick={() => void remove(c.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <CouponRow
                          coupon={c}
                          nowISO={nowISO}
                          busy={busy}
                          onArchive={() => void changeStatus(c.id, 'archived')}
                          onRestore={() => void changeStatus(c.id, 'active')}
                          onDelete={() => setConfirm(c.id)}
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

/** One coupon row: an icon tile, the code + status badge (with an honest "Expired"
 *  or "Limit reached" hint when an active code still cannot be redeemed), the
 *  description, the discount label, usage against any cap, the expiry, and the
 *  archive / restore / delete actions. */
function CouponRow({
  coupon,
  nowISO,
  busy,
  onArchive,
  onRestore,
  onDelete,
}: {
  coupon: CouponWithRedeemable
  nowISO: string
  busy: boolean
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const meta = couponStatusMeta(coupon.status)
  const blocked = couponBlockReason(coupon, nowISO)
  const muted = coupon.status === 'archived'
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
      <div className={cn('flex min-w-0 items-center gap-3', muted && 'opacity-60')}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Ticket className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-mono text-sm font-semibold tracking-wide text-slate-900">
              {coupon.code}
            </p>
            <Badge variant={meta.badge}>{meta.label}</Badge>
            {blocked ? <Badge variant="amber">{blocked}</Badge> : null}
          </div>
          <p className="truncate text-xs text-slate-500">
            {coupon.description ?? <span className="italic text-slate-400">No description</span>}
          </p>
        </div>
      </div>
      {/* discount value + usage + actions — row on desktop, row on mobile but left-aligned */}
      <div className="flex items-center justify-between gap-3 lg:shrink-0">
        <div className="lg:text-right">
          <p
            className={cn(
              'text-sm font-semibold tabular-nums text-slate-900',
              muted && 'text-slate-400',
            )}
          >
            {couponDiscountLabel(coupon)}
          </p>
          <p className="text-xs text-slate-400">
            {couponUsageLabel(coupon)}
            {coupon.expires_at ? (
              <>
                <span className="text-slate-300"> · </span>
                Expires {formatDate(coupon.expires_at)}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {coupon.status === 'active' ? (
            <IconBtn title="Archive" onClick={onArchive} disabled={busy}>
              <Archive className="h-4 w-4" />
            </IconBtn>
          ) : (
            <IconBtn title="Restore" onClick={onRestore} disabled={busy}>
              <RotateCcw className="h-4 w-4" />
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
 * The define form. A code plus a discount: choose percent or fixed, and the value
 * reads in the matching unit (a whole percent, or dollars for a fixed amount).
 * Description, a redemption cap and an expiry are all optional — left blank means
 * no description, unlimited redemptions, and no expiry. Nothing here charges a
 * card; it only defines a discount the operator can apply to an invoice later.
 */
function CouponForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean
  onSubmit: (draft: CouponDraft) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const [discountType, setDiscountType] = useState<DiscountType>('percent')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  // Percent reads as a whole 1..100; fixed reads as dollars and converts to cents.
  const numericValue =
    discountType === 'percent' ? Math.round(Number.parseFloat(value)) : inputToCents(value)
  const valueValid =
    discountType === 'percent'
      ? Number.isFinite(numericValue) && numericValue >= 1 && numericValue <= 100
      : numericValue > 0
  const canSubmit = code.trim().length > 0 && valueValid && !busy

  function submit() {
    if (!canSubmit) return
    onSubmit({
      code: code.trim(),
      discountType,
      discountValue: numericValue,
      description: description.trim(),
      maxRedemptions: maxRedemptions.trim() ? Math.max(1, Math.round(Number(maxRedemptions))) : null,
      expiresAt: expiresAt ? expiresAt : null,
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="coupon-code">Code</Label>
          <Input
            id="coupon-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SUMMER25"
            className="font-mono uppercase"
          />
        </div>
        <div>
          <Label htmlFor="coupon-type">Discount type</Label>
          <div className="inline-flex h-10 w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(['percent', 'fixed'] as DiscountType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDiscountType(t)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
                  discountType === t
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {t === 'percent' ? (
                  <Percent className="h-3.5 w-3.5" />
                ) : (
                  <DollarSign className="h-3.5 w-3.5" />
                )}
                {t === 'percent' ? 'Percent' : 'Fixed'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="coupon-value">
            {discountType === 'percent' ? 'Percent off' : 'Amount off (USD)'}
          </Label>
          <div className="relative">
            {discountType === 'fixed' ? (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                $
              </span>
            ) : null}
            <Input
              id="coupon-value"
              type="number"
              min={discountType === 'percent' ? '1' : '0'}
              max={discountType === 'percent' ? '100' : undefined}
              step={discountType === 'percent' ? '1' : '0.01'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={discountType === 'percent' ? '25' : '50.00'}
              className={cn(discountType === 'fixed' && 'pl-7', discountType === 'percent' && 'pr-8')}
            />
            {discountType === 'percent' ? (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                %
              </span>
            ) : null}
          </div>
        </div>
        <div>
          <Label htmlFor="coupon-max">Redemption limit (optional)</Label>
          <Input
            id="coupon-max"
            type="number"
            min="1"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder="Unlimited"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="coupon-desc">Description (optional)</Label>
          <Input
            id="coupon-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Summer sale"
          />
        </div>
        <div>
          <Label htmlFor="coupon-expiry">Expires (optional)</Label>
          <Input
            id="coupon-expiry"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="min-w-0 text-xs text-slate-400">
          Defines a discount you can apply to an invoice later — no card is charged.
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={submit}>
            Create coupon
          </Button>
        </div>
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
