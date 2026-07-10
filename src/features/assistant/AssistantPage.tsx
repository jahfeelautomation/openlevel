import { Check, Sparkles, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Spinner } from '../../components/ui/spinner'
import { Textarea } from '../../components/ui/textarea'
import { ApiError, type AssistantTurn, type ProposedAction, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'

/**
 * The AI front door — a plain-English chat with an assistant that reads across the
 * whole location and answers, grounding everything in real CRM data. In approve-first
 * mode (slice 2) it can also PREPARE small changes — book an appointment, tag a
 * contact, add a task, move or set a deal — but it never performs one on its own: it
 * hands back a proposal and the operator taps Confirm. It never messages a customer
 * and never touches money (no such tool exists). The page owns the running history;
 * each send posts that history plus the new message, renders the reply, and shows a
 * confirm card for anything the assistant prepared.
 */

// A chat turn as the page holds it: the wire turn ({role, content}) plus, on an
// assistant turn, any changes the assistant prepared this round. `turns` is
// append-only, so a turn's index is a stable key for its proposals' resolution.
type ChatTurn = AssistantTurn & { proposals?: ProposedAction[] }

// Where a single proposal stands. Absent from the map = untouched (Confirm/Skip
// still showing). 'error' keeps the card actionable so the operator can retry.
type Resolution = { status: 'confirming' | 'done' | 'skipped' | 'error'; error?: string }

// Starter prompts for the empty state — mostly look-ups, plus one prepare-a-change
// example so the approve-first capability is advertised honestly.
const EXAMPLES = [
  'How many open tasks do I have right now?',
  'What appointments are coming up this week?',
  'List my open deals and what they are worth.',
  'Add a follow-up task for one of my contacts.',
]

export function AssistantPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [turns, setTurns] = useState<ChatTurn[]>([])
  // Keyed by `${turnIndex}-${proposalIndex}` — stable because turns only ever append.
  const [resolved, setResolved] = useState<Record<string, Resolution>>({})
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Keep the latest turn (and the thinking row) in view as the chat grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, sending])

  // Return focus to the composer once a reply lands, so the operator can keep typing.
  useEffect(() => {
    if (!sending) inputRef.current?.focus()
  }, [sending])

  async function send(text: string) {
    const message = text.trim()
    if (!message || !loc || sending) return

    // Snapshot the history BEFORE this message, stripped to the wire shape — the
    // server appends the message itself as the final turn (so it must not already
    // be in the array), and proposals are page-only state, never sent back.
    const history = turns.map(({ role, content }) => ({ role, content }))
    setTurns((prev) => [...prev, { role: 'operator', content: message }])
    setInput('')
    setError(null)
    setSending(true)
    try {
      const { reply, proposals } = await api.assistantSend(loc, history, message)
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: reply, proposals: proposals.length ? proposals : undefined },
      ])
    } catch (err) {
      // Leave the operator's message in place so they can simply retry. 501 means
      // the assistant isn't switched on for this location yet — say so plainly.
      const notConfigured = err instanceof ApiError && err.status === 501
      setError(
        notConfigured
          ? "The assistant isn't switched on for this account yet."
          : err instanceof Error
            ? err.message
            : 'Something went wrong reaching the assistant.',
      )
    } finally {
      setSending(false)
    }
  }

  // Perform one prepared change. This is the ONLY place the page writes to the CRM,
  // and only ever in response to the operator tapping Confirm. On success we record
  // the proposal as done AND drop the result line into the chat as an assistant turn,
  // so the conversation reads naturally. On failure we keep the card actionable.
  async function confirm(key: string, p: ProposedAction) {
    if (!loc) return
    setResolved((r) => ({ ...r, [key]: { status: 'confirming' } }))
    try {
      const { message } = await api.assistantConfirm(loc, p.verb, p.params)
      setResolved((r) => ({ ...r, [key]: { status: 'done' } }))
      setTurns((prev) => [...prev, { role: 'assistant', content: message }])
    } catch (err) {
      setResolved((r) => ({
        ...r,
        [key]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'That change could not be completed.',
        },
      }))
    }
  }

  function skip(key: string) {
    setResolved((r) => ({ ...r, [key]: { status: 'skipped' } }))
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline (standard chat behavior).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const empty = turns.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h1 className="text-base font-semibold text-slate-900">Assistant</h1>
            <p className="text-xs text-slate-500">
              Ask in plain English — I look things up and prepare changes for your OK.
            </p>
          </div>
        </div>
        {!empty ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTurns([])
              setResolved({})
              setError(null)
              inputRef.current?.focus()
            }}
          >
            New chat
          </Button>
        ) : null}
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {empty ? (
            <EmptyState onPick={(p) => void send(p)} disabled={!loc || sending} />
          ) : (
            turns.map((turn, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Bubble role={turn.role} content={turn.content} />
                {turn.proposals?.map((p, j) => {
                  const key = `${i}-${j}`
                  return (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      state={resolved[key]}
                      onConfirm={() => void confirm(key, p)}
                      onSkip={() => skip(key)}
                    />
                  )
                })}
              </div>
            ))
          )}

          {sending ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-500 shadow-sm">
                <Spinner className="h-4 w-4" />
                Thinking…
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 shadow-sm">
                {error}
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask the assistant…"
            disabled={!loc || sending}
            className="max-h-40 min-h-[40px] flex-1"
          />
          <Button
            onClick={() => void send(input)}
            disabled={!loc || sending || input.trim().length === 0}
          >
            Send
          </Button>
        </div>
        <p className="mx-auto mt-1.5 max-w-2xl text-[11px] text-slate-400">
          I prepare changes for your OK — I never message customers or move money.
        </p>
      </div>
    </div>
  )
}

function EmptyState({ onPick, disabled }: { onPick: (prompt: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
        <Sparkles className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-slate-800">How can I help?</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        I can look up anything across your account — contacts, appointments, deals, and tasks — and
        prepare changes like booking or tagging for you to confirm. Ask in plain English.
      </p>
      <div className="mt-5 grid w-full max-w-md gap-2 sm:grid-cols-2">
        {EXAMPLES.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className={cn(
              'rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-sm text-slate-600 shadow-sm transition-colors',
              'hover:border-brand-300 hover:bg-brand-50/40 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

function Bubble({ role, content }: { role: AssistantTurn['role']; content: string }) {
  const isOperator = role === 'operator'
  return (
    <div className={cn('flex', isOperator ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm shadow-sm',
          isOperator
            ? 'rounded-br-sm bg-brand-600 text-white'
            : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800',
        )}
      >
        {content}
      </div>
    </div>
  )
}

/**
 * A change the assistant prepared, awaiting the operator's OK. Confirm performs it
 * (POST /assistant/confirm); Skip dismisses it. The card never acts on its own — it
 * is the visible half of the approve-first seam. Once done or skipped the buttons
 * fall away; an error keeps them so the operator can retry.
 */
function ProposalCard({
  proposal,
  state,
  onConfirm,
  onSkip,
}: {
  proposal: ProposedAction
  state?: Resolution
  onConfirm: () => void
  onSkip: () => void
}) {
  const status = state?.status
  const done = status === 'done'
  const skipped = status === 'skipped'
  const confirming = status === 'confirming'
  const settled = done || skipped

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'max-w-[85%] rounded-2xl rounded-bl-sm border px-3.5 py-3 text-sm shadow-sm',
          done
            ? 'border-emerald-200 bg-emerald-50'
            : skipped
              ? 'border-slate-200 bg-slate-50'
              : 'border-amber-200 bg-amber-50',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
              done
                ? 'bg-emerald-600 text-white'
                : skipped
                  ? 'bg-slate-300 text-white'
                  : 'bg-amber-500 text-white',
            )}
          >
            {done ? (
              <Check className="h-3.5 w-3.5" />
            ) : skipped ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'font-medium',
                done ? 'text-emerald-900' : skipped ? 'text-slate-500' : 'text-amber-900',
              )}
            >
              {proposal.summary}
            </p>
            <p
              className={cn(
                'mt-0.5 text-xs',
                done ? 'text-emerald-700' : skipped ? 'text-slate-400' : 'text-amber-700',
              )}
            >
              {done ? 'Done.' : skipped ? 'Skipped.' : 'Prepared — confirm to run it.'}
            </p>

            {!settled ? (
              <div className="mt-2.5 flex items-center gap-2">
                <Button size="sm" onClick={onConfirm} disabled={confirming}>
                  {confirming ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Spinner className="h-3.5 w-3.5" />
                      Working…
                    </span>
                  ) : (
                    'Confirm'
                  )}
                </Button>
                <Button variant="ghost" size="sm" onClick={onSkip} disabled={confirming}>
                  Skip
                </Button>
              </div>
            ) : null}

            {status === 'error' && state?.error ? (
              <p className="mt-2 text-xs text-rose-600">{state.error}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
