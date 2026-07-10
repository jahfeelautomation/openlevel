import { CheckCircle2, Clock, FileText, XCircle } from 'lucide-react'
import type { ProposalItem } from '../../lib/api'
import { formatMoneyExact } from '../../lib/utils'
import { formatSignedDate, proposalTotalCents } from './proposals-meta'

/**
 * The center-pane proposal "document" — a live preview of exactly what the
 * recipient sees on the public signable page. It reflects the editable draft
 * (title/intro/items/terms) so it updates as the operator types in the right
 * pane. The grand total is derived from the line items here, exactly as the
 * server and the public page derive it — nothing about the amount is stored or
 * faked. The closing block is honest about real state: a draft says "not sent",
 * a signed proposal shows the real typed name + date, a declined one says so.
 */
export function ProposalView({
  locationName,
  title,
  contactName,
  intro,
  items,
  terms,
  status,
  signerName,
  signedAt,
  brandColor,
}: {
  locationName: string
  title: string
  contactName: string | null
  intro: string
  items: ProposalItem[]
  terms: string
  status: string
  signerName: string | null
  signedAt: string | null
  brandColor: string
}) {
  const total = proposalTotalCents(items)

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Letterhead — wraps to column on narrow phones */}
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 pb-5 pt-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4 lg:px-8 lg:pb-6 lg:pt-8">
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
            style={{ backgroundColor: brandColor }}
          >
            {locationName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{locationName}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Proposal</p>
          </div>
        </div>
        {contactName && (
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Prepared for</p>
            <p className="mt-0.5 text-sm font-medium text-slate-900">{contactName}</p>
          </div>
        )}
      </div>

      {/* Title + intro */}
      <div className="px-4 pt-6 lg:px-8 lg:pt-7">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
          {title || <span className="text-slate-400">Untitled proposal</span>}
        </h1>
        {intro.trim() && (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{intro}</p>
        )}
      </div>

      {/* Line items. The table must FIT a phone, not scroll: scrollbars are
          hidden on mobile so a wider-than-viewport table just looks like
          clipped prices. Below lg the Unit column collapses into a sub-line
          under the item (only when qty > 1 — at qty 1 unit === amount). */}
      <div className="px-4 py-5 lg:px-8 lg:py-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="pb-2 font-semibold">Item</th>
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

        {/* Total — derived from the lines above */}
        <div className="mt-4 flex justify-end">
          <div className="w-56">
            <div className="flex items-center justify-between border-t-2 border-slate-900 pt-3">
              <span className="text-sm font-semibold text-slate-900">Total</span>
              <span className="text-lg font-bold tabular-nums text-slate-900">
                {formatMoneyExact(total)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {terms.trim() && (
        <div className="border-t border-slate-100 px-4 py-5 lg:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Terms</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{terms}</p>
        </div>
      )}

      {/* Honest signature block — reflects the real status only */}
      <div className="border-t border-slate-100 px-4 py-5 lg:px-8 lg:py-6">
        <SignBlock status={status} signerName={signerName} signedAt={signedAt} />
      </div>
    </div>
  )
}

/** The closing state, told truthfully. We never show a signature unless the
 *  recipient actually typed one on the public page. */
function SignBlock({
  status,
  signerName,
  signedAt,
}: {
  status: string
  signerName: string | null
  signedAt: string | null
}) {
  if (status === 'signed') {
    const when = formatSignedDate(signedAt)
    return (
      <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3.5">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
        <div>
          <p className="text-sm font-semibold text-emerald-900">Signed</p>
          <p className="text-xs text-emerald-700">
            Signed by <span className="font-medium">{signerName ?? 'the recipient'}</span>
            {when ? ` on ${when}` : ''}.
          </p>
        </div>
      </div>
    )
  }
  if (status === 'declined') {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-rose-50 px-4 py-3.5">
        <XCircle className="h-6 w-6 shrink-0 text-rose-500" />
        <div>
          <p className="text-sm font-semibold text-rose-900">Declined</p>
          <p className="text-xs text-rose-700">The recipient declined this proposal.</p>
        </div>
      </div>
    )
  }
  if (status === 'draft') {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3.5">
        <FileText className="h-6 w-6 shrink-0 text-slate-400" />
        <div>
          <p className="text-sm font-semibold text-slate-700">Not sent yet</p>
          <p className="text-xs text-slate-500">
            Send this proposal to give the recipient a link they can sign.
          </p>
        </div>
      </div>
    )
  }
  // sent / viewed — out for signature
  return (
    <div className="flex items-center gap-3 rounded-xl bg-amber-50 px-4 py-3.5">
      <Clock className="h-6 w-6 shrink-0 text-amber-500" />
      <div>
        <p className="text-sm font-semibold text-amber-900">Awaiting signature</p>
        <p className="text-xs text-amber-700">
          {status === 'viewed'
            ? 'The recipient has opened it — waiting for them to sign.'
            : 'Sent — waiting for the recipient to open and sign it.'}
        </p>
      </div>
    </div>
  )
}
