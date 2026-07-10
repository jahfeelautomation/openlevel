import { CheckCircle2, CircleSlash, KeyRound, Phone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type VoiceProviderChoice, type VoiceSettings, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'

interface VoiceForm {
  provider: VoiceProviderChoice
  fromNumber: string
  operatorNumber: string
  vapiAssistantId: string
  vapiPhoneNumberId: string
}

function toForm(s: VoiceSettings): VoiceForm {
  return {
    provider: s.provider,
    fromNumber: s.fromNumber ?? '',
    operatorNumber: s.operatorNumber ?? '',
    vapiAssistantId: s.vapiAssistantId ?? '',
    vapiPhoneNumberId: s.vapiPhoneNumberId ?? '',
  }
}

function fingerprint(f: VoiceForm): string {
  return JSON.stringify({
    provider: f.provider,
    fromNumber: f.fromNumber.trim(),
    operatorNumber: f.operatorNumber.trim(),
    vapiAssistantId: f.vapiAssistantId.trim(),
    vapiPhoneNumberId: f.vapiPhoneNumberId.trim(),
  })
}

/**
 * Voice connection — the same model as Payments and Sending: this sub-account
 * connects its OWN provider (Twilio for click-to-call bridging, Vapi for the AI
 * voice agent) and calls run on their numbers and rates. Only the provider
 * choice and non-secret numbers/ids are stored here; the keys live in the
 * platform vault by name and are never typed into this app. The readout is
 * honest — `connected` is true only when the chosen provider's keys actually
 * resolve server-side.
 */
export function VoiceSettingsPage() {
  const { current } = useTenant()
  const loc = current?.id
  const slug = current ? (current.client_slug ?? current.slug) : 'your-account'

  const [base, setBase] = useState<VoiceForm | null>(null)
  const [form, setForm] = useState<VoiceForm | null>(null)
  const [view, setView] = useState<VoiceSettings | null>(null)
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
      .voiceSettings(loc)
      .then((s) => {
        if (!active) return
        const f = toForm(s)
        setBase(f)
        setForm(f)
        setView(s)
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

  function patch(p: Partial<VoiceForm>) {
    setForm((f) => (f ? { ...f, ...p } : f))
    setSaved(false)
  }

  async function save() {
    if (!loc || !form || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateVoiceSettings(loc, {
        provider: form.provider,
        fromNumber: form.fromNumber.trim() || null,
        operatorNumber: form.operatorNumber.trim() || null,
        vapiAssistantId: form.vapiAssistantId.trim() || null,
        vapiPhoneNumberId: form.vapiPhoneNumberId.trim() || null,
      })
      const f = toForm(updated)
      setBase(f)
      setForm(f)
      setView(updated)
      setSaved(true)
    } catch {
      setError('Could not save the voice settings.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading' || !form) return <PageSpinner label="Loading voice settings" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Voice</h1>
          <p className="text-xs text-slate-500">
            Connect this sub-account's own calling provider. Calls run on their numbers and
            rates — click-to-call through Twilio, or an AI voice agent through Vapi.
          </p>
        </div>
        <div className="flex items-center gap-3">
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

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="h-[18px] w-[18px] text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-900">Calling provider</h2>
              </div>
              <ConnectionBadge dirty={dirty} view={view} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <ProviderCard
                active={form.provider === 'twilio'}
                onClick={() => patch({ provider: 'twilio' })}
                title="Twilio"
                body="Click-to-call: rings the customer from the business's number, then bridges in the operator's phone."
              />
              <ProviderCard
                active={form.provider === 'vapi'}
                onClick={() => patch({ provider: 'vapi' })}
                title="Vapi"
                body="AI voice agent: the business's own Vapi assistant makes the call and reports the transcript back."
              />
              <ProviderCard
                active={form.provider === 'none'}
                onClick={() => patch({ provider: 'none' })}
                title="None"
                body="No voice provider. Calls are refused honestly instead of pretending to dial."
              />
            </div>

            {form.provider === 'twilio' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="voice-from">From number</Label>
                  <p className="mb-2 mt-1 text-xs text-slate-500">
                    A voice-capable number owned by the Twilio account, in E.164 form.
                  </p>
                  <Input
                    id="voice-from"
                    value={form.fromNumber}
                    maxLength={32}
                    placeholder="+16025550100"
                    onChange={(e) => patch({ fromNumber: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="voice-operator">Operator's phone</Label>
                  <p className="mb-2 mt-1 text-xs text-slate-500">
                    The phone that rings to join the call once the customer answers.
                  </p>
                  <Input
                    id="voice-operator"
                    value={form.operatorNumber}
                    maxLength={32}
                    placeholder="+16025550199"
                    onChange={(e) => patch({ operatorNumber: e.target.value })}
                  />
                </div>
              </div>
            ) : null}

            {form.provider === 'vapi' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="vapi-assistant">Assistant ID</Label>
                  <p className="mb-2 mt-1 text-xs text-slate-500">
                    The Vapi assistant that speaks on the business's behalf.
                  </p>
                  <Input
                    id="vapi-assistant"
                    value={form.vapiAssistantId}
                    maxLength={200}
                    placeholder="asst_…"
                    onChange={(e) => patch({ vapiAssistantId: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="vapi-number">Phone number ID</Label>
                  <p className="mb-2 mt-1 text-xs text-slate-500">
                    The Vapi phone number the assistant calls from.
                  </p>
                  <Input
                    id="vapi-number"
                    value={form.vapiPhoneNumberId}
                    maxLength={200}
                    placeholder="pn_…"
                    onChange={(e) => patch({ vapiPhoneNumberId: e.target.value })}
                  />
                </div>
              </div>
            ) : null}
          </section>

          {/* Where the keys live — never in this app */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <KeyRound className="h-[18px] w-[18px] text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">API keys</h2>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Keys are never typed into this app and never stored with this sub-account's data.
              Your platform operator places them in the secure vault under these names:
            </p>
            <ul className="space-y-1.5">
              {[
                ...(form.provider === 'twilio'
                  ? [`${slug}:twilio:account_sid`, `${slug}:twilio:auth_token`]
                  : []),
                ...(form.provider === 'vapi'
                  ? [`${slug}:vapi:api_key`, `${slug}:vapi:webhook_secret`]
                  : []),
              ].map((name) => (
                <li key={name}>
                  <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{name}</code>
                </li>
              ))}
              {form.provider === 'none' ? (
                <li className="text-xs text-slate-400">Choose a provider above to see its key names.</li>
              ) : null}
            </ul>
            {form.provider === 'twilio' ? (
              <p className="mt-3 text-xs text-slate-400">
                These are the same Twilio keys SMS sending uses — connect once, call and text on
                the same account.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}

/** The saved-state connection chip. An unsaved provider switch must not flip
 *  the readout until it actually persists, so a dirty form shows neutral. */
function ConnectionBadge({ dirty, view }: { dirty: boolean; view: VoiceSettings | null }) {
  if (dirty || !view) {
    return <span className="text-xs font-medium text-slate-400">Save to check connection</span>
  }
  if (view.connected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Connected
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500"
      title={view.reason}
    >
      <CircleSlash className="h-3.5 w-3.5" />
      {view.reason ?? 'Not connected'}
    </span>
  )
}

function ProviderCard({
  active,
  onClick,
  title,
  body,
}: {
  active: boolean
  onClick: () => void
  title: string
  body: string
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
      <span className={cn('text-sm font-semibold', active ? 'text-brand-700' : 'text-slate-800')}>
        {title}
      </span>
      <span className="text-xs leading-relaxed text-slate-500">{body}</span>
    </button>
  )
}
