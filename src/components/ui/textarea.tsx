import type { Ref, TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

// React 19 ref-as-prop: an optional `ref` lets callers focus/measure the textarea
// (e.g. the assistant composer) without forwardRef. Every existing call site simply
// omits it.
export function Textarea({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
