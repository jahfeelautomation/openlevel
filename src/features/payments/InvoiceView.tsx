import type { InvoiceItem } from '../../lib/api'
import { formatMoneyExact } from '../../lib/utils'
import { invoiceTotalCents } from './payments-meta'

/**
 * The center-pane invoice "document" — a live preview of what the bill looks
 * like. It reflects the editable draft (items/contact/notes) so it updates as
 * the operator types in the right pane. The grand total is derived from the
 * line items here, exactly as the server derives it — nothing about the amount
 * is stored or faked.
 */
export function InvoiceView({
  number,
  locationName,
  contactName,
  items,
  notes,
  dueLabel,
  issuedAt,
  paidAt,
  paymentMethod,
  brandColor,
}: {
  number: string
  locationName: string
  contactName: string | null
  items: InvoiceItem[]
  notes: string | null
  dueLabel: string | null
  issuedAt: string | null
  paidAt: string | null
  paymentMethod: string | null
  brandColor: string
}) {
  const total = invoiceTotalCents(items)
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 pb-6 pt-6 lg:px-8 lg:pt-8">
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold text-white"
            style={{ backgroundColor: brandColor }}
          >
            {locationName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{locationName}</p>
            <p className="text-xs text-slate-400">Invoice</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold text-slate-900">{number}</p>
          {issuedAt && <p className="mt-0.5 text-xs text-slate-400">Issued {fmtDate(issuedAt)}</p>}
          {dueLabel && <p className="text-xs text-slate-400">{dueLabel}</p>}
        </div>
      </div>

      {/* Bill to */}
      <div className="px-4 pt-4 lg:px-8 lg:pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Bill to</p>
        <p className="mt-1 text-sm font-medium text-slate-900">
          {contactName ?? <span className="text-slate-400">No contact selected</span>}
        </p>
      </div>

      {/* Line items */}
      <div className="px-4 py-4 lg:px-8 lg:py-6">
        {/* The table must FIT a phone, not scroll: scrollbars are hidden on
            mobile so a wider-than-viewport table just looks like clipped
            prices. Below lg the Unit column collapses into a sub-line under
            the description (only when qty > 1 — at qty 1 unit === amount). */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="pb-2 font-semibold">Description</th>
              <th className="pb-2 text-center font-semibold">Qty</th>
              <th className="hidden pb-2 text-right font-semibold lg:table-cell">Unit</th>
              <th className="pb-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-slate-400">
                  No line items yet — add one in the editor on the right.
                </td>
              </tr>
            ) : (
              items.map((it, i) => (
                <tr key={`${it.description}-${i}`} className="border-b border-slate-50">
                  <td className="py-2.5 pr-3 text-slate-800">
                    {it.description || <span className="text-slate-400">Untitled item</span>}
                    {it.quantity !== 1 && (
                      <span className="block text-xs tabular-nums text-slate-400 lg:hidden">
                        {it.quantity} × {formatMoneyExact(it.unit_amount)}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-center tabular-nums text-slate-500">{it.quantity}</td>
                  <td className="hidden py-2.5 text-right tabular-nums text-slate-500 lg:table-cell">
                    {formatMoneyExact(it.unit_amount)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-medium text-slate-800">
                    {formatMoneyExact(it.quantity * it.unit_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Total */}
        <div className="mt-4 flex justify-end">
          <div className="w-56">
            <div className="flex items-center justify-between border-t-2 border-slate-900 pt-3">
              <span className="text-sm font-semibold text-slate-900">Total</span>
              <span className="text-lg font-bold tabular-nums text-slate-900">
                {formatMoneyExact(total)}
              </span>
            </div>
            {paidAt && (
              <p className="mt-2 text-right text-xs font-medium text-emerald-600">
                Paid {fmtDate(paidAt)}
                {paymentMethod ? ` · ${paymentMethod.replace('_', ' ')}` : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      {notes && (
        <div className="border-t border-slate-100 px-4 py-4 lg:px-8 lg:py-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{notes}</p>
        </div>
      )}
    </div>
  )
}
