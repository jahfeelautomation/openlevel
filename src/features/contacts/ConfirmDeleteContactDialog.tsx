import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button'

/**
 * Confirm before deleting a contact. The copy is deliberately honest: this is a
 * SOFT delete (archive), so we never say "permanently". The contact leaves the
 * book but is restorable from the Archived list, and its notes/tasks/history are
 * kept — exactly what the server does. (We never lie in user-facing copy.)
 */
export function ConfirmDeleteContactDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string
  onCancel: () => void
  /** Archives the contact; the page owns refreshing the list and navigating. */
  onConfirm: () => Promise<void>
}) {
  const [working, setWorking] = useState(false)

  async function confirm() {
    if (working) return
    setWorking(true)
    try {
      await onConfirm()
    } finally {
      setWorking(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Delete this contact?</h2>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-medium text-slate-900">{name}</span> will be removed from your
            contacts. This isn’t permanent — you can bring them back any time from the Archived
            list. Their notes, tasks, and conversation history are kept.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={working}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={working}
            onClick={() => void confirm()}
          >
            <Trash2 className="h-4 w-4" />
            {working ? 'Deleting…' : 'Delete contact'}
          </Button>
        </div>
      </div>
    </div>
  )
}
