import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'

/**
 * Add a contact by hand (the Contacts header button). The operator types any of
 * name / phone / email; at least one is required — the submit stays disabled
 * until then, and the server rejects an all-blank body anyway.
 *
 * Adding a phone (or email) that already belongs to a contact lands on THAT
 * record instead of making a duplicate, so the copy says "Add contact", never
 * "created": the page just navigates to whichever record came back, which is
 * honest whether the save inserted a new row or matched an existing one.
 */
export function AddContactDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  /** Saves the contact; the page owns navigating to the result. */
  onCreate: (input: { name?: string; phone?: string; email?: string }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  const hasInput = Boolean(name.trim() || phone.trim() || email.trim())

  async function save() {
    if (!hasInput || saving) return
    setSaving(true)
    try {
      await onCreate({
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      })
    } finally {
      setSaving(false)
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
          <h2 className="text-base font-semibold text-slate-900">Add contact</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Enter a name, phone, or email. A phone that already belongs to a contact opens that
            record instead of making a duplicate.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="add-name">Name</Label>
            <Input
              id="add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div>
            <Label htmlFor="add-phone">Phone</Label>
            <Input
              id="add-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-0142"
              inputMode="tel"
            />
          </div>
          <div>
            <Label htmlFor="add-email">Email</Label>
            <Input
              id="add-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              inputMode="email"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasInput || saving}
            onClick={() => void save()}
          >
            <UserPlus className="h-4 w-4" />
            {saving ? 'Adding…' : 'Add contact'}
          </Button>
        </div>
      </div>
    </div>
  )
}
