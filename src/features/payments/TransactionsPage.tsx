import { Banknote, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type Contact,
  type Transaction,
  type TransactionSummary,
  api,
} from '../../lib/api'
import { cn, formatMoneyExact, formatPhone } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { methodMeta } from './transactions-meta'

const EMPTY_SUMMARY: TransactionSummary = {
  count: 0,
  grossCents: 0,
  thisMonthCents: 0,
  byMethod: [],
}

/** A full date label for a recorded-on line, e.g. "Jun 5, 2026". */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Transactions — the recorded-payment ledger (the GHL "Payments → Transactions"
 * area). This page is READ-ONLY by design: every row is a paid invoice projected
 * into a payment, and each amount is DERIVED server-side from that invoice's line
 * items, so the ledger can never show a dollar the invoices don't justify. There
 * is no charge button here and never will be — OpenLevel does not move money. A
 * transaction exists only because an operator recorded a payment on an invoice;
 * this screen simply reads those back, rolled up by method and by month.
 */
export function TransactionsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<TransactionSummary>(EMPTY_SUMMARY)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [method, setMethod] = useState<string>('all')

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setMethod('all')
    Promise.all([api.transactions(loc), api.contacts(loc)])
      .then(([t, c]) => {
        if (!active) return
        setTransactions(t.transactions)
        setSummary(t.summary)
        setContacts(c.contacts)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  const contactName = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c]))
    return (id: string | null): string | null => {
      if (!id) return null
      const c = byId.get(id)
      if (!c) return null
      return c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'
    }
  }, [contacts])

  if (!loc || status === 'loading') return <PageSpinner label="Loading transactions" />

  const visible = method === 'all' ? transactions : transactions.filter((t) => t.method === method)

  const filters: { key: string; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: summary.count },
    ...summary.byMethod.map((m) => ({
      key: m.method,
      label: methodMeta(m.method).label,
      count: m.count,
    })),
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* KPI band — honest aggregates DERIVED from the projected payment rows */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Kpi label="Payments" value={String(summary.count)} sub="recorded" />
        <Kpi
          label="Collected"
          value={formatMoneyExact(summary.grossCents)}
          sub="all time"
          accent
        />
        <Kpi label="This month" value={formatMoneyExact(summary.thisMonthCents)} sub="recorded" />
        <Kpi label="Methods" value={String(summary.byMethod.length)} sub="in use" />
      </div>

      <header className="border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-base font-semibold text-slate-900">Transactions</h1>
        <p className="text-xs text-slate-500">
          Every payment you have recorded on an invoice, newest first. OpenLevel never charges a
          card or moves money — this ledger only reflects payments you marked as received.
        </p>
        {summary.byMethod.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {summary.byMethod.map((m) => (
              <span
                key={m.method}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs"
              >
                <Badge variant={methodMeta(m.method).badge}>{methodMeta(m.method).label}</Badge>
                <span className="font-semibold tabular-nums text-slate-700">
                  {formatMoneyExact(m.cents)}
                </span>
                <span className="tabular-nums text-slate-400">
                  · {m.count} {m.count === 1 ? 'payment' : 'payments'}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-4xl">
          {transactions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <Banknote className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No recorded payments yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
                When you record a payment on an invoice, it appears here. OpenLevel never charges a
                card — this ledger only reflects payments you mark as received.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {filters.length > 1 ? (
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    {filters.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setMethod(f.key)}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                          method === f.key
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700',
                        )}
                      >
                        {f.label}
                        <span className="ml-1 tabular-nums text-slate-400">{f.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="ol-scroll overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 font-semibold">Customer</th>
                      <th className="px-4 py-2.5 font-semibold">Invoice</th>
                      <th className="px-4 py-2.5 font-semibold">Method</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {visible.map((t) => {
                      const meta = methodMeta(t.method)
                      const name = contactName(t.contact_id)
                      return (
                        <tr key={t.invoice_id} className="hover:bg-slate-50/60">
                          <td className="whitespace-nowrap px-4 py-3 text-slate-500 tabular-nums">
                            {formatDate(t.paid_at)}
                          </td>
                          <td className="px-4 py-3">
                            {name ? (
                              <span className="font-medium text-slate-800">{name}</span>
                            ) : (
                              <span className="italic text-slate-400">No contact</span>
                            )}
                          </td>
                          {/* nowrap: an invoice number split across lines ("INV-" / "1001")
                              reads as a broken cell, not a wrapped one */}
                          <td className="whitespace-nowrap px-4 py-3">
                            <span className="inline-flex items-center gap-1.5 text-slate-500">
                              <FileText className="h-3.5 w-3.5 text-slate-300" />
                              <span className="tabular-nums">{t.invoice_number}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={meta.badge}>{meta.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                            {formatMoneyExact(t.amount_cents)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {visible.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-slate-400">
                  No {methodMeta(method).label.toLowerCase()} payments — switch to All to see every
                  recorded payment.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
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
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          accent ? 'text-emerald-600' : 'text-slate-900',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}
