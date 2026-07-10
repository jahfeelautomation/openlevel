import { Send, Sparkles } from 'lucide-react'
import { type KeyboardEvent, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { ApiError, api } from '../../lib/api'

/** Operator message composer with a "Draft from agent" button (approve-first:
 *  the AI fills the box, the operator edits and sends). */
export function Composer({
  locationId,
  conversationId,
  onSent,
}: {
  locationId: string
  conversationId: string
  onSent: () => void
}) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Clear the box when switching conversations.
  useEffect(() => {
    setBody('')
    setError(null)
  }, [conversationId])

  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      await api.sendMessage(locationId, conversationId, text)
      setBody('')
      onSent()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to send message.')
    } finally {
      setSending(false)
    }
  }

  async function draftFromAgent() {
    if (drafting) return
    setDrafting(true)
    setError(null)
    try {
      const r = await api.draft(locationId, conversationId)
      setBody(r.text)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to draft a reply.')
    } finally {
      setDrafting(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-3">
      {error ? (
        <p className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{error}</p>
      ) : null}
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write a reply…"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => void draftFromAgent()} disabled={drafting}>
          <Sparkles className={drafting ? 'h-4 w-4 animate-pulse text-brand-500' : 'h-4 w-4 text-brand-500'} />
          {drafting ? 'Drafting…' : 'Draft from agent'}
        </Button>
        {/* keyboard hint is desktop-only — a phone has no Enter-to-send */}
        <span className="hidden text-[11px] text-slate-400 lg:inline">
          Enter to send · Shift+Enter for a new line
        </span>
        <Button size="sm" onClick={() => void send()} disabled={sending || body.trim().length === 0}>
          <Send className="h-4 w-4" />
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
