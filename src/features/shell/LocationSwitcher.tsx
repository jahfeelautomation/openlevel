import { Building2, Check, ChevronsUpDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'

/** Sub-account (location) switcher that lives at the top of the sidebar — the
 *  GHL "agency → sub-account" selector. One location per SIAS client. */
export function LocationSwitcher() {
  const { current, locations, setCurrentId } = useTenant()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg bg-slate-800/80 px-3 py-2.5 text-left transition-colors hover:bg-slate-700/80"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white">
          <Building2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">
            {current?.name ?? 'No location'}
          </span>
          <span className="block truncate text-xs text-slate-400">Sub-account</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {locations.map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => {
                setCurrentId(loc.id)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <span className="flex-1 truncate">{loc.name}</span>
              {current?.id === loc.id ? <Check className="h-4 w-4 text-brand-600" /> : null}
            </button>
          ))}
          {locations.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">No locations</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
