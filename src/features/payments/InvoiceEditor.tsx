import { Plus, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import type { Contact, InvoiceItem, Product } from '../../lib/api'
import { formatMoneyExact, formatPhone } from '../../lib/utils'
import { CatalogPicker } from './CatalogPicker'
import { invoiceTotalCents } from './payments-meta'

export interface InvoiceDraft {
  contactId: string
  items: InvoiceItem[]
  notes: string
  dueAt: string
}

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

const blankItem = (): InvoiceItem => ({ description: '', quantity: 1, unit_amount: 0 })

/** Right-pane editor for one invoice. Owns no state — it reflects `draft` and
 *  reports every edit through `onChange`, so the center document re-renders live
 *  (and the derived total updates) as the operator types. */
export function InvoiceEditor({
  draft,
  contacts,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  draft: InvoiceDraft
  contacts: Contact[]
  dirty: boolean
  saving: boolean
  onChange: (next: InvoiceDraft) => void
  onSave: () => void
}) {
  const items = draft.items
  const setItems = (next: InvoiceItem[]) => onChange({ ...draft, items: next })
  const patchItem = (i: number, patch: Partial<InvoiceItem>) =>
    setItems(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  // Drop a saved catalog product onto the invoice as a new line (price in cents
  // copies straight across). The operator can still edit qty or price after.
  const addFromCatalog = (p: Product) =>
    setItems([...items, { description: p.name, quantity: 1, unit_amount: p.price_cents }])

  return (
    <div className="flex w-full flex-col border-t border-slate-200 bg-white lg:h-full lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Invoice details
        </p>
        <Button
          size="sm"
          variant={dirty ? 'brand' : 'outline'}
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>

      <div className="ol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <Label htmlFor="inv-contact">Bill to</Label>
          <select
            id="inv-contact"
            value={draft.contactId}
            onChange={(e) => onChange({ ...draft, contactId: e.target.value })}
            className={selectClass}
          >
            <option value="">— No contact —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="inv-due">Due date</Label>
          <Input
            id="inv-due"
            type="date"
            value={draft.dueAt}
            onChange={(e) => onChange({ ...draft, dueAt: e.target.value })}
          />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">Line items</Label>
            <button
              type="button"
              onClick={() => setItems([...items, blankItem()])}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </button>
          </div>

          <div className="mb-2.5">
            <CatalogPicker onPick={addFromCatalog} />
          </div>

          <div className="space-y-2.5">
            {items.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
                No items yet — add one to bill for it.
              </p>
            )}
            {items.map((it, i) => (
              <div
                key={`item-${i}`}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <input
                    value={it.description}
                    onChange={(e) => patchItem(i, { description: e.target.value })}
                    placeholder="Description"
                    className="h-7 flex-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                    title="Remove item"
                    className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    Qty
                    <input
                      type="number"
                      min={1}
                      value={it.quantity}
                      onChange={(e) =>
                        patchItem(i, { quantity: Math.max(1, Number.parseInt(e.target.value, 10) || 1) })
                      }
                      className="h-7 w-14 rounded border border-slate-200 bg-white px-1.5 text-xs tabular-nums text-slate-800 focus:border-brand-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-1 items-center gap-1 text-[11px] text-slate-500">
                    Unit $
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={it.unit_amount / 100}
                      onChange={(e) =>
                        patchItem(i, {
                          unit_amount: Math.max(0, Math.round((Number.parseFloat(e.target.value) || 0) * 100)),
                        })
                      }
                      className="h-7 w-full rounded border border-slate-200 bg-white px-1.5 text-xs tabular-nums text-slate-800 focus:border-brand-500 focus:outline-none"
                    />
                  </label>
                  <span className="ml-auto shrink-0 text-xs font-medium tabular-nums text-slate-600">
                    {formatMoneyExact(it.quantity * it.unit_amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total</span>
              <span className="text-sm font-bold tabular-nums text-slate-900">
                {formatMoneyExact(invoiceTotalCents(items))}
              </span>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-4">
          <Label htmlFor="inv-notes">Notes</Label>
          <Textarea
            id="inv-notes"
            rows={3}
            value={draft.notes}
            onChange={(e) => onChange({ ...draft, notes: e.target.value })}
            placeholder="Payment terms, thank-you note, etc."
          />
        </div>
      </div>
    </div>
  )
}
