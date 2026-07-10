import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  CircleSlash,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  UserSearch,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { Textarea } from '../../components/ui/textarea'
import { type AgentSettings, type ReplyMode, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'

/** The editable form mirror of AgentSettings. Facts are kept as raw rows so the
 *  list editor can hold a trailing blank a person is still typing into; blanks are
 *  dropped on save (and the server drops them too). */
interface AgentForm {
  enabled: boolean
  replyMode: ReplyMode
  persona: string
  instructions: string
  facts: string[]
}

function toForm(s: AgentSettings): AgentForm {
  return {
    enabled: s.agent.enabled ?? false,
    replyMode: s.replyMode,
    persona: s.agent.persona ?? '',
    instructions: s.agent.instructions ?? '',
    facts: s.agent.facts ?? [],
  }
}

/** A stable string for dirty-checking — facts trimmed and blanks dropped so a
 *  half-typed row does not falsely mark the form dirty once cleared. */
function fingerprint(f: AgentForm): string {
  return JSON.stringify({
    enabled: f.enabled,
    replyMode: f.replyMode,
    persona: f.persona.trim(),
    instructions: f.instructions.trim(),
    facts: f.facts.map((x) => x.trim()).filter((x) => x.length > 0),
  })
}

/**
 * AI Agent settings — OpenLevel's answer to GHL "Conversation AI", with the safety
 * controls made explicit. The reply mode is the load-bearing choice: in
 * Approve-first (the default) the agent only drafts a reply for a teammate to send
 * and every action tool is withheld; in Autonomous it answers and acts on its own,
 * but only with tenant-scoped, contact-pinned tools and never a payment tool. The
 * page reads and writes through api.agentSettings / api.updateAgentSettings, which
 * merge atomically server-side.
 */
export function AgentSettingsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [base, setBase] = useState<AgentForm | null>(null)
  const [form, setForm] = useState<AgentForm | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setError(null)
    setSaved(false)
    api
      .agentSettings(loc)
      .then((s) => {
        if (!active) return
        const f = toForm(s)
        setBase(f)
        setForm(f)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  const dirty = useMemo(
    () => (base && form ? fingerprint(base) !== fingerprint(form) : false),
    [base, form],
  )

  function patch(p: Partial<AgentForm>) {
    setForm((f) => (f ? { ...f, ...p } : f))
    setSaved(false)
  }

  async function save() {
    if (!loc || !form || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateAgentSettings(loc, {
        enabled: form.enabled,
        replyMode: form.replyMode,
        persona: form.persona.trim(),
        instructions: form.instructions.trim(),
        facts: form.facts.map((x) => x.trim()).filter((x) => x.length > 0),
      })
      const f = toForm(updated)
      setBase(f)
      setForm(f)
      setSaved(true)
    } catch {
      setError('Could not save the agent settings.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading' || !form) return <PageSpinner label="Loading AI agent settings" />

  const autonomous = form.replyMode === 'autonomous'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">AI Agent</h1>
          <p className="text-xs text-slate-500">
            The assistant that reads each conversation and replies. You decide whether it drafts for
            you or answers on its own.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {saved && !dirty ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </span>
          ) : null}
          <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-2xl space-y-4">
          {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}

          {/* Enable / disable */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Bot className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">Turn the agent on</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    When on, the agent works every new inbound message in this sub-account using the
                    reply mode below. When off, nothing is drafted or sent automatically.
                  </p>
                </div>
              </div>
              <Toggle
                on={form.enabled}
                onChange={(on) => patch({ enabled: on })}
                label="Agent enabled"
              />
            </div>
          </section>

          {/* Reply mode — the load-bearing safety control */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-[18px] w-[18px] text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">Reply mode</h2>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              This is the most important choice on the page. It decides whether the agent can act on
              its own or only proposes work for you to approve.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <ModeCard
                active={!autonomous}
                onClick={() => patch({ replyMode: 'approve-first' })}
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Approve first"
                badge="Recommended"
                body="The agent drafts a reply and looks things up, but never sends and never takes an action. A teammate reviews and sends. Action tools are withheld entirely."
              />
              <ModeCard
                active={autonomous}
                onClick={() => patch({ replyMode: 'autonomous' })}
                icon={<Send className="h-4 w-4" />}
                title="Autonomous"
                body="The agent replies to the customer directly and may book an appointment or tag the contact once the customer agrees. Every action stays scoped to this contact."
              />
            </div>
          </section>

          {/* Capabilities — honest list of what the agent can actually do */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">What the agent can do</h2>
            <p className="mb-3 text-xs text-slate-500">
              The agent only ever uses these tools, always limited to this sub-account and the
              contact it is replying to. It has no access to payments — money moves only through your
              payment processor, never through the agent.
            </p>
            <ul className="space-y-2">
              <Capability
                icon={<CalendarCheck className="h-4 w-4" />}
                title="Check real availability"
                note="Reads open times from your booking calendar — it never invents a time."
                enabled
              />
              <Capability
                icon={<UserSearch className="h-4 w-4" />}
                title="Read this contact's details"
                note="Name, tags, and saved fields, to personalize the reply."
                enabled
              />
              <Capability
                icon={<CalendarCheck className="h-4 w-4" />}
                title="Book an appointment"
                note={
                  autonomous
                    ? 'Reserves a real open time for this contact after they agree.'
                    : 'Available only in Autonomous mode. In Approve-first it is withheld.'
                }
                enabled={autonomous}
              />
              <Capability
                icon={<Tag className="h-4 w-4" />}
                title="Tag this contact"
                note={
                  autonomous
                    ? "Adds an organizational tag (like 'hot-lead') to this contact."
                    : 'Available only in Autonomous mode. In Approve-first it is withheld.'
                }
                enabled={autonomous}
              />
            </ul>
          </section>

          {/* Persona */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <Label htmlFor="agent-persona" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-400" />
              Persona
            </Label>
            <p className="mb-2 mt-1 text-xs text-slate-500">
              Who the agent is. One or two sentences. Leave blank to use a neutral, professional
              assistant.
            </p>
            <Textarea
              id="agent-persona"
              rows={3}
              value={form.persona}
              maxLength={4000}
              placeholder="You are Ada, the friendly front desk for Bright Smiles Dental."
              onChange={(e) => patch({ persona: e.target.value })}
            />
          </section>

          {/* Owner instructions */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <Label htmlFor="agent-instructions">Instructions</Label>
            <p className="mb-2 mt-1 text-xs text-slate-500">
              Extra rules layered on top of the built-in ones — tone, what to do, what to avoid. The
              built-in safety rules always apply and cannot be turned off here.
            </p>
            <Textarea
              id="agent-instructions"
              rows={4}
              value={form.instructions}
              maxLength={8000}
              placeholder="Always offer to book a free consultation. Never quote a price; say a team member will confirm pricing."
              onChange={(e) => patch({ instructions: e.target.value })}
            />
          </section>

          {/* Knowledge base */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Knowledge base</h2>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">
              Short facts the agent can rely on — hours, location, policies. One fact per line. The
              agent still looks up live data (like availability) with its tools rather than guessing.
            </p>
            <FactsEditor facts={form.facts} onChange={(facts) => patch({ facts })} />
          </section>
        </div>
      </div>
    </div>
  )
}

/** A two-state pill toggle. No Switch primitive exists in the kit, so this is a
 *  small accessible button styled as a track + knob. */
function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (on: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1',
        on ? 'bg-brand-600' : 'bg-slate-200',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  body,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  body: string
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors',
        active
          ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500'
          : 'border-slate-200 bg-white hover:bg-slate-50',
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className={cn('shrink-0', active ? 'text-brand-600' : 'text-slate-400')}>{icon}</span>
        <span className={cn('text-sm font-semibold', active ? 'text-brand-700' : 'text-slate-800')}>
          {title}
        </span>
        {badge ? (
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-xs leading-relaxed text-slate-500">{body}</span>
    </button>
  )
}

function Capability({
  icon,
  title,
  note,
  enabled,
}: {
  icon: React.ReactNode
  title: string
  note: string
  enabled: boolean
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
          enabled ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-400',
        )}
      >
        {enabled ? icon : <CircleSlash className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-sm font-medium', enabled ? 'text-slate-800' : 'text-slate-400')}>
          {title}
        </span>
        <span className="block text-xs text-slate-500">{note}</span>
      </span>
    </li>
  )
}

/** A one-fact-per-row list editor. Rows are kept verbatim while editing (including
 *  a trailing blank the operator is filling in); the page drops blanks on save. */
function FactsEditor({ facts, onChange }: { facts: string[]; onChange: (facts: string[]) => void }) {
  const rows = facts.length > 0 ? facts : ['']

  function setRow(i: number, value: string) {
    const next = [...rows]
    next[i] = value
    onChange(next)
  }
  function addRow() {
    onChange([...rows, ''])
  }
  function removeRow(i: number) {
    const next = rows.filter((_, idx) => idx !== i)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={`fact-${i}`} className="flex items-center gap-2">
          <Input
            value={row}
            maxLength={1000}
            placeholder="e.g. We are open Monday to Friday, 9am to 5pm."
            onChange={(e) => setRow(i, e.target.value)}
          />
          <button
            type="button"
            title="Remove fact"
            onClick={() => removeRow(i)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button size="sm" variant="subtle" onClick={addRow}>
        <Plus className="h-4 w-4" />
        Add fact
      </Button>
    </div>
  )
}
