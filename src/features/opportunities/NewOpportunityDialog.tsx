import { type FormEvent, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { Contact, NewOpportunity, Stage } from '../../lib/api'
import { formatPhone } from '../../lib/utils'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

/** Modal to create a deal. Pre-selects the column the "+" was clicked from. */
export function NewOpportunityDialog({
  stages,
  contacts,
  defaultStageId,
  onCancel,
  onCreate,
}: {
  stages: Stage[]
  contacts: Contact[]
  defaultStageId: string
  onCancel: () => void
  onCreate: (input: Omit<NewOpportunity, 'pipelineId'>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [stageId, setStageId] = useState(defaultStageId)
  const [contactId, setContactId] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    const valueCents = Math.round((Number.parseFloat(value) || 0) * 100)
    try {
      await onCreate({ name: name.trim(), stageId, valueCents, contactId: contactId || null })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">New opportunity</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="opp-name">Name</Label>
            <Input
              id="opp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 482 Oakland Ave"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="opp-value">Value (USD)</Label>
              <Input
                id="opp-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                placeholder="185000"
              />
            </div>
            <div>
              <Label htmlFor="opp-stage">Stage</Label>
              <select
                id="opp-stage"
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className={selectClass}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="opp-contact">Contact (optional)</Label>
            <select
              id="opp-contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={selectClass}
            >
              <option value="">— None —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!name.trim() || saving}>
            {saving ? 'Creating…' : 'Create opportunity'}
          </Button>
        </div>
      </form>
    </div>
  )
}
