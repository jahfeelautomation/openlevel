import { ChevronDown, Package } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type Product, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { priceLabel } from './products-meta'

/**
 * A small dropdown that lists the tenant's ACTIVE catalog products and reports
 * the chosen one through `onPick`. It lets an invoice or proposal line item be
 * filled from a saved service instead of retyping its name and price. Products
 * load lazily on first open and archived items are never offered — you do not
 * bill from a retired product. Picking only copies the product into a new line:
 * nothing is sent and no money moves.
 */
export function CatalogPicker({
  onPick,
  label = 'Add from catalog',
}: {
  onPick: (product: Product) => void
  label?: string
}) {
  const { current } = useTenant()
  const loc = current?.id
  const [open, setOpen] = useState(false)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [loading, setLoading] = useState(false)
  const loadedFor = useRef<string | null>(null)

  // Lazy-load the active catalog the first time the menu opens for a location.
  useEffect(() => {
    if (!open || !loc) return
    if (loadedFor.current === loc && products) return
    let active = true
    setLoading(true)
    api
      .products(loc)
      .then((r) => {
        if (!active) return
        setProducts(r.products.filter((p) => p.status === 'active'))
        loadedFor.current = loc
      })
      .catch(() => active && setProducts([]))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, loc, products])

  // Escape closes the menu, matching the rest of the app's overlays.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function choose(p: Product) {
    onPick(p)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-brand-50 hover:text-brand-600 hover:ring-brand-200"
      >
        <Package className="h-3.5 w-3.5" />
        {label}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          {/* Click-away backdrop — closes the menu without stealing focus styling. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {loading ? (
              <p className="px-3 py-3 text-center text-xs text-slate-400">Loading catalog…</p>
            ) : !products || products.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-slate-400">
                No active products to add.
              </p>
            ) : (
              products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choose(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">
                    {p.name}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">
                    {priceLabel(p)}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
