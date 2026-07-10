import { ArrowLeft, RotateCcw, Search, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageSpinner } from '../../components/ui/spinner'
import { type Contact, api } from '../../lib/api'
import { cn, formatPhone } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { AddContactDialog } from './AddContactDialog'
import { ContactDetail } from './ContactDetail'

export function ContactsPage() {
  const { current } = useTenant()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  // The list pane shows either the live book or the Archived (soft-deleted)
  // contacts. Archived rows are loaded lazily the first time the tab is opened.
  const [view, setView] = useState<'active' | 'archived'>('active')
  const [archived, setArchived] = useState<Contact[]>([])
  const [archivedStatus, setArchivedStatus] = useState<'idle' | 'loading' | 'ready'>('idle')

  const loc = current?.id

  // Save a hand-entered contact, then open its record. A phone/email that
  // matched an existing contact comes back as that same row, so we de-dup the
  // list by id rather than blindly prepending a second card for one person.
  async function handleCreate(input: { name?: string; phone?: string; email?: string }) {
    if (!loc) return
    const { contact } = await api.createContact(loc, input)
    setContacts((prev) => (prev.some((c) => c.id === contact.id) ? prev : [contact, ...prev]))
    setAdding(false)
    navigate(`/contacts/${contact.id}`)
  }

  // A contact was archived from its detail pane: drop it from the live list, drop
  // any loaded Archived cache (it'll re-load fresh next open), and go back to the
  // list so the operator isn't staring at a now-archived record.
  function handleArchived(contact: Contact) {
    setContacts((prev) => prev.filter((c) => c.id !== contact.id))
    setArchivedStatus('idle')
    navigate('/contacts')
  }

  // Restore an archived contact: pull it from the Archived list and put it back
  // at the top of the live book so it's visible immediately.
  async function handleRestore(contact: Contact) {
    if (!loc) return
    const { contact: restored } = await api.restoreContact(loc, contact.id)
    setArchived((prev) => prev.filter((c) => c.id !== restored.id))
    setContacts((prev) => (prev.some((c) => c.id === restored.id) ? prev : [restored, ...prev]))
  }

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    api
      .contacts(loc)
      .then((r) => {
        if (!active) return
        setContacts(r.contacts)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  // Load the Archived list lazily — only when the operator opens that tab, and
  // only if it hasn't loaded yet (status 'idle'). The active→archived view change
  // drives it; after an archive, handleArchived resets status to 'idle' so the
  // next open re-fetches. archivedStatus is read here but deliberately NOT a dep:
  // the effect sets it to 'loading' itself, so listing it would re-trigger the
  // effect, whose cleanup flips active=false and discards our own in-flight
  // fetch — wedging the tab on a spinner forever.
  useEffect(() => {
    if (!loc || view !== 'archived' || archivedStatus !== 'idle') return
    let active = true
    setArchivedStatus('loading')
    api
      .archivedContacts(loc)
      .then((r) => {
        if (!active) return
        setArchived(r.contacts)
        setArchivedStatus('ready')
      })
      .catch(() => active && setArchivedStatus('ready'))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc, view])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return contacts
    return contacts.filter((c) =>
      [c.name ?? '', ...c.phones, ...c.emails].join(' ').toLowerCase().includes(term),
    )
  }, [contacts, q])

  if (!loc) {
    return <EmptyShell message="Select a sub-account to view contacts." />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3.5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Contacts</h1>
          <p className="text-xs text-slate-500">{contacts.length} total</p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <UserPlus className="h-4 w-4" />
          Add contact
        </Button>
      </header>

      {adding && <AddContactDialog onCancel={() => setAdding(false)} onCreate={handleCreate} />}

      <div className="flex min-h-0 flex-1">
        {/* Contact list. On phones the list and the profile share the screen:
            the URL decides which is visible (no id = list, id = profile); from
            lg up both panes render side by side as before. */}
        <div
          className={cn(
            'w-full flex-col border-r border-slate-200 bg-white lg:flex lg:w-80 lg:shrink-0',
            id ? 'hidden' : 'flex',
          )}
        >
          {/* Active / Archived toggle. Archived is the soft-delete bin — where a
              "Deleted" contact goes, and where it's restored from. */}
          <div className="flex gap-1 border-b border-slate-100 p-2">
            <TabButton active={view === 'active'} onClick={() => setView('active')}>
              Contacts
            </TabButton>
            <TabButton active={view === 'archived'} onClick={() => setView('archived')}>
              Archived
            </TabButton>
          </div>

          {view === 'active' && (
            <div className="border-b border-slate-100 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search contacts"
                  className="pl-9"
                />
              </div>
            </div>
          )}

          <div className="ol-scroll min-h-0 flex-1 overflow-y-auto">
            {view === 'active' ? (
              status === 'loading' ? (
                <PageSpinner />
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-slate-400">No contacts found.</p>
              ) : (
                filtered.map((c) => {
                  const name = c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'
                  const active = c.id === id
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => navigate(`/contacts/${c.id}`)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left transition-colors',
                        active ? 'bg-brand-50' : 'hover:bg-slate-50',
                      )}
                    >
                      <Avatar name={name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {formatPhone(c.phones[0]) || c.emails[0] || '—'}
                        </p>
                      </div>
                    </button>
                  )
                })
              )
            ) : archivedStatus === 'loading' ? (
              <PageSpinner />
            ) : archived.length === 0 ? (
              <p className="p-4 text-sm text-slate-400">
                No archived contacts. Deleting a contact moves it here, where you can restore it.
              </p>
            ) : (
              archived.map((c) => {
                const name = c.name ?? formatPhone(c.phones[0]) ?? 'Unknown'
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 border-b border-slate-50 px-3 py-2.5"
                  >
                    <Avatar name={name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-500">{name}</p>
                      <p className="truncate text-xs text-slate-400">
                        {formatPhone(c.phones[0]) || c.emails[0] || '—'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRestore(c)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restore
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div
          className={cn(
            'min-w-0 flex-1 flex-col bg-slate-50 lg:flex',
            id ? 'flex' : 'hidden',
          )}
        >
          {id ? (
            <>
              <button
                type="button"
                onClick={() => navigate('/contacts')}
                className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
                All contacts
              </button>
              <div className="min-h-0 flex-1">
                <ContactDetail locationId={loc} contactId={id} onArchived={handleArchived} />
              </div>
            </>
          ) : (
            <EmptyShell message="Select a contact to see their profile and activity." />
          )}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  )
}

function EmptyShell({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-xs text-sm text-slate-400">{message}</p>
    </div>
  )
}
