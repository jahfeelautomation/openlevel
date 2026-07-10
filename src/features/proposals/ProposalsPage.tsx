import { ArrowLeft, ExternalLink, FileSignature, Plus, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import { type Contact, type Location, type Proposal, api } from '../../lib/api'
import { cn, formatMoney, formatMoneyExact, formatPhone } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { NewProposalDialog } from './NewProposalDialog'
import { ProposalEditor, type ProposalDraft } from './ProposalEditor'
import { ProposalView } from './ProposalView'
import { proposalTotalCents, readLineItems, statusMeta } from './proposals-meta'

function readBrandColor(loc: Location | null): string {
  const c = loc?.branding.color
  return typeof c === 'string' ? c : '#4f46e5'
}

function draftFromProposal(p: Proposal): ProposalDraft {
  return {
    title: p.title,
    contactId: p.contact_id ?? '',
    intro: typeof p.content.intro === 'string' ? p.content.intro : '',
    items: readLineItems(p.content),
    terms: typeof p.content.terms === 'string' ? p.content.terms : '',
  }
}

/**
 * Proposals — itemised quotes a contact can e-sign. A KPI band of real
 * aggregates over the top, then three panes: the proposal list (left), the live
 * proposal document (center) with a Send action + an honest signature block, and
 * the editor (right, drafts only). Every figure — KPIs, line totals, grand
 * total — is DERIVED from the stored line items, never faked. A signature is
 * only ever recorded by the recipient on the public page: this operator screen
 * can send and edit, but it can never forge a "signed".
 */
export function ProposalsPage() {
  const { current } = useTenant()
  const loc = current?.id
  const brandColor = readBrandColor(current)
  const locationName = current?.name ?? 'OpenLevel'

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const [draft, setDraft] = useState<ProposalDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(false)

  // Proposals + contacts for this location. Contacts power the "for" picker and
  // the names shown on each row.
  useEffect(() => {
    if (!loc) return
    let active = true
    setListStatus('loading')
    Promise.all([api.proposals(loc), api.contacts(loc)])
      .then(([pr, con]) => {
        if (!active) return
        setProposals(pr.proposals)
        setContacts(con.contacts)
        setListStatus(pr.proposals.length > 0 ? 'ready' : 'empty')
        setSelectedId((prev) =>
          prev && pr.proposals.some((p) => p.id === prev) ? prev : (pr.proposals[0]?.id ?? null),
        )
      })
      .catch(() => active && setListStatus('empty'))
    return () => {
      active = false
    }
  }, [loc])

  const selected = proposals.find((p) => p.id === selectedId) ?? null

  // Mirror the selected proposal into an editable draft (resets on reselect/save).
  useEffect(() => {
    setDraft(selected ? draftFromProposal(selected) : null)
    setDirty(false)
  }, [selectedId, selected])

  const contactName = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c]))
    return (id: string | null): string | null => {
      if (!id) return null
      const c = byId.get(id)
      if (!c) return null
      return c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'
    }
  }, [contacts])

  // KPI band — all derived from the real rows we loaded.
  const kpis = useMemo(() => {
    const totalOf = (p: Proposal) => proposalTotalCents(readLineItems(p.content))
    const awaiting = proposals.filter((p) => p.status === 'sent' || p.status === 'viewed')
    const signed = proposals.filter((p) => p.status === 'signed')
    return {
      awaiting: awaiting.reduce((a, p) => a + totalOf(p), 0),
      awaitingCount: awaiting.length,
      signed: signed.reduce((a, p) => a + totalOf(p), 0),
      signedCount: signed.length,
      draftCount: proposals.filter((p) => p.status === 'draft').length,
    }
  }, [proposals])

  const editable = selected ? selected.status === 'draft' : false

  function upsert(p: Proposal) {
    setProposals((prev) => prev.map((x) => (x.id === p.id ? p : x)))
  }

  async function handleCreate(input: { title: string; slug: string; contactId?: string | null }) {
    if (!loc) return
    const r = await api.createProposal(loc, input)
    setProposals((prev) => [r.proposal, ...prev])
    setListStatus('ready')
    setSelectedId(r.proposal.id)
    setShowNew(false)
  }

  async function handleSave() {
    if (!loc || !selected || !draft) return
    setSaving(true)
    try {
      const r = await api.updateProposal(loc, selected.id, {
        title: draft.title.trim() || 'Untitled proposal',
        contactId: draft.contactId || null,
        content: {
          ...selected.content,
          intro: draft.intro.trim(),
          line_items: draft.items,
          terms: draft.terms.trim(),
        },
      })
      upsert(r.proposal)
      setDraft(draftFromProposal(r.proposal))
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleSend() {
    if (!loc || !selected) return
    setActing(true)
    try {
      const r = await api.sendProposal(loc, selected.id)
      upsert(r.proposal)
    } finally {
      setActing(false)
    }
  }

  if (listStatus === 'loading') return <PageSpinner />

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* KPI band — honest aggregates over the loaded proposals */}
      <div className="grid grid-cols-3 gap-px border-b border-slate-200 bg-slate-200">
        <Kpi
          label="Out for signature"
          value={formatMoney(kpis.awaiting)}
          sub={`${kpis.awaitingCount} awaiting`}
        />
        <Kpi
          label="Signed"
          value={formatMoney(kpis.signed)}
          sub={`${kpis.signedCount} proposal${kpis.signedCount === 1 ? '' : 's'}`}
          accent
        />
        <Kpi label="Drafts" value={String(kpis.draftCount)} sub="not yet sent" />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail — proposal list. On mobile: full-width when nothing selected; hidden once selected. */}
        <div
          className={cn(
            'w-full flex-col border-r border-slate-200 bg-white lg:flex lg:w-72 lg:shrink-0',
            selectedId ? 'hidden' : 'flex',
          )}
        >
          <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Proposals</h2>
            <Button size="sm" onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" />
              New
            </Button>
          </div>
          <div className="ol-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {listStatus === 'empty' ? (
              <div className="px-3 py-10 text-center">
                <FileSignature className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No proposals yet.</p>
                <p className="text-xs text-slate-400">Create one to quote a contact.</p>
              </div>
            ) : (
              proposals.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  contactName={contactName(p.contact_id)}
                  active={p.id === selectedId}
                  onClick={() => setSelectedId(p.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Center + right — shown full-width on mobile once a proposal is selected */}
        <div
          className={cn(
            'min-w-0 flex-1 flex-col lg:flex',
            selectedId ? 'flex' : 'hidden',
          )}
        >
          {/* Mobile back affordance */}
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            All proposals
          </button>

          {/* Center — proposal document + actions */}
          <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
            {selected && draft ? (
              <>
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="truncate text-base font-semibold text-slate-900">
                      {draft.title.trim() || 'Untitled proposal'}
                    </h1>
                    <Badge variant={statusMeta(selected.status).badge}>
                      {statusMeta(selected.status).label}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {selected.status !== 'draft' && (
                      <a
                        href={`/api/public/proposals/${loc}/${selected.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      >
                        <ExternalLink className="h-4 w-4" />
                        View live
                      </a>
                    )}
                    {selected.status === 'draft' && (
                      <Button
                        size="sm"
                        disabled={acting || dirty || draft.items.length === 0}
                        title={
                          dirty
                            ? 'Save your changes first'
                            : draft.items.length === 0
                              ? 'Add a line item first'
                              : undefined
                        }
                        onClick={() => void handleSend()}
                      >
                        <Send className="h-4 w-4" />
                        {acting ? 'Sending…' : 'Send proposal'}
                      </Button>
                    )}
                  </div>
                </header>

                <div className="ol-scroll min-h-0 flex-1 overflow-y-auto p-4 lg:p-8">
                  <ProposalView
                    locationName={locationName}
                    title={draft.title}
                    contactName={contactName(draft.contactId || null)}
                    intro={draft.intro}
                    items={draft.items}
                    terms={draft.terms}
                    status={selected.status}
                    signerName={selected.signer_name}
                    signedAt={selected.signed_at}
                    brandColor={brandColor}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 text-center">
                <div>
                  <FileSignature className="mx-auto h-9 w-9 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-600">No proposal selected</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Pick a proposal on the left, or create a new one.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right — editor (drafts only) or a locked note */}
          {selected && draft && editable ? (
            <ProposalEditor
              draft={draft}
              contacts={contacts}
              dirty={dirty}
              saving={saving}
              onChange={(next) => {
                setDraft(next)
                setDirty(true)
              }}
              onSave={handleSave}
            />
          ) : (
            /* Locked note: hidden on mobile (center already conveys the status) */
            <div className="hidden w-80 shrink-0 items-center justify-center border-l border-slate-200 bg-white p-6 text-center text-sm text-slate-400 lg:flex">
              {selected
                ? `This proposal is ${statusMeta(selected.status).label.toLowerCase()} and can't be edited.`
                : 'Select a proposal to edit it.'}
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewProposalDialog
          contacts={contacts}
          onCancel={() => setShowNew(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <div className="bg-white px-2.5 py-3 lg:px-5 lg:py-3.5">
      <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold tabular-nums lg:text-xl', accent ? 'text-emerald-600' : 'text-slate-900')}>
        {value}
      </p>
      <p className="min-w-0 truncate text-xs text-slate-400">{sub}</p>
    </div>
  )
}

function ProposalRow({
  proposal,
  contactName,
  active,
  onClick,
}: {
  proposal: Proposal
  contactName: string | null
  active: boolean
  onClick: () => void
}) {
  const meta = statusMeta(proposal.status)
  const total = proposalTotalCents(readLineItems(proposal.content))
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
        active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-900">{proposal.title}</span>
        <Badge variant={meta.badge}>{meta.label}</Badge>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-slate-500">
          {contactName ?? <span className="text-slate-400">No contact</span>}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
          {formatMoneyExact(total)}
        </span>
      </div>
    </button>
  )
}
