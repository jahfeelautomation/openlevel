import { Star } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * A read-only star row. Renders five stars and fills `Math.round(value)` of them
 * with the brand color, so a 4.5 shows as 5 filled by convention — purely a
 * display of the real rating it's handed; it never computes or invents a number.
 */
export function StarRating({
  value,
  size = 16,
  className,
}: {
  value: number
  size?: number
  className?: string
}) {
  const filled = Math.round(value)
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          width={size}
          height={size}
          className={n <= filled ? 'text-brand-500' : 'text-slate-300'}
          fill={n <= filled ? 'currentColor' : 'none'}
          strokeWidth={n <= filled ? 0 : 2}
        />
      ))}
    </span>
  )
}
