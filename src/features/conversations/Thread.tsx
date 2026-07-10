import { Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Message } from '../../lib/api'
import { cn, relativeTime } from '../../lib/utils'

function Bubble({ message }: { message: Message }) {
  const outbound = message.direction === 'outbound'
  const isAgent = message.author_type === 'agent'
  const isDraft = message.status === 'draft'

  return (
    <div className={cn('flex w-full', outbound ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[72%]', outbound ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm shadow-sm',
            outbound
              ? isDraft
                ? 'border border-dashed border-brand-400 bg-brand-50 text-brand-900'
                : 'bg-brand-600 text-white'
              : 'border border-slate-200 bg-white text-slate-800',
          )}
        >
          {message.body}
        </div>
        <div
          className={cn(
            'mt-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-400',
            outbound ? 'justify-end' : 'justify-start',
          )}
        >
          {isAgent ? (
            <span className="inline-flex items-center gap-0.5 font-medium text-brand-600">
              <Sparkles className="h-3 w-3" /> AI
            </span>
          ) : null}
          {isDraft ? <span className="font-medium text-brand-600">Draft</span> : null}
          <span>{relativeTime(message.created_at)}</span>
        </div>
      </div>
    </div>
  )
}

/** The message transcript for one conversation, auto-scrolled to the latest. */
export function Thread({ messages }: { messages: Message[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  return (
    <div className="ol-scroll min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-6 py-5">
      {messages.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No messages yet.</p>
      ) : (
        messages.map((m) => <Bubble key={m.id} message={m} />)
      )}
      <div ref={endRef} />
    </div>
  )
}
