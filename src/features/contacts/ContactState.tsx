import { MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

// The states OpenLevel can text into today. Each one must have a matching legal-
// hours rule in the gateway (the gateway owns the timezone and the 8am-9pm window);
// adding a state here without a gateway rule would just make every text to it block
// as "unknown state". Admin's leads are Arizona and North Carolina, so those are the
// choices for now. Add a state here and its gateway rule together, never one alone.
const STATE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'AZ', label: 'Arizona' },
  { code: 'NC', label: 'North Carolina' },
]

/**
 * The contact-record "State" control. It picks which legal texting window the
 * assistant's send path enforces: a text only goes out between 8am and 9pm in THAT
 * state's own timezone. "Not set" is the honest default. With no state the gateway
 * refuses to send rather than guess a timezone, because an Arizona guess could wave
 * a too-late North Carolina text through (9:30pm in North Carolina is only 6:30pm in
 * Arizona). Choosing a state here only stores it; it never sends anything.
 */
export function ContactState({
  locationId,
  contactId,
  initialState,
}: {
  locationId: string
  contactId: string
  initialState: string | null | undefined
}) {
  const [value, setValue] = useState<string>(initialState ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync when the parent switches to a different contact (the component is
  // reused across selections) so the previous contact's state never lingers.
  useEffect(() => {
    setValue(initialState ?? '')
    setSaved(false)
    setError(null)
  }, [contactId, initialState])

  async function commit(next: string) {
    setValue(next) // optimistic
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      const r = await api.setContactState(locationId, contactId, next || null)
      setValue(r.contact.state ?? '')
      setSaved(true)
    } catch {
      setError('Could not save the state.')
    } finally {
      setBusy(false)
    }
  }

  const id = `contact-state-${contactId}`
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        <MapPin className="h-4 w-4" />
        State
      </div>
      <select
        id={id}
        value={value}
        disabled={busy}
        onChange={(e) => void commit(e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60"
      >
        <option value="">Not set</option>
        {STATE_OPTIONS.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-slate-400">
        Sets the legal texting hours, 8am to 9pm in the contact's own state. With no
        state, the assistant won't text them until you pick one.
      </p>
      {saved ? <p className="mt-1 text-xs font-medium text-emerald-600">Saved.</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  )
}

