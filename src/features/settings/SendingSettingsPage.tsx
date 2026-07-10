import { CheckCircle2, CircleSlash, KeyRound, Mail, MessageSquare } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type ChannelStatus,
  type EmailProvider,
  type SendingSettings,
  type SmsProvider,
  api,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'

interface SendingForm {
  emailProvider: EmailProvider
  fromEmail: string
  fromName: string
  smsProvider: SmsProvider
  smsFrom: string
}

function toForm(s: SendingSettings): SendingForm {
  return {
    emailProvider: s.emailProvider,
    fromEmail: s.fromEmail ?? '',
    fromName: s.fromName ?? '',
    smsProvider: s.smsProvider,
    smsFrom: s.smsFrom ?? '',
  }
}

function fingerprint(f: SendingForm): string {
  return JSON.stringify({
    emailProvider: f.emailProvider,
    fromEmail: f.fromEmail.trim(),
    fromName: f.fromName.trim(),
    smsProvider: f.smsProvider,
    smsFrom: f.smsFrom.trim(),
  })
}

/**
 * Campaign sending connections — the same model as Payments: this sub-account
 * connects its OWN Brevo (email) and Twilio (SMS) accounts, and blasts go out
 * through those. Only the provider choice and sender identity are stored here;
 * the API keys live in the platform vault by name and are never typed into
 * this app. The per-channel readouts are honest — `connected` is true only
 * when the chosen provider's keys actually resolve server-side.
 */
export function SendingSettingsPage() {
  const { current } = useTenant()
  const loc = current?.id
  const slug = current ? (current.client_slug ?? current.slug) : 'your-account'

  const [base, setBase] = useState<SendingForm | null>(null)
  const [form, setForm] = useState<SendingForm | null>(null)
  const [view, setView] = useState<SendingSettings | null>(null)
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
      .sendingSettings(loc)
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

  function patch(p: Partial<SendingForm>) {
    setForm((f) => (f ? { ...f, ...p } : f))
    setSaved(false)
  }

  async function save() {
    if (!loc || !form || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateSendingSettings(loc, {
        emailProvider: form.emailProvider,
        fromEmail: form.fromEmail.trim() || null,
        fromName: form.fromName.trim() || null,
        smsProvider: form.smsProvider,
        smsFrom: form.smsFrom.trim() || null,
      })
      const f = toForm(updated)
      setBase(f)
      setForm(f)
      setView(updated)
      setSaved(true)
    } catch {
      setError('Could not save the sending settings.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading' || !form) return <PageSpinner label="Loading sending settings" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Email &amp; SMS</h1>
          <p className="text-xs text-slate-500">
            Connect this sub-account's own sending providers. Campaigns go out through their
            accounts — deliverability, sender reputation, and billing stay theirs.
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

          {/* Email channel */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-[18px] w-[18px] text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-900">Email</h2>
              </div>
              <ChannelBadge dirty={dirty} status={view?.email} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProviderCard
                active={form.emailProvider === 'brevo'}
                onClick={() => patch({ emailProvider: 'brevo' })}
                title="Brevo"
                body="Transactional email through the business's own Brevo account and sender domain."
              />
              <ProviderCard
                active={form.emailProvider === 'none'}
                onClick={() => patch({ emailProvider: 'none' })}
                title="None"
                body="No email provider. Email campaigns are refused honestly instead of pretending to send."
              />
            </div>

            {form.emailProvider === 'brevo' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="from-email">From email</Label>
                  <p className="mb-2 mt-1 text-xs text-slate-500">
                    Must be a sender verified in the Brevo account.
                  </p>
                  <Input
                    id="from-email"
                    value={form.fromEmail}
                    maxLength={320}
                    placeholder="offers@jamalbuyshouses.com"
                    onChange={(e) => patch({ fromEmail: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="from-name">From name</Label>
                  <p className="mb-2 mt-1 text-xs text-slate-500">
                    Shown in the recipient's inbox. Optional.
                  </p>
                  <Input
                    id="from-name"
                    value={form.fromName}
                    maxLength={200}
                    placeholder="Jamal Buys Houses"
                    onChange={(e) => patch({ fromName: e.target.value })}
                  />
                </div>
              </div>
            ) : null}
          </section>

          {/* SMS channel */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-[18px] w-[18px] text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-900">SMS</h2>
              </div>
              <ChannelBadge dirty={dirty} status={view?.sms} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProviderCard
                active={form.smsProvider === 'twilio'}
                onClick={() => patch({ smsProvider: 'twilio' })}
                title="Twilio"
                body="Texts from the business's own Twilio number, with their A2P registration."
              />
              <ProviderCard
                active={form.smsProvider === 'none'}
                onClick={() => patch({ smsProvider: 'none' })}
                title="None"
                body="No SMS provider. SMS campaigns are refused honestly instead of pretending to send."
              />
            </div>

            {form.smsProvider === 'twilio' ? (
              <div className="mt-4">
                <Label htmlFor="sms-from">From number</Label>
                <p className="mb-2 mt-1 text-xs text-slate-500">
                  A number owned by the Twilio account, in E.164 form.
                </p>
                <Input
                  id="sms-from"
                  value={form.smsFrom}
                  maxLength={32}
                  placeholder="+16025550100"
                  onChange={(e) => patch({ smsFrom: e.target.value })}
                />
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
                ...(form.emailProvider === 'brevo' ? [`${slug}:brevo:api_key`] : []),
                ...(form.smsProvider === 'twilio'
                  ? [`${slug}:twilio:account_sid`, `${slug}:twilio:auth_token`]
                  : []),
              ].map((name) => (
                <li key={name}>
                  <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{name}</code>
                </li>
              ))}
              {form.emailProvider !== 'brevo' && form.smsProvider !== 'twilio' ? (
                <li className="text-xs text-slate-400">Choose a provider above to see its key names.</li>
              ) : null}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

/** The saved-state connection chip. An unsaved provider switch must not flip
 *  the readout until it actually persists, so a dirty form shows neutral. */
function ChannelBadge({ dirty, status }: { dirty: boolean; status: ChannelStatus | undefined }) {
  if (dirty || !status) {
    return <span className="text-xs font-medium text-slate-400">Save to check connection</span>
  }
  if (status.connected) {
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
      title={status.reason}
    >
      <CircleSlash className="h-3.5 w-3.5" />
      {status.reason ?? 'Not connected'}
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
