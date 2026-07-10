import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-slate-400', className)} />
}

/** Centered spinner for full-pane loading states. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-slate-400">
      <Spinner className="h-6 w-6" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  )
}
