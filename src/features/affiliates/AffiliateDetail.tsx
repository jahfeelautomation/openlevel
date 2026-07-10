import { ArrowLeft, ExternalLink, MousePointerClick, Plus, Trash2, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type AffiliateDetail as AffiliateDetailData,
  type AffiliateProgram,
  type AffiliateReferralWithContact,
  type Contact,
  type ReferralStatus,
  api,
} from '../../lib/api'
import { cn, formatMoney, formatMoneyExact } from '../../lib/utils'
import { CopyButton, hostedUrl } from '../trigger-links/link-ui'
import { affiliateBadge, referralBadge, timeAgo } from './affiliates-meta'

interface Props {
  loc: string
  affiliateId: string
  program: AffiliateProgram | null
  onBack: () => void
  onChanged: () => void
  onDeleted: () => void
}

/**
 * One affiliate's page — the referral link to share, the sales it drove, and the
 * commission ledger. The summary strip and every figure are the server's derived
 * totals over real rows, so the page never overstates. Recording a sale stores a
 * commission LOCKED to the program rate at that moment. Commission follows the
 * GHL lifecycle — pending (awaiting review) → approved (owed) → paid — and
 * "Record payout" settles ONLY approved rows in the ledger (bookkeeping — it
 * moves no money), exactly like an invoice's record-payment.
 */
export function AffiliateDetail({ loc, affiliateId, program, onBack, onChanged, onDeleted }: Props) {
  const [detail, setDetail] = useState<AffiliateDetailData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [recording, setRecording] = useState(false)
  const [payoutBusy, setPayoutBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busyRefId, setBusyRefId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setStatus('loading')
    api
      .affiliate(loc, affiliateId)
      .then((d) => {
        if (!active) return
        setDetail(d)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc, affiliateId])

  async function refresh() {
    const d = await api.affiliate(loc, affiliateId)
    setDetail(d)
    onChanged()
  }

  async function changeReferralStatus(refId: string, next: ReferralStatus) {
    setBusyRefId(refId)
    try {
      await api.setReferralStatus(loc, affiliateId, refId, next)
      await refresh()
    } finally {
      setBusyRefId(null)
    }
  }

  async function recordPayout() {
    if (payoutBusy) return
    setPayoutBusy(true)
    try {
      await api.affiliatePayout(loc, affiliateId)
      await refresh()
    } finally {
      setPayoutBusy(false)
    }
  }

  async function deleteAffiliate() {
    await api.deleteAffiliate(loc, affiliateId)
    onDeleted()
  }

  if (status === 'loading' || !detail) return <PageSpinner />

  const { affiliate, referrals, clicks, summary } = detail
  const badge = affiliateBadge(affiliate.status)
  const owed = summary.owedCents
  const refLink = hostedUrl(affiliate.ref_url)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            aria-label="Back to affiliates"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold text-slate-900">{affiliate.name}</h1>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                {affiliate.code}
              </span>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            {affiliate.email && <p className="truncate text-xs text-slate-500">{affiliate.email}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyButton text={refLink} label="Copy link" />
          <Button size="sm" onClick={() => setRecording(true)}>
            <Plus className="h-4 w-4" />
            Record sale
          </Button>
        </div>
      </header>

      {/* Summary — derived totals for this one affiliate. */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-6">
        <Cell label="Clicks" value={String(summary.clicks)} sub="referral visits" />
        <Cell label="Referrals" value={String(summary.referrals)} sub="sales recorded" />
        <Cell label="Conversion" value={`${summary.conversionRate}%`} sub="per 100 clicks" />
        <Cell label="Sales volume" value={formatMoney(summary.salesVolumeCents)} sub="driven" />
        <Cell label="Earned" value={formatMoney(summary.commissionCents)} sub="commission" tone="brand" />
        <Cell
          label="Owed"
          value={formatMoney(owed)}
          sub={`${formatMoney(summary.pendingCents)} pending · ${formatMoney(summary.paidCents)} paid`}
          tone={owed > 0 ? 'amber' : 'emerald'}
        />
      </div>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
        {/* grid-cols-1 (minmax(0,1fr)) is load-bearing on mobile: without it the
            implicit auto track grows to the widest card's max-content and the
            Referrals card overflows the 390px viewport */}
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <ReferralsCard
              referrals={referrals}
              owed={owed}
              pending={summary.pendingCents}
              payoutBusy={payoutBusy}
              busyRefId={busyRefId}
              onPayout={recordPayout}
              onStatus={changeReferralStatus}
              onRecord={() => setRecording(true)}
            />
            <ClicksCard clicks={clicks} />
            <DangerZone name={affiliate.name} onConfirm={() => setConfirmingDelete(true)} />
          </div>
          <div className="space-y-5">
            <EditCard
              key={affiliate.id}
              loc={loc}
              affiliate={affiliate}
              onSaved={() => void refresh()}
            />
            <HostedLinkCard refLink={refLink} program={program} />
          </div>
        </div>
      </div>

      {recording && (
        <RecordSaleDialog
          loc={loc}
          affiliateId={affiliateId}
          program={program}
          onClose={() => setRecording(false)}
          onRecorded={async () => {
            setRecording(false)
            await refresh()
          }}
        />
      )}
      {confirmingDelete && (
        <ConfirmDeleteDialog
          name={affiliate.name}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            setConfirmingDelete(false)
            await deleteAffiliate()
          }}
        />
      )}
    </div>
  )
}

function Cell({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub: string
  tone?: 'default' | 'brand' | 'emerald' | 'amber'
}) {
  return (
    <div className="bg-white px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          tone === 'brand' && 'text-brand-600',
          tone === 'emerald' && 'text-emerald-600',
          tone === 'amber' && 'text-amber-600',
          tone === 'default' && 'text-slate-900',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}

/** The commission ledger: every recorded sale with its locked commission and a
 *  status control. "Record payout" settles APPROVED rows only — pending referrals
 *  await review and must be approved first (the GHL pending → approved → paid
 *  lifecycle). Pure bookkeeping that marks rows paid and stamps the date; it
 *  moves no money. */
function ReferralsCard({
  referrals,
  owed,
  pending,
  payoutBusy,
  busyRefId,
  onPayout,
  onStatus,
  onRecord,
}: {
  referrals: AffiliateReferralWithContact[]
  owed: number
  pending: number
  payoutBusy: boolean
  busyRefId: string | null
  onPayout: () => void
  onStatus: (refId: string, next: ReferralStatus) => void
  onRecord: () => void
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Referrals</h2>
          <p className="text-xs text-slate-500">
            {referrals.length === 0
              ? 'Sales this affiliate drove will appear here.'
              : `${referrals.length} recorded — commission is locked when each sale is logged.`}
          </p>
        </div>
        {owed > 0 ? (
          <Button size="sm" variant="outline" disabled={payoutBusy} onClick={onPayout}>
            <Wallet className="h-3.5 w-3.5" />
            {payoutBusy ? 'Recording…' : `Record payout (${formatMoney(owed)})`}
          </Button>
        ) : pending > 0 ? (
          <p className="text-xs text-amber-600">
            {formatMoney(pending)} pending review — approve referrals to pay out
          </p>
        ) : null}
      </div>

      {referrals.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-900">No referrals yet</p>
          <p className="text-sm text-slate-500">Record the first sale this affiliate sent your way.</p>
          <Button size="sm" variant="outline" onClick={onRecord}>
            <Plus className="h-3.5 w-3.5" />
            Record sale
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {referrals.map((r) => {
            const b = referralBadge(r.status)
            const when = r.status === 'paid' && r.paid_at ? `Paid ${timeAgo(r.paid_at)}` : timeAgo(r.occurred_at)
            const busy = busyRefId === r.id
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {r.description?.trim() || 'Sale'}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {r.contact_name ? `${r.contact_name} · ` : ''}
                    {when}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoneyExact(Number(r.amount_cents))}
                    </p>
                    <p className="text-xs tabular-nums text-brand-600">
                      {formatMoneyExact(Number(r.commission_cents))} commission
                    </p>
                  </div>
                  <select
                    value={r.status}
                    disabled={busy}
                    onChange={(e) => onStatus(r.id, e.target.value as ReferralStatus)}
                    aria-label="Referral status"
                    className={cn(
                      'h-8 rounded-lg border bg-white px-2 text-xs font-medium shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30',
                      b.variant === 'amber' && 'border-amber-200 text-amber-700',
                      b.variant === 'blue' && 'border-blue-200 text-blue-700',
                      b.variant === 'green' && 'border-emerald-200 text-emerald-700',
                      b.variant === 'slate' && 'border-slate-200 text-slate-700',
                    )}
                  >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** A read-only feed of recent referral-link visits. A click with a known contact
 *  is named; an untracked visit reads "Anonymous visit" rather than inventing one. */
function ClicksCard({ clicks }: { clicks: AffiliateDetailData['clicks'] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">Recent clicks</h2>
        <p className="text-xs text-slate-500">The latest visits to this affiliate's referral link.</p>
      </div>
      {clicks.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">No clicks recorded yet.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {clicks.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <MousePointerClick className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm text-slate-700">{c.contact_name ?? 'Anonymous visit'}</span>
              </div>
              <span className="text-xs text-slate-400">{timeAgo(c.clicked_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Edit the affiliate's own fields. The referral code is part of the public link,
 *  so changing it is allowed but deliberate — the input shows it plainly. */
function EditCard({
  loc,
  affiliate,
  onSaved,
}: {
  loc: string
  affiliate: AffiliateDetailData['affiliate']
  onSaved: () => void
}) {
  const [name, setName] = useState(affiliate.name)
  const [email, setEmail] = useState(affiliate.email ?? '')
  const [code, setCode] = useState(affiliate.code)
  const [active, setActive] = useState(affiliate.status === 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    name.trim() !== affiliate.name ||
    (email.trim() || '') !== (affiliate.email ?? '') ||
    code.trim() !== affiliate.code ||
    active !== (affiliate.status === 'active')

  async function save() {
    if (!name.trim() || !code.trim() || saving || !dirty) return
    setSaving(true)
    setError(null)
    try {
      await api.updateAffiliate(loc, affiliate.id, {
        name: name.trim(),
        email: email.trim() || null,
        code: code.trim(),
        status: active ? 'active' : 'paused',
      })
      onSaved()
    } catch {
      setError('Could not save. The referral code may already be in use.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">Affiliate details</h2>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div>
          <Label htmlFor="edit-name">Name</Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="edit-email">Email</Label>
          <Input
            id="edit-email"
            type="email"
            value={email}
            placeholder="Optional"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="edit-code">Referral code</Label>
          <Input
            id="edit-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="font-mono"
          />
          <p className="mt-1 text-xs text-slate-400">This is part of the public referral link.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
          />
          Active
        </label>
        {error && <p className="text-xs text-rose-500">{error}</p>}
        <Button
          size="sm"
          className="w-full"
          disabled={!name.trim() || !code.trim() || !dirty || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </section>
  )
}

/** The shareable referral link. Visiting it records a click and 302s to the
 *  program's landing page — shown here so the operator can hand it over or test it. */
function HostedLinkCard({
  refLink,
  program,
}: {
  refLink: string
  program: AffiliateProgram | null
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">Referral link</h2>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="truncate font-mono text-xs text-slate-600">{refLink}</span>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={refLink} label="Copy link" className="flex-1 justify-center" />
          <a
            href={refLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ExternalLink className="h-4 w-4" />
            Test
          </a>
        </div>
        <p className="text-xs text-slate-400">
          Each visit is counted, then forwarded to
          {program ? ' the program landing page' : ' your program landing page'}. Record the sales it
          drives above to credit this affiliate.
        </p>
      </div>
    </section>
  )
}

function DangerZone({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50/40 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Remove affiliate</h2>
          <p className="text-xs text-slate-500">
            Deletes {name} and their referral history. This can't be undone.
          </p>
        </div>
        <Button size="sm" variant="danger" onClick={onConfirm}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </section>
  )
}

/** Record a sale this affiliate drove. The commission preview is exactly what gets
 *  stored — computed from the live program rate and then locked onto the row. */
function RecordSaleDialog({
  loc,
  affiliateId,
  program,
  onClose,
  onRecorded,
}: {
  loc: string
  affiliateId: string
  program: AffiliateProgram | null
  onClose: () => void
  onRecorded: () => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [contactId, setContactId] = useState('')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api
      .contacts(loc)
      .then((r) => active && setContacts(r.contacts))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [loc])

  const dollars = Number(amount)
  const amountCents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0
  const ready = amountCents > 0

  // Mirror server commissionCents so the operator sees exactly what will be locked.
  const previewCommission = (() => {
    if (!program || amountCents <= 0) return null
    const value = Number(program.commission_value)
    if (!Number.isFinite(value) || value <= 0) return 0
    if (program.commission_type === 'flat') return Math.round(value)
    if (program.commission_type === 'percent') return Math.round((amountCents * value) / 100)
    return 0
  })()

  async function save() {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.recordReferral(loc, affiliateId, {
        amountCents,
        description: description.trim() || null,
        contactId: contactId || null,
      })
      await onRecorded()
    } catch {
      setError('Could not record the sale. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Record a sale</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Log a sale this affiliate drove. Commission is set now from the program rate and locked to
            this referral.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="sale-amount">Sale amount ($)</Label>
            <Input
              id="sale-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              autoFocus
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {previewCommission !== null && (
            <div className="flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-sm">
              <span className="text-slate-600">Commission</span>
              <span className="font-semibold tabular-nums text-brand-700">
                {formatMoneyExact(previewCommission)}
              </span>
            </div>
          )}
          <div>
            <Label htmlFor="sale-desc">Description (optional)</Label>
            <Input
              id="sale-desc"
              value={description}
              placeholder="e.g. Growth plan — annual"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="sale-contact">Attribute to contact (optional)</Label>
            <select
              id="sale-contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              <option value="">No contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {contactLabel(c)}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!ready || saving} onClick={() => void save()}>
            {saving ? 'Recording…' : 'Record sale'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteDialog({
  name,
  onClose,
  onConfirm,
}: {
  name: string
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Delete {name}?</h2>
          <p className="mt-1 text-sm text-slate-500">
            This removes the affiliate and every referral and click recorded for them. It can't be
            undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onConfirm()
            }}
          >
            {busy ? 'Deleting…' : 'Delete affiliate'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** A readable label for a contact in the attribution dropdown — name, else the
 *  first email, else a plain fallback. Never fabricates an identity. */
function contactLabel(c: Contact): string {
  if (c.name?.trim()) return c.name.trim()
  const email = c.emails.find((e) => e.trim())
  if (email) return email
  return 'Unnamed contact'
}
