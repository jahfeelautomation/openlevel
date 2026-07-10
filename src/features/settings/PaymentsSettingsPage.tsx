import { CheckCircle2, CircleSlash, CreditCard, KeyRound, Link2, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type PaymentsProvider, type PaymentsSettings, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'

interface PaymentsForm {
  provider: PaymentsProvider
  squareLocationId: string
}

function toForm(s: PaymentsSettings): PaymentsForm {
  return { provider: s.provider, squareLocationId: s.squareLocationId ?? '' }
}

function fingerprint(f: PaymentsForm): string {
  return JSON.stringify({ provider: f.provider, squareLocationId: f.squareLocationId.trim() })
}

/**
 * Payments processor connection — the GHL model: this sub-account connects its
 * OWN Stripe or Square account, checkout links are minted inside that account,
 * and their processor charges the card. OpenLevel never holds or moves money.
 * Only the provider choice (and Square's location id) is stored here; the API
 * keys live in the platform vault by name and are never typed into this app.
 * The `connected` readout is honest — it is true only when the chosen
 * processor's keys actually resolve server-side.
 */
export function PaymentsSettingsPage() {
  const { current } = useTenant()
  const loc = current?.id
  const slug = current ? (current.client_slug ?? current.slug) : 'your-account'

  const [base, setBase] = useState<PaymentsForm | null>(null)
  const [form, setForm] = useState<PaymentsForm | null>(null)
  const [view, setView] = useState<PaymentsSettings | null>(null)
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
      .paymentsSettings(loc)
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

  function patch(p: Partial<PaymentsForm>) {
    setForm((f) => (f ? { ...f, ...p } : f))
    setSaved(false)
  }

  async function save() {
    if (!loc || !form || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updatePaymentsSettings(loc, {
        provider: form.provider,
        squareLocationId: form.squareLocationId.trim() || null,
      })
      const f = toForm(updated)
      setBase(f)
      setForm(f)
      setView(updated)
      setSaved(true)
    } catch {
      setError('Could not save the payment settings.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading' || !form) return <PageSpinner label="Loading payment settings" />

  // The connection readout reflects the SAVED state, not the unsaved form — an
  // unsaved provider switch must not flip the banner until it actually persists.
  const connected = !dirty && (view?.connected ?? false)
  const reason = view?.reason

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* flex-wrap drops the Save button below the long description on a phone
          instead of squeezing the text into a sliver beside it */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-[16rem] flex-1">
          <h1 className="text-base font-semibold text-slate-900">Payments</h1>
          <p className="text-xs text-slate-500">
            Connect this sub-account's own payment processor. Customers pay on the processor's
            hosted page — money never passes through OpenLevel.
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

          {/* Honest connection status */}
          <section
            className={cn(
              'flex items-start gap-3 rounded-xl border p-4 shadow-sm',
              connected
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-slate-200 bg-white',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                connected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400',
              )}
            >
              {connected ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <CircleSlash className="h-[18px] w-[18px]" />}
            </span>
            <div className="min-w-0">
              <h2 className={cn('text-sm font-semibold', connected ? 'text-emerald-800' : 'text-slate-900')}>
                {connected
                  ? `Connected to ${view?.provider === 'square' ? 'Square' : 'Stripe'}`
                  : 'Not connected'}
              </h2>
              <p className={cn('mt-0.5 text-xs', connected ? 'text-emerald-700' : 'text-slate-500')}>
                {connected
                  ? 'Checkout links can be created from invoices, and payments mark them paid automatically.'
                  : dirty
                    ? 'Save your changes to check the connection.'
                    : (reason ?? 'Choose a processor below to take payments by link.')}
              </p>
            </div>
          </section>

          {/* Provider choice */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <CreditCard className="h-[18px] w-[18px] text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">Payment processor</h2>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              The processor account belongs to this business — charges, payouts, refunds, and
              receipts all happen there. OpenLevel only creates the checkout link and records the
              result.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <ProviderCard
                active={form.provider === 'stripe'}
                onClick={() => patch({ provider: 'stripe' })}
                title="Stripe"
                body="Hosted Stripe Checkout. Cards, wallets, and whatever the Stripe account has enabled."
              />
              <ProviderCard
                active={form.provider === 'square'}
                onClick={() => patch({ provider: 'square' })}
                title="Square"
                body="Square payment links. Uses the business's Square location for deposits and receipts."
              />
              <ProviderCard
                active={form.provider === 'none'}
                onClick={() => patch({ provider: 'none' })}
                title="None"
                body="No processor. Invoices can still be marked paid by hand (cash, check, external)."
              />
            </div>

            {form.provider === 'square' ? (
              <div className="mt-4">
                <Label htmlFor="square-location-id">Square location ID</Label>
                <p className="mb-2 mt-1 text-xs text-slate-500">
                  Found in the Square dashboard under Account &amp; Settings → Locations. Payments
                  settle to this Square location.
                </p>
                <Input
                  id="square-location-id"
                  value={form.squareLocationId}
                  maxLength={200}
                  placeholder="e.g. L8KTM2Q3X9ZRC"
                  onChange={(e) => patch({ squareLocationId: e.target.value })}
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
              {(form.provider === 'square'
                ? [`${slug}:square:access_token`, `${slug}:square:webhook_signature_key`]
                : [`${slug}:stripe:secret_key`, `${slug}:stripe:webhook_secret`]
              ).map((name) => (
                <li key={name}>
                  <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{name}</code>
                </li>
              ))}
            </ul>
          </section>

          {/* How pay-by-link works */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <Link2 className="h-[18px] w-[18px] text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">How pay-by-link works</h2>
            </div>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs text-slate-600">
              <li>Open an invoice and choose "Create payment link".</li>
              <li>
                The link opens the processor's own hosted checkout page — the customer pays there,
                on their infrastructure, not ours.
              </li>
              <li>
                The processor notifies OpenLevel with a signed webhook, the invoice is marked paid,
                and the payment shows up in Transactions.
              </li>
            </ol>
            <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              Card numbers never touch OpenLevel, and the AI agent has no payment tools — links are
              created only by a person from the invoice screen.
            </p>
          </section>
        </div>
      </div>
    </div>
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
