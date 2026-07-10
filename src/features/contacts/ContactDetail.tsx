import { Mail, Phone, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import { type Contact, type TimelineEvent, api } from '../../lib/api'
import { formatPhone } from '../../lib/utils'
import { ConfirmDeleteContactDialog } from './ConfirmDeleteContactDialog'
import { ContactCustomFields } from './ContactCustomFields'
import { ContactState } from './ContactState'
import { ContactTags } from './ContactTags'
import { Notes } from './Notes'
import { Tasks } from './Tasks'
import { Timeline } from './Timeline'

interface Loaded {
  contact: Contact
  timeline: TimelineEvent[]
}

export function ContactDetail({
  locationId,
  contactId,
  onArchived,
}: {
  locationId: string
  contactId: string
  /** Called after the contact is archived, so the page can drop it from the list
   *  and navigate away. Omitted in contexts where deletion isn't offered. */
  onArchived?: (contact: Contact) => void
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let active = true
    setStatus('loading')
    api
      .contact(locationId, contactId)
      .then((r) => {
        if (!active) return
        setData(r)
        setStatus('ready')
      })
      .catch(() => active && setStatus('error'))
    return () => {
      active = false
    }
  }, [locationId, contactId])

  if (status === 'loading') return <PageSpinner label="Loading contact" />
  if (status === 'error' || !data) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">Contact not found.</div>
  }

  const { contact, timeline } = data
  const name = contact.name ?? formatPhone(contact.phones[0]) ?? 'Unknown'

  async function archive() {
    const { contact: archived } = await api.deleteContact(locationId, contactId)
    setConfirming(false)
    onArchived?.(archived)
  }

  return (
    <div className="ol-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <div className="flex items-center gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-slate-900">{name}</h2>
            <p className="text-sm text-slate-500">{contact.source ? `via ${contact.source}` : 'Contact'}</p>
          </div>
          {onArchived && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-rose-600 hover:bg-rose-50"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
        </div>

        {confirming && (
          <ConfirmDeleteContactDialog
            name={name}
            onCancel={() => setConfirming(false)}
            onConfirm={archive}
          />
        )}

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone">
            {contact.phones.length > 0
              ? contact.phones.map((p) => <div key={p}>{formatPhone(p)}</div>)
              : '—'}
          </InfoRow>
          <InfoRow icon={<Mail className="h-4 w-4" />} label="Email">
            {contact.emails.length > 0 ? contact.emails.join(', ') : '—'}
          </InfoRow>
        </div>

        <div className="mt-3">
          <ContactState locationId={locationId} contactId={contactId} initialState={contact.state} />
        </div>

        <div className="mt-3">
          <ContactTags locationId={locationId} contactId={contactId} initialTags={contact.tags} />
        </div>

        <div className="mt-3">
          <ContactCustomFields
            locationId={locationId}
            contactId={contactId}
            initialValues={contact.custom_fields}
          />
        </div>

        <div className="mt-8">
          <Tasks locationId={locationId} contactId={contactId} />
        </div>

        <div className="mt-8">
          <Notes locationId={locationId} contactId={contactId} />
        </div>

        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Activity</h3>
          <Timeline events={timeline} />
        </div>
      </div>
    </div>
  )
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  )
}
