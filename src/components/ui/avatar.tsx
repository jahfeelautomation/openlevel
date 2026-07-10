import { cn, initials } from '../../lib/utils'

const COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-brand-500',
  'bg-violet-500',
  'bg-fuchsia-500',
]

function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length] ?? 'bg-slate-500'
}

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
}

/** Initials avatar with a deterministic color derived from the name. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        colorFor(name ?? '?'),
        SIZES[size],
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  )
}
