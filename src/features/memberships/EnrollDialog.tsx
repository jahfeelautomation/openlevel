import { Check, Copy, GraduationCap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/label'
import type { Contact } from '../../lib/api'
import { formatPhone } from '../../lib/utils'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

function contactLabel(c: Contact): string {
  return c.name ?? formatPhone(c.phones[0]) ?? 'Unknown contact'
}

/**
 * Enroll a student in a course. Enrolling mints an unguessable tokenized link to
 * the public course player that the operator shares however they like (SMS,
 * email, in person). Nothing is sent from here. The contact is optional — a
 * generic link works for a cohort blast or a QR code — but tying it to a contact
 * records the enrollment on their timeline and lets you track their real progress.
 */
export function EnrollDialog({
  courseTitle,
  contacts,
  enrolledContactIds,
  onCancel,
  onEnroll,
}: {
  courseTitle: string
  contacts: Contact[]
  /** Contacts already enrolled — hidden from the picker so nobody double-enrolls. */
  enrolledContactIds: Set<string>
  onCancel: () => void
  /** Creates the enrollment and returns the full shareable player URL. */
  onEnroll: (contactId: string | null) => Promise<string>
}) {
  const [contactId, setContactId] = useState('')
  const [saving, setSaving] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = useMemo(
    () =>
      [...contacts]
        .filter((c) => !enrolledContactIds.has(c.id))
        .sort((a, b) => contactLabel(a).localeCompare(contactLabel(b))),
    [contacts, enrolledContactIds],
  )

  async function enroll() {
    setSaving(true)
    setError(null)
    try {
      setLink(await onEnroll(contactId || null))
    } catch {
      setError('Could not enroll. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the operator can still select the text manually */
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
          <h2 className="text-base font-semibold text-slate-900">Enroll a student</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {link
              ? 'Share this link with your student. They watch and mark lessons done themselves.'
              : `Add someone to "${courseTitle}". You'll get a private link to their course player.`}
          </p>
        </div>

        {link ? (
          <div className="space-y-4 px-5 py-4">
            <div>
              <Label htmlFor="enroll-link">Course link</Label>
              <div className="flex gap-2">
                <input
                  id="enroll-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-xs text-brand-700">
              <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Opening this link shows the course branded for your business. Their progress updates
              here the moment they complete a lesson.
            </p>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div>
              <Label htmlFor="enroll-contact">Who are you enrolling?</Label>
              <select
                id="enroll-contact"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className={selectClass}
              >
                <option value="">Anyone — a generic link</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {contactLabel(c)}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-400">
                Pick a contact to track their progress, or leave it generic for a cohort link.
              </p>
            </div>
            {error && <p className="text-xs text-rose-500">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          {link ? (
            <Button type="button" size="sm" onClick={onCancel}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void enroll()}>
                {saving ? 'Enrolling…' : 'Enroll & get link'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
