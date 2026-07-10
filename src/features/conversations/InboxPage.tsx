import { ArrowLeft, MessageSquare, Phone, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../components/ui/avatar'
import { Badge } from '../../components/ui/badge'
import { PageSpinner } from '../../components/ui/spinner'
import { type Contact, type Conversation, type Message, api } from '../../lib/api'
import { cn, formatPhone, relativeTime } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { Composer } from './Composer'
import { Thread } from './Thread'

export function InboxPage() {
  const { current } = useTenant()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const loc = current?.id

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [contactsById, setContactsById] = useState<Record<string, Contact>>({})
  const [listStatus, setListStatus] = useState<'loading' | 'ready'>('loading')
  const [messages, setMessages] = useState<Message[]>([])
  const [threadStatus, setThreadStatus] = useState<'idle' | 'loading' | 'ready'>('idle')

  const loadConversations = useCallback(async (locId: string) => {
    const [convs, contacts] = await Promise.all([api.conversations(locId), api.contacts(locId)])
    setConversations(convs.conversations)
    setContactsById(Object.fromEntries(contacts.contacts.map((c) => [c.id, c])))
    setListStatus('ready')
  }, [])

  const loadThread = useCallback(async (locId: string, convId: string) => {
    setThreadStatus('loading')
    const r = await api.thread(locId, convId)
    setMessages(r.messages)
    setThreadStatus('ready')
  }, [])

  useEffect(() => {
    if (!loc) return
    setListStatus('loading')
    void loadConversations(loc).catch(() => setListStatus('ready'))
  }, [loc, loadConversations])

  useEffect(() => {
    if (!loc || !id) {
      setMessages([])
      setThreadStatus('idle')
      return
    }
    void loadThread(loc, id).catch(() => setThreadStatus('ready'))
  }, [loc, id, loadThread])

  const nameFor = useCallback(
    (conv: Conversation): string => {
      const c = conv.contact_id ? contactsById[conv.contact_id] : undefined
      return c?.name ?? formatPhone(c?.phones[0]) ?? 'Unknown contact'
    },
    [contactsById],
  )

  const selected = useMemo(() => conversations.find((c) => c.id === id), [conversations, id])
  const selectedContact = selected?.contact_id ? contactsById[selected.contact_id] : undefined

  const onSent = useCallback(() => {
    if (loc && id) void loadThread(loc, id)
    if (loc) void loadConversations(loc)
  }, [loc, id, loadThread, loadConversations])

  if (!loc) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Select a sub-account to view conversations.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3.5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Conversations</h1>
          <p className="text-xs text-slate-500">{conversations.length} open</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Conversation list. On phones the list and the thread share the same
            screen: the URL decides which one is visible (no id = list, id =
            thread); from lg up both panes render side by side as before. */}
        <div
          className={cn(
            'ol-scroll w-full flex-col overflow-y-auto border-r border-slate-200 bg-white lg:flex lg:w-80 lg:shrink-0',
            id ? 'hidden' : 'flex',
          )}
        >
          {listStatus === 'loading' ? (
            <PageSpinner />
          ) : conversations.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No conversations yet.</p>
          ) : (
            conversations.map((conv) => {
              const active = conv.id === id
              const name = nameFor(conv)
              const contact = conv.contact_id ? contactsById[conv.contact_id] : undefined
              return (
                <button
                  type="button"
                  key={conv.id}
                  onClick={() => navigate(`/conversations/${conv.id}`)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-slate-50 px-3 py-3 text-left transition-colors',
                    active ? 'bg-brand-50' : 'hover:bg-slate-50',
                  )}
                >
                  <Avatar name={name} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {relativeTime(conv.last_message_at)}
                      </span>
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {formatPhone(contact?.phones[0]) || 'Contact'}
                    </p>
                    <Badge variant="outline" className="mt-1 capitalize">
                      {conv.channel ?? 'chat'}
                    </Badge>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Thread + composer */}
        <div
          className={cn(
            'min-w-0 flex-1 flex-col bg-slate-50 lg:flex',
            id ? 'flex' : 'hidden',
          )}
        >
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
              <MessageSquare className="h-8 w-8" />
              <p className="text-sm">Select a conversation to open it.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
                <button
                  type="button"
                  onClick={() => navigate('/conversations')}
                  aria-label="Back to conversations"
                  className="-ml-1 shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 lg:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <Avatar name={nameFor(selected)} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{nameFor(selected)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatPhone(selectedContact?.phones[0]) || selected.channel || 'Conversation'}
                  </p>
                </div>
              </div>

              {threadStatus === 'loading' ? <PageSpinner /> : <Thread messages={messages} />}

              <Composer locationId={loc} conversationId={selected.id} onSent={onSent} />
            </>
          )}
        </div>

        {/* Contact side panel */}
        {selected ? (
          <aside className="ol-scroll hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5 lg:block">
            <div className="flex flex-col items-center text-center">
              <Avatar name={nameFor(selected)} size="lg" />
              <p className="mt-3 text-sm font-semibold text-slate-900">{nameFor(selected)}</p>
              <p className="text-xs text-slate-500">
                {selectedContact?.source ? `via ${selectedContact.source}` : 'Contact'}
              </p>
            </div>

            <div className="mt-5 space-y-2">
              <SideRow icon={<Phone className="h-4 w-4" />} label="Phone">
                {formatPhone(selectedContact?.phones[0]) || '—'}
              </SideRow>
              <SideRow icon={<MessageSquare className="h-4 w-4" />} label="Channel">
                <span className="capitalize">{selected.channel ?? '—'}</span>
              </SideRow>
            </div>

            {selectedContact ? (
              <Link
                to={`/contacts/${selectedContact.id}`}
                className="mt-5 flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <UserRound className="h-4 w-4" />
                View full profile
              </Link>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  )
}

function SideRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  )
}
