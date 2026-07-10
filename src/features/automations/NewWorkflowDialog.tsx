import { type FormEvent, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { NewWorkflow, TriggerType } from '../../lib/api'
import { TRIGGERS, triggerMeta } from './automation-meta'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

/** Create a workflow: name it and pick the trigger that starts it. Steps are
 *  added afterward in the builder. */
export function NewWorkflowDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (input: NewWorkflow) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<TriggerType>('contact_created')
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onCreate({ name: name.trim(), triggerType })
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
          <h2 className="text-base font-semibold text-slate-900">New workflow</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="wf-name">Workflow name</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New lead welcome"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="wf-trigger">Trigger</Label>
            <select
              id="wf-trigger"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as TriggerType)}
              className={selectClass}
            >
              {TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {triggerMeta(t).label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-500">
              The event that enrolls a contact into this workflow.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!name.trim() || saving}>
            {saving ? 'Creating…' : 'Create workflow'}
          </Button>
        </div>
      </form>
    </div>
  )
}
