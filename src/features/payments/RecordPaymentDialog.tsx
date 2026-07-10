import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/label'
import { formatMoneyExact } from '../../lib/utils'
import { PAYMENT_METHODS } from './payments-meta'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

/**
 * Confirm recording a payment against an invoice. This is bookkeeping only — it
 * marks how the customer already paid; OpenLevel never charges a card or moves
 * money. The operator chooses the method they were paid by.
 */
export function RecordPaymentDialog({
  number,
  totalCents,
  saving,
  onCancel,
  onConfirm,
}: {
  number: string
  totalCents: number
  saving: boolean
  onCancel: () => void
  onConfirm: (method: string) => void
}) {
  const [method, setMethod] = useState('card')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Record payment</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Mark <span className="font-mono">{number}</span> as paid. This records the payment for
            your books — it doesn't charge anything.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
            <span className="text-sm text-slate-500">Amount</span>
            <span className="text-base font-bold tabular-nums text-slate-900">
              {formatMoneyExact(totalCents)}
            </span>
          </div>

          <div>
            <Label htmlFor="pay-method">Paid by</Label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={selectClass}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => onConfirm(method)}>
            {saving ? 'Recording…' : 'Record payment'}
          </Button>
        </div>
      </div>
    </div>
  )
}
