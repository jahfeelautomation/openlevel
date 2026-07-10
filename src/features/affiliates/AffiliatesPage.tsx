import { ExternalLink, Handshake, Megaphone, Pencil, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type AffiliateCommissionType,
  type AffiliateManager,
  type AffiliateProgram,
  type AffiliateWithStats,
  api,
} from '../../lib/api'
import { cn, formatMoney } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { CopyButton, hostedUrl } from '../trigger-links/link-ui'
import { AffiliateDetail } from './AffiliateDetail'
import { affiliateBadge, prettyUrl, programRateLabel } from './affiliates-meta'

/**
 * Affiliate Manager — run a referral program: set the commission rate, enroll
 * affiliates, hand each a tracked referral link, record the sales they drive, and
 * settle what's owed. The KPI band and every per-affiliate figure are the server's
 * DERIVED rollup (real COUNTs/SUMs over click + referral rows), so the page can
 * never overstate what exists; a brand-new affiliate reads as an honest zero.
 *
 * Two honesty rules show through the surface. A referral's commission is LOCKED
 * the moment a sale is recorded — editing the rate later never rewrites what an
 * affiliate was already owed. And "record payout" settles APPROVED referrals only
 * (the GHL pending → approved → paid lifecycle) in OpenLevel's ledger; it moves
 * no money, exactly like an invoice's record-payment.
 */
export function AffiliatesPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [data, setData] = useState<AffiliateManager | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [programOpen, setProgramOpen] = useState(false)
  const [addingAffiliate, setAddingAffiliate] = useState(false)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.affiliates(loc)
    setData(r)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setSelectedId(null)
    api
      .affiliates(loc)
      .then((r) => {
        if (!active) return
        setData(r)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function onAffiliateAdded(affiliate: AffiliateWithStats) {
    setAddingAffiliate(false)
    await refresh()
    setSelectedId(affiliate.id) // jump straight into the new affiliate
  }

  if (!loc || status === 'loading' || !data) return <PageSpinner />

  // Detail view — one affiliate, its referral + click feeds, and payout controls.
  if (selectedId) {
    return (
      <AffiliateDetail
        loc={loc}
        affiliateId={selectedId}
        program={data.program}
        onBack={() => {
          setSelectedId(null)
          void refresh()
        }}
        onChanged={() => void refresh()}
        onDeleted={() => {
          setSelectedId(null)
          void refresh()
        }}
      />
    )
  }

  const { program, affiliates, rollup } = data

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Affiliates</h1>
          <p className="text-xs text-slate-500">
            Run a referral program — enroll partners, track their links, and settle commissions.
          </p>
        </div>
        {program ? (
          <Button size="sm" onClick={() => setAddingAffiliate(true)}>
            <Plus className="h-4 w-4" />
            Add affiliate
          </Button>
        ) : (
          <Button size="sm" onClick={() => setProgramOpen(true)}>
            <Plus className="h-4 w-4" />
            Set up program
          </Button>
        )}
      </header>

      {/* KPI band — every figure is the server-derived rollup over real rows. */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-6">
        <Kpi label="Affiliates" value={String(rollup.affiliates)} sub={`${rollup.activeAffiliates} active`} />
        <Kpi label="Clicks" value={String(rollup.clicks)} sub="referral visits" />
        <Kpi label="Referrals" value={String(rollup.referrals)} sub="sales recorded" />
        <Kpi label="Sales volume" value={formatMoney(rollup.salesVolumeCents)} sub="driven by partners" />
        <Kpi label="Commission" value={formatMoney(rollup.commissionCents)} sub="earned" tone="brand" />
        <Kpi
          label="Owed"
          value={formatMoney(rollup.owedCents)}
          sub={`${formatMoney(rollup.pendingCents)} pending · ${formatMoney(rollup.paidCents)} paid`}
          tone={rollup.owedCents > 0 ? 'amber' : 'emerald'}
        />
      </div>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
        <div className="mx-auto max-w-5xl space-y-5">
          {program ? (
            <ProgramCard program={program} onEdit={() => setProgramOpen(true)} />
          ) : (
            <SetupCard onSetup={() => setProgramOpen(true)} />
          )}

          {program &&
            (affiliates.length === 0 ? (
              <EmptyAffiliates onAdd={() => setAddingAffiliate(true)} />
            ) : (
              <AffiliatesTable affiliates={affiliates} onOpen={(a) => setSelectedId(a.id)} />
            ))}
        </div>
      </div>

      {programOpen && (
        <ProgramDialog
          loc={loc}
          program={program}
          onClose={() => setProgramOpen(false)}
          onSaved={async () => {
            setProgramOpen(false)
            await refresh()
          }}
        />
      )}
      {addingAffiliate && program && (
        <AddAffiliateDialog
          loc={loc}
          onClose={() => setAddingAffiliate(false)}
          onAdded={onAffiliateAdded}
        />
      )}
    </div>
  )
}

function Kpi({
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

/** The active program: name, the rate every commission is computed against, where
 *  a referral link sends a visitor, and its status. "Edit program" reopens the dialog. */
function ProgramCard({ program, onEdit }: { program: AffiliateProgram; onEdit: () => void }) {
  const badge = affiliateBadge(program.status)
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Megaphone className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">{program.name}</h2>
            <p className="text-xs text-slate-500">{programRateLabel(program)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit program
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Referral landing page
          </p>
          <p className="truncate text-sm text-slate-600">{prettyUrl(program.landing_url)}</p>
        </div>
        <a
          href={program.landing_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <ExternalLink className="h-4 w-4" />
          Open
        </a>
      </div>
    </section>
  )
}

/** Shown when no program exists yet — the honest entry point. We never invent a
 *  default rate; the operator sets one up before any affiliate can be added. */
function SetupCard({ onSetup }: { onSetup: () => void }) {
  return (
    <section className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Handshake className="h-6 w-6" />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-900">Set up your referral program</p>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Pick a commission rate and where referral links send people. Then enroll affiliates and
          hand each a tracked link — every click and sale is counted honestly.
        </p>
      </div>
      <Button size="sm" onClick={onSetup}>
        <Plus className="h-4 w-4" />
        Create program
      </Button>
    </section>
  )
}

function EmptyAffiliates({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
      <Handshake className="h-8 w-8 text-slate-300" />
      <div>
        <p className="text-sm font-medium text-slate-900">No affiliates yet</p>
        <p className="mt-0.5 text-sm text-slate-500">
          Enroll your first partner — they'll get a tracked referral link right away.
        </p>
      </div>
      <Button size="sm" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        Add affiliate
      </Button>
    </section>
  )
}

/** The affiliate roster — one row per partner, each with its derived stats and a
 *  copy-able referral link. Money columns coerce the pg-string amounts via Number. */
function AffiliatesTable({
  affiliates,
  onOpen,
}: {
  affiliates: AffiliateWithStats[]
  onOpen: (a: AffiliateWithStats) => void
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Affiliates</h2>
        <p className="text-xs text-slate-500">
          {affiliates.length} {affiliates.length === 1 ? 'partner' : 'partners'} — select one to see
          its referrals and record a sale.
        </p>
      </div>
      <div className="ol-scroll overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2.5 font-semibold">Affiliate</th>
              <th className="px-3 py-2.5 font-semibold">Referral link</th>
              <th className="px-3 py-2.5 text-right font-semibold">Clicks</th>
              <th className="px-3 py-2.5 text-right font-semibold">Referrals</th>
              <th className="px-3 py-2.5 text-right font-semibold">Sales</th>
              <th className="px-3 py-2.5 text-right font-semibold">Earned</th>
              <th className="px-5 py-2.5 text-right font-semibold">Owed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {affiliates.map((a) => {
              const earned = Number(a.commission_cents)
              // Owed = approved & unpaid only — pending commission awaits review
              // and is not yet payable (the GHL lifecycle).
              const owed = Math.max(0, Number(a.commission_approved_cents))
              const badge = affiliateBadge(a.status)
              return (
                <tr
                  key={a.id}
                  onClick={() => onOpen(a)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{a.name}</span>
                      {a.status !== 'active' && <Badge variant={badge.variant}>{badge.label}</Badge>}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">{a.code}</span>
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <CopyButton text={hostedUrl(a.ref_url)} label="Copy" />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{a.clicks}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{a.referrals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    {formatMoney(Number(a.sales_volume_cents))}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-900">
                    {formatMoney(earned)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className={owed > 0 ? 'font-semibold text-amber-600' : 'text-slate-400'}>
                      {formatMoney(owed)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Create or edit the location's program. Percent shows a "%" input; flat shows a
 *  dollar input that converts to cents on save (and back on load), so the stored
 *  commission_value is always in the unit the math expects. */
function ProgramDialog({
  loc,
  program,
  onClose,
  onSaved,
}: {
  loc: string
  program: AffiliateProgram | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const editing = !!program
  const [name, setName] = useState(program?.name ?? '')
  const [commissionType, setCommissionType] = useState<AffiliateCommissionType>(
    (program?.commission_type as AffiliateCommissionType) ?? 'percent',
  )
  // For a flat program the stored value is cents; show it as dollars in the input.
  const initialValue = program
    ? program.commission_type === 'flat'
      ? String(Number(program.commission_value) / 100)
      : String(Number(program.commission_value))
    : '10'
  const [value, setValue] = useState(initialValue)
  const [landingUrl, setLandingUrl] = useState(program?.landing_url ?? '')
  const [active, setActive] = useState(program ? program.status === 'active' : true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const numericValue = Number(value)
  const validUrl = /^https?:\/\/.+/i.test(landingUrl.trim())
  const ready = name.trim().length > 0 && validUrl && Number.isFinite(numericValue) && numericValue >= 0

  async function save() {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    // Percent sends the raw percentage; flat sends cents (dollars × 100).
    const commissionValue =
      commissionType === 'flat' ? Math.round(numericValue * 100) : numericValue
    try {
      if (editing && program) {
        await api.updateAffiliateProgram(loc, program.id, {
          name: name.trim(),
          commissionType,
          commissionValue,
          landingUrl: landingUrl.trim(),
          status: active ? 'active' : 'paused',
        })
      } else {
        await api.createAffiliateProgram(loc, {
          name: name.trim(),
          commissionType,
          commissionValue,
          landingUrl: landingUrl.trim(),
        })
      }
      await onSaved()
    } catch {
      setError('Could not save the program. Check the landing page is a full http(s) URL.')
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
          <h2 className="text-base font-semibold text-slate-900">
            {editing ? 'Edit referral program' : 'Set up referral program'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The rate drives new commissions; changing it later never rewrites a referral already
            recorded.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="program-name">Program name</Label>
            <Input
              id="program-name"
              value={name}
              autoFocus
              placeholder="e.g. Partner Referral Program"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="program-type">Commission type</Label>
              <select
                id="program-type"
                value={commissionType}
                onChange={(e) => setCommissionType(e.target.value as AffiliateCommissionType)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                <option value="percent">Percent of sale</option>
                <option value="flat">Flat amount</option>
              </select>
            </div>
            <div>
              <Label htmlFor="program-value">
                {commissionType === 'flat' ? 'Amount ($)' : 'Rate (%)'}
              </Label>
              <Input
                id="program-value"
                type="number"
                min="0"
                step={commissionType === 'flat' ? '0.01' : '1'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>
          {commissionType === 'percent' && Number.isFinite(numericValue) && numericValue > 100 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Over 100% means an affiliate earns more than the sale itself. That's allowed for a
              loss-leader, but double-check the rate before saving.
            </p>
          )}
          <div>
            <Label htmlFor="program-landing">Referral landing page</Label>
            <Input
              id="program-landing"
              value={landingUrl}
              placeholder="https://yoursite.com/offer"
              onChange={(e) => setLandingUrl(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Where a referral link sends a visitor. Must be a full http(s) URL.
            </p>
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
              />
              Program active
            </label>
          )}
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!ready || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : editing ? 'Save program' : 'Create program'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Enroll an affiliate. The referral code is derived from the name when left
 *  blank, and made unique server-side, so the public link always resolves right. */
function AddAffiliateDialog({
  loc,
  onClose,
  onAdded,
}: {
  loc: string
  onClose: () => void
  onAdded: (affiliate: AffiliateWithStats) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const r = await api.createAffiliate(loc, {
        name: name.trim(),
        email: email.trim() || null,
        code: code.trim() || undefined,
      })
      await onAdded(r.affiliate)
    } catch {
      setError('Could not add the affiliate. Please try again.')
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
          <h2 className="text-base font-semibold text-slate-900">Add an affiliate</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            They'll get a tracked referral link immediately. You can record their sales from their
            page.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="affiliate-name">Name</Label>
            <Input
              id="affiliate-name"
              value={name}
              autoFocus
              placeholder="e.g. Sam Smith"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
              }}
            />
          </div>
          <div>
            <Label htmlFor="affiliate-email">Email (optional)</Label>
            <Input
              id="affiliate-email"
              type="email"
              value={email}
              placeholder="marcus@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="affiliate-code">Referral code (optional)</Label>
            <Input
              id="affiliate-code"
              value={code}
              placeholder="Auto-generated from the name"
              onChange={(e) => setCode(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Leave blank to derive it from the name. It's made unique automatically.
            </p>
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!name.trim() || saving} onClick={() => void add()}>
            {saving ? 'Adding…' : 'Add affiliate'}
          </Button>
        </div>
      </div>
    </div>
  )
}

