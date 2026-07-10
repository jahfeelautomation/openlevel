import { ArrowLeft, CheckCircle2, Link2, Plus, Receipt, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import { ApiError, type Contact, type Invoice, type Location, api } from '../../lib/api'
import { cn, dateInputValue, formatMoney, formatMoneyExact, formatPhone } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { InvoiceEditor, type InvoiceDraft } from './InvoiceEditor'
import { InvoiceView } from './InvoiceView'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { dueLabel, invoiceTotalCents, statusMeta } from './payments-meta'

function readBrandColor(loc: Location | null): string {
  const c = loc?.branding.color
  return typeof c === 'string' ? c : '#4f46e5'
}

function draftFromInvoice(inv: Invoice): InvoiceDraft {
  return {
    contactId: inv.contact_id ?? '',
    items: inv.items,
    notes: inv.notes ?? '',
    // Read the due date off the stored timestamp WITHOUT a tz shift, so the
    // editor shows the day that was set and re-saving never walks it backward.
    dueAt: dateInputValue(inv.due_at),
  }
}

/**
 * Payments — invoices billed to contacts. A KPI band of real aggregates over the
 * top, then three panes: the invoice list (left), the live invoice document
 * (center) with Send / Record-payment / Void actions, and the line-item editor
 * (right). Every figure — KPIs, line totals, grand total — is DERIVED from the
 * stored line items, never faked. Recording a payment is bookkeeping only:
 * OpenLevel marks what the customer already paid, it never charges a card.
 */
export function PaymentsPage() {
  const { current } = useTenant()
  const loc = current?.id
  const brandColor = readBrandColor(current)
  const locationName = current?.name ?? 'OpenLevel'

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [draft, setDraft] = useState<InvoiceDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Invoices + contacts for this location. Contacts power the bill-to picker and
  // the names shown on each row.
  useEffect(() => {
    if (!loc) return
    let active = true
    setListStatus('loading')
    Promise.all([api.invoices(loc), api.contacts(loc)])
      .then(([inv, con]) => {
        if (!active) return
        setInvoices(inv.invoices)
        setContacts(con.contacts)
        setListStatus(inv.invoices.length > 0 ? 'ready' : 'empty')
        setSelectedId((prev) =>
          prev && inv.invoices.some((i) => i.id === prev) ? prev : (inv.invoices[0]?.id ?? null),
        )
      })
      .catch(() => active && setListStatus('empty'))
    return () => {
      active = false
    }
  }, [loc])

  const selected = invoices.find((i) => i.id === selectedId) ?? null

  // Mirror the selected invoice into an editable draft (resets on reselect/save).
  useEffect(() => {
    setDraft(selected ? draftFromInvoice(selected) : null)
    setDirty(false)
    setLinkError(null)
    setCopied(false)
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
    const sum = (s: string) =>
      invoices.filter((i) => i.status === s).reduce((a, i) => a + invoiceTotalCents(i.items), 0)
    const count = (s: string) => invoices.filter((i) => i.status === s).length
    return {
      outstanding: sum('sent'),
      outstandingCount: count('sent'),
      paid: sum('paid'),
      paidCount: count('paid'),
      draftCount: count('draft'),
    }
  }, [invoices])

  const editable = selected ? selected.status === 'draft' || selected.status === 'sent' : false

  function upsert(inv: Invoice) {
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? inv : i)))
  }

  async function handleNew() {
    if (!loc) return
    const r = await api.createInvoice(loc, {})
    setInvoices((prev) => [r.invoice, ...prev])
    setListStatus('ready')
    setSelectedId(r.invoice.id)
  }

  async function handleSave() {
    if (!loc || !selected || !draft) return
    setSaving(true)
    try {
      const r = await api.updateInvoice(loc, selected.id, {
        contactId: draft.contactId || null,
        items: draft.items,
        notes: draft.notes.trim() || null,
        dueAt: draft.dueAt || null,
      })
      upsert(r.invoice)
      setDraft(draftFromInvoice(r.invoice))
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleSend() {
    if (!loc || !selected) return
    setActing(true)
    try {
      const r = await api.sendInvoice(loc, selected.id)
      upsert(r.invoice)
    } finally {
      setActing(false)
    }
  }

  async function handleRecord(method: string) {
    if (!loc || !selected) return
    setActing(true)
    try {
      const r = await api.recordInvoicePayment(loc, selected.id, method)
      upsert(r.invoice)
      setRecording(false)
    } finally {
      setActing(false)
    }
  }

  async function handleVoid() {
    if (!loc || !selected) return
    setActing(true)
    try {
      const r = await api.voidInvoice(loc, selected.id)
      upsert(r.invoice)
    } finally {
      setActing(false)
    }
  }

  // Mint a hosted checkout link inside the location's OWN processor account.
  // A 409 carries the honest reason (usually: no processor connected yet).
  async function handleCheckoutLink() {
    if (!loc || !selected) return
    setActing(true)
    setLinkError(null)
    try {
      const r = await api.createCheckoutLink(loc, selected.id)
      upsert(r.invoice)
      await copyToClipboard(r.checkoutUrl)
    } catch (e) {
      setLinkError(e instanceof ApiError ? e.message : 'Could not create the payment link.')
    } finally {
      setActing(false)
    }
  }

  async function copyToClipboard(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard can be unavailable (permissions, http) — the link is still
      // visible on the invoice, so this is best-effort only.
    }
  }

  if (listStatus === 'loading') return <PageSpinner />

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* KPI band — honest aggregates over the loaded invoices.
          2-up on phones (Drafts wraps to row 2), 3-up on desktop. */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-3">
        <Kpi label="Outstanding" value={formatMoney(kpis.outstanding)} sub={`${kpis.outstandingCount} sent`} />
        <Kpi label="Paid" value={formatMoney(kpis.paid)} sub={`${kpis.paidCount} invoice${kpis.paidCount === 1 ? '' : 's'}`} accent />
        <Kpi label="Drafts" value={String(kpis.draftCount)} sub="not yet sent" />
      </div>

      {/* Three-pane layout: on mobile only ONE pane is visible at a time.
          List is shown when nothing is selected; center+right when selected. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left rail — invoice list */}
        <div
          className={cn(
            'w-full flex-col border-r border-slate-200 bg-white lg:flex lg:w-72 lg:shrink-0',
            selectedId ? 'hidden' : 'flex',
          )}
        >
          <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Invoices</h2>
            <Button size="sm" onClick={() => void handleNew()}>
              <Plus className="h-4 w-4" />
              New
            </Button>
          </div>
          <div className="ol-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {listStatus === 'empty' ? (
              <div className="px-3 py-10 text-center">
                <Receipt className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No invoices yet.</p>
                <p className="text-xs text-slate-400">Create one to bill a contact.</p>
              </div>
            ) : (
              invoices.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  invoice={inv}
                  contactName={contactName(inv.contact_id)}
                  active={inv.id === selectedId}
                  onClick={() => setSelectedId(inv.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Center + right — stacked on mobile, side-by-side on desktop.
            Hidden on mobile when no invoice is selected (list is shown instead). */}
        <div
          className={cn(
            'min-w-0 flex-1 flex-col lg:flex lg:flex-row',
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
            All invoices
          </button>

          {/* Center — invoice document + actions */}
          <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
            {selected && draft ? (
              <>
                {/* Toolbar — wraps on phones so no button is clipped */}
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="truncate font-mono text-base font-semibold text-slate-900">
                      {selected.number}
                    </h1>
                    <Badge variant={statusMeta(selected.status).badge}>
                      {statusMeta(selected.status).label}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                        {acting ? 'Sending…' : 'Send invoice'}
                      </Button>
                    )}
                    {selected.status === 'sent' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acting || dirty}
                          title={
                            dirty
                              ? 'Save your changes first'
                              : selected.checkout_url
                                ? 'Copy the hosted checkout link'
                                : 'Create a hosted checkout link in your processor account'
                          }
                          onClick={() =>
                            selected.checkout_url
                              ? void copyToClipboard(selected.checkout_url)
                              : void handleCheckoutLink()
                          }
                        >
                          <Link2 className="h-4 w-4" />
                          {copied
                            ? 'Link copied'
                            : selected.checkout_url
                              ? 'Copy pay link'
                              : acting
                                ? 'Creating…'
                                : 'Payment link'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={acting || dirty}
                          title={dirty ? 'Save your changes first' : undefined}
                          onClick={() => setRecording(true)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Record payment
                        </Button>
                      </>
                    )}
                    {editable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={acting || dirty}
                        onClick={() => void handleVoid()}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                </header>

                {linkError ? (
                  <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
                    {linkError}
                    {/no payment provider|not connected|not configured/i.test(linkError) ? (
                      <>
                        {' — '}
                        <Link to="/settings/payments" className="font-semibold underline">
                          connect a processor in Settings
                        </Link>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <div className="ol-scroll min-h-0 flex-1 overflow-y-auto p-4 lg:p-8">
                  <InvoiceView
                    number={selected.number}
                    locationName={locationName}
                    contactName={contactName(draft.contactId || null)}
                    items={draft.items}
                    notes={draft.notes.trim() || null}
                    dueLabel={dueLabel(draft.dueAt || null)?.text ?? null}
                    issuedAt={selected.issued_at}
                    paidAt={selected.paid_at}
                    paymentMethod={selected.payment_method}
                    brandColor={brandColor}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 text-center">
                <div>
                  <Receipt className="mx-auto h-9 w-9 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-600">No invoice selected</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Pick an invoice on the left, or create a new one.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right — editor (when editable) or a locked note */}
          {selected && draft && editable ? (
            <InvoiceEditor
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
            <div className="flex w-full items-center justify-center border-t border-slate-200 bg-white p-6 text-center text-sm text-slate-400 lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
              {selected
                ? `This invoice is ${statusMeta(selected.status).label.toLowerCase()} and can't be edited.`
                : 'Select an invoice to edit it.'}
            </div>
          )}
        </div>
      </div>

      {recording && selected && (
        <RecordPaymentDialog
          number={selected.number}
          totalCents={invoiceTotalCents(draft?.items ?? selected.items)}
          saving={acting}
          onCancel={() => setRecording(false)}
          onConfirm={(method) => void handleRecord(method)}
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
    <div className="bg-white px-5 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-xl font-bold tabular-nums', accent ? 'text-emerald-600' : 'text-slate-900')}>
        {value}
      </p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}

function InvoiceRow({
  invoice,
  contactName,
  active,
  onClick,
}: {
  invoice: Invoice
  contactName: string | null
  active: boolean
  onClick: () => void
}) {
  const meta = statusMeta(invoice.status)
  const due = dueLabel(invoice.due_at)
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
        <span className="truncate font-mono text-xs font-semibold text-slate-700">
          {invoice.number}
        </span>
        <Badge variant={meta.badge}>{meta.label}</Badge>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-900">
          {contactName ?? <span className="text-slate-400">No contact</span>}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
          {formatMoneyExact(invoiceTotalCents(invoice.items))}
        </span>
      </div>
      {invoice.status !== 'paid' && invoice.status !== 'void' && due && (
        <p className={cn('mt-0.5 text-xs', due.overdue ? 'text-rose-500' : 'text-slate-400')}>
          {due.text}
        </p>
      )}
    </button>
  )
}
