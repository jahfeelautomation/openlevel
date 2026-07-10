import { Archive, ArchiveRestore, Package, Pencil, Plus, Repeat, Tag, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { Textarea } from '../../components/ui/textarea'
import {
  type NewProduct,
  type Product,
  type ProductPatch,
  type RecurringInterval,
  api,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { INTERVAL_OPTIONS, priceLabel, statusMeta, typeMeta } from './products-meta'

type CatalogFilter = 'active' | 'archived' | 'all'

interface ProductDraft {
  name: string
  description: string
  priceCents: number
  type: 'one_time' | 'recurring'
  recurringInterval: RecurringInterval
}

/** Cents -> a plain dollars string for the price input ("25000" -> "250"). */
function centsToInput(cents: number): string {
  return String(cents / 100)
}

/** A typed dollars string -> integer cents, floored at zero. Non-numbers (blank,
 *  stray text) read as 0 rather than NaN so the field never submits garbage. */
function inputToCents(value: string): number {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

function draftFromProduct(p: Product): ProductDraft {
  return {
    name: p.name,
    description: p.description ?? '',
    priceCents: p.price_cents,
    type: p.type,
    recurringInterval: p.recurring_interval ?? 'month',
  }
}

/** Shared mapping a form draft -> the create/patch body. The billing interval is
 *  only sent for a recurring product; for one-time the server clears any stale
 *  cadence on its own, so we leave it off. */
function draftToBody(d: ProductDraft): NewProduct & ProductPatch {
  const body: NewProduct & ProductPatch = {
    name: d.name,
    description: d.description,
    priceCents: d.priceCents,
    type: d.type,
  }
  if (d.type === 'recurring') body.recurringInterval = d.recurringInterval
  return body
}

/**
 * Products — the reusable product/service catalog (the GHL "Payments → Products"
 * area). Each item is a saved name, price, and billing cadence an invoice or
 * proposal can be built from instead of retyping. Editing the catalog only
 * changes stored text and amounts; it never sends anything or moves money, and
 * because a document copies its lines at build time, archiving or deleting a
 * product never disturbs a document already created from it. Archived items stay
 * for history but drop out of the active picker.
 */
export function ProductsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [products, setProducts] = useState<Product[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [filter, setFilter] = useState<CatalogFilter>('active')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.products(loc)
    setProducts(r.products)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setCreating(false)
    setEditing(null)
    setConfirm(null)
    api
      .products(loc)
      .then((r) => {
        if (!active) return
        setProducts(r.products)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function create(draft: ProductDraft) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.createProduct(loc, draftToBody(draft))
      setCreating(false)
      await refresh()
    } catch {
      setError('Could not add the product.')
    } finally {
      setBusy(false)
    }
  }

  async function save(id: string, draft: ProductDraft) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.updateProduct(loc, id, draftToBody(draft))
      setEditing(null)
      await refresh()
    } catch {
      setError('Could not save the product.')
    } finally {
      setBusy(false)
    }
  }

  async function setArchived(id: string, archived: boolean) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.updateProduct(loc, id, { status: archived ? 'archived' : 'active' })
      await refresh()
    } catch {
      setError('Could not update the product.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteProduct(loc, id)
      setConfirm(null)
      await refresh()
    } catch {
      setError('Could not delete the product.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading') return <PageSpinner label="Loading products" />

  const activeCount = products.filter((p) => p.status === 'active').length
  const archivedCount = products.length - activeCount
  const visible =
    filter === 'all' ? products : products.filter((p) => p.status === filter)

  const FILTERS: { key: CatalogFilter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'archived', label: 'Archived', count: archivedCount },
    { key: 'all', label: 'All', count: products.length },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Products</h1>
          <p className="text-xs text-slate-500">
            Your saved services and prices. Build an invoice or proposal from one instead of
            retyping — this catalog never sends anything or moves money.
          </p>
        </div>
        {!creating ? (
          <Button
            size="sm"
            onClick={() => {
              setCreating(true)
              setEditing(null)
              setConfirm(null)
            }}
          >
            <Plus className="h-4 w-4" />
            New product
          </Button>
        ) : null}
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-3xl">
          {error ? <p className="mb-3 text-xs font-medium text-rose-600">{error}</p> : null}

          {creating ? (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">New product</h2>
              <ProductForm
                submitLabel="Add product"
                busy={busy}
                onSubmit={create}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : null}

          {products.length === 0 && !creating ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <Package className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No products yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Add a service or package — its name, price, and billing cadence — then reuse it on
                any invoice or proposal.
              </p>
            </div>
          ) : products.length > 0 ? (
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
                  {filter === 'archived'
                    ? 'No archived products.'
                    : 'No active products — switch to All to see archived items.'}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {visible.map((p) => (
                    <li key={p.id} className="px-4 py-3">
                      {editing === p.id ? (
                        <ProductForm
                          submitLabel="Save"
                          busy={busy}
                          initial={draftFromProduct(p)}
                          onSubmit={(d) => void save(p.id, d)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : confirm === p.id ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-rose-700">
                            Delete <span className="font-semibold">{p.name}</span>? Invoices already
                            built from it keep their copied lines.
                          </span>
                          <div className="flex shrink-0 gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => void remove(p.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <ProductRow
                          product={p}
                          onEdit={() => {
                            setEditing(p.id)
                            setConfirm(null)
                          }}
                          onArchiveToggle={() => void setArchived(p.id, p.status === 'active')}
                          onDelete={() => {
                            setConfirm(p.id)
                            setEditing(null)
                          }}
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

/** One catalog row: an icon tile keyed to the billing type, the name + optional
 *  description, type/archived badges, the price label, and row actions. */
function ProductRow({
  product,
  onEdit,
  onArchiveToggle,
  onDelete,
}: {
  product: Product
  onEdit: () => void
  onArchiveToggle: () => void
  onDelete: () => void
}) {
  const archived = product.status === 'archived'
  const type = typeMeta(product)
  const recurring = product.type === 'recurring'
  return (
    <div className="flex items-center justify-between gap-3">
      <div className={cn('flex min-w-0 items-center gap-3', archived && 'opacity-60')}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          {recurring ? <Repeat className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          {/* On mobile the badges wrap below the name; on desktop they sit inline */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-medium text-slate-900">{product.name}</p>
            <Badge variant={type.badge}>{type.label}</Badge>
            {archived ? (
              <Badge variant={statusMeta('archived').badge}>{statusMeta('archived').label}</Badge>
            ) : null}
          </div>
          {/* Price shown inline on desktop; on mobile it drops to this second line */}
          <p className="truncate text-xs text-slate-500">
            <span
              className={cn(
                'lg:hidden font-semibold tabular-nums text-slate-700',
                archived && 'text-slate-400',
              )}
            >
              {priceLabel(product)}{' '}
              <span className="font-normal text-slate-300">· </span>
            </span>
            {product.description?.trim() ? (
              product.description
            ) : (
              <span className="italic text-slate-400">No description</span>
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 lg:gap-3">
        <span
          className={cn(
            'hidden text-sm font-semibold tabular-nums text-slate-900 lg:inline',
            archived && 'text-slate-400',
          )}
        >
          {priceLabel(product)}
        </span>
        <div className="flex items-center gap-1">
          <IconBtn title="Edit" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </IconBtn>
          <IconBtn title={archived ? 'Restore' : 'Archive'} onClick={onArchiveToggle}>
            {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </IconBtn>
          <IconBtn title="Delete" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>
    </div>
  )
}

/**
 * The shared create/edit form. A one-time product reads as a single price; a
 * recurring one adds a billing interval. Switching back to one-time hides the
 * interval, and the server drops any stored cadence to match, so a price label
 * never shows a stray "/mo" after the change.
 */
function ProductForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: ProductDraft
  submitLabel: string
  busy: boolean
  onSubmit: (draft: ProductDraft) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [price, setPrice] = useState(initial ? centsToInput(initial.priceCents) : '')
  const [type, setType] = useState<'one_time' | 'recurring'>(initial?.type ?? 'one_time')
  const [interval, setInterval] = useState<RecurringInterval>(initial?.recurringInterval ?? 'month')

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && !busy

  function submit() {
    if (!canSubmit) return
    onSubmit({
      name: trimmedName,
      description: description.trim(),
      priceCents: inputToCents(price),
      type,
      recurringInterval: interval,
    })
  }

  // Enter submits from the single-line fields; Escape always cancels. The
  // description textarea keeps Enter for newlines (handled separately).
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Label htmlFor="prod-name">Name</Label>
          <Input
            id="prod-name"
            value={name}
            autoFocus
            placeholder="e.g. Property Inspection"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div>
          <Label htmlFor="prod-price">Price</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              $
            </span>
            <Input
              id="prod-price"
              className="pl-7 tabular-nums"
              inputMode="decimal"
              value={price}
              placeholder="0.00"
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={onKey}
            />
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="prod-desc">Description</Label>
        <Textarea
          id="prod-desc"
          rows={2}
          value={description}
          placeholder="Optional — what the customer is paying for"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label>Billing</Label>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(['one_time', 'recurring'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  type === t
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {t === 'one_time' ? 'One-time' : 'Recurring'}
              </button>
            ))}
          </div>
        </div>

        {type === 'recurring' ? (
          <div className="w-44">
            <Label htmlFor="prod-interval">Interval</Label>
            <select
              id="prod-interval"
              value={interval}
              onChange={(e) => setInterval(e.target.value as RecurringInterval)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
    >
      {children}
    </button>
  )
}
