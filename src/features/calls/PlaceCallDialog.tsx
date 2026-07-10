import { Phone } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/label'
import type { Contact } from '../../lib/api'
import { formatPhone } from '../../lib/utils'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

function contactLabel(c: Contact): string {
  const name = c.name ?? 'Unknown contact'
  const phone = formatPhone(c.phones[0])
  return phone ? `${name} — ${phone}` : name
}

/**
 * Click-to-call. Picking a contact and calling rings THEM from the business's
 * own number; with Twilio the operator's phone is bridged in once they answer,
 * with Vapi the AI assistant runs the conversation. Contacts without a phone
 * number are listed but disabled — the server refuses them honestly anyway.
 */
export function PlaceCallDialog({
  contacts,
  onCancel,
  onCall,
}: {
  contacts: Contact[]
  onCancel: () => void
  /** Places the call; the page owns the outcome notice. */
  onCall: (contactId: string) => Promise<void>
}) {
  const [contactId, setContactId] = useState('')
  const [calling, setCalling] = useState(false)

  const sorted = useMemo(
    () => [...contacts].sort((a, b) => contactLabel(a).localeCompare(contactLabel(b))),
    [contacts],
  )

  async function call() {
    if (!contactId || calling) return
    setCalling(true)
    await onCall(contactId)
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
          <h2 className="text-base font-semibold text-slate-900">Place a call</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Rings the contact from your business number. With Twilio your phone joins once they
            answer; with Vapi the AI assistant handles the conversation.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="call-contact">Who are you calling?</Label>
            <select
              id="call-contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={selectClass}
            >
              <option value="">Choose a contact…</option>
              {sorted.map((c) => (
                <option key={c.id} value={c.id} disabled={c.phones.length === 0}>
                  {contactLabel(c)}
                  {c.phones.length === 0 ? ' (no phone)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!contactId || calling} onClick={() => void call()}>
            <Phone className="h-4 w-4" />
            {calling ? 'Calling…' : 'Call now'}
          </Button>
        </div>
      </div>
    </div>
  )
}
