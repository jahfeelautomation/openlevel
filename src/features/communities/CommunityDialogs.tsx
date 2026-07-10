import { Pin } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import type {
  CommunityChannel,
  CommunityChannelWithCount,
  CommunityMember,
  CommunityPostDetail,
  CommunityRole,
  Contact,
} from '../../lib/api'
import { formatPhone } from '../../lib/utils'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

const ROLES: CommunityRole[] = ['member', 'moderator', 'admin']

function Overlay({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        {children}
      </div>
    </div>
  )
}

function contactLabel(c: Contact): string {
  return c.name ?? formatPhone(c.phones[0]) ?? 'Unknown contact'
}

// --- Channel ---------------------------------------------------------------

export interface ChannelDraft {
  name: string
  slug: string | null
}

/** Create or rename a channel. A channel is just a name; the slug is optional and
 *  auto-derived from the name when left blank. */
export function ChannelDialog({
  channel,
  onCancel,
  onSave,
}: {
  channel?: CommunityChannel
  onCancel: () => void
  onSave: (draft: ChannelDraft) => Promise<void>
}) {
  const [name, setName] = useState(channel?.name ?? '')
  const [slug, setSlug] = useState(channel?.slug ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editing = Boolean(channel)
  const canSave = name.trim().length > 0 && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), slug: slug.trim() ? slug.trim() : null })
    } catch {
      setError('Could not save the channel. Please try again.')
      setSaving(false)
    }
  }

  return (
    <Overlay onCancel={onCancel}>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          {editing ? 'Edit channel' : 'Add channel'}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Channels organize the feed — like General, Wins, or Q&amp;A.
        </p>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div>
          <Label htmlFor="channel-name">Channel name</Label>
          <Input
            id="channel-name"
            value={name}
            autoFocus
            placeholder="e.g. Wins"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
          />
        </div>
        <div>
          <Label htmlFor="channel-slug">URL slug (optional)</Label>
          <Input
            id="channel-slug"
            value={slug}
            placeholder="auto-derived from the name"
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add channel'}
        </Button>
      </div>
    </Overlay>
  )
}

// --- Member ----------------------------------------------------------------

export interface MemberDraft {
  name: string
  email: string | null
  role: CommunityRole
  /** Only sent when adding — ties the member to a CRM contact. */
  contactId: string | null
}

/** Add or edit a member. When adding, you can tie the member to an existing CRM
 *  contact (which prefills their name + email) or just type a name. Editing only
 *  touches name / email / role — the contact link is set once at creation. */
export function MemberDialog({
  member,
  contacts,
  linkedContactIds,
  onCancel,
  onSave,
}: {
  member?: CommunityMember
  contacts: Contact[]
  /** Contacts already a member — hidden from the picker so nobody's added twice. */
  linkedContactIds: Set<string>
  onCancel: () => void
  onSave: (draft: MemberDraft) => Promise<void>
}) {
  const editing = Boolean(member)
  const [contactId, setContactId] = useState('')
  const [name, setName] = useState(member?.name ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [role, setRole] = useState<CommunityRole>(member?.role ?? 'member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = useMemo(
    () =>
      [...contacts]
        .filter((c) => !linkedContactIds.has(c.id))
        .sort((a, b) => contactLabel(a).localeCompare(contactLabel(b))),
    [contacts, linkedContactIds],
  )

  /** Picking a contact prefills the name + email from their record. */
  function pickContact(id: string) {
    setContactId(id)
    const c = contacts.find((x) => x.id === id)
    if (c) {
      setName(c.name ?? '')
      setEmail(c.emails[0] ?? '')
    }
  }

  const canSave = name.trim().length > 0 && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        email: email.trim() ? email.trim() : null,
        role,
        contactId: contactId || null,
      })
    } catch {
      setError('Could not save the member. Please try again.')
      setSaving(false)
    }
  }

  return (
    <Overlay onCancel={onCancel}>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          {editing ? 'Edit member' : 'Add member'}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {editing
            ? 'Update their name, email, or role.'
            : 'Tie them to a CRM contact, or just add a name.'}
        </p>
      </div>
      <div className="space-y-4 px-5 py-4">
        {!editing && available.length > 0 && (
          <div>
            <Label htmlFor="member-contact">Link to a contact (optional)</Label>
            <select
              id="member-contact"
              value={contactId}
              onChange={(e) => pickContact(e.target.value)}
              className={selectClass}
            >
              <option value="">Not linked — just a name</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {contactLabel(c)}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-400">
              Linking prefills their details and records membership on their timeline.
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="member-name">Name</Label>
            <Input
              id="member-name"
              value={name}
              placeholder="e.g. Dana Reed"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="member-role">Role</Label>
            <select
              id="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as CommunityRole)}
              className={selectClass}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="member-email">Email (optional)</Label>
          <Input
            id="member-email"
            value={email}
            placeholder="name@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add member'}
        </Button>
      </div>
    </Overlay>
  )
}

// --- Post ------------------------------------------------------------------

export interface PostDraft {
  channelId: string
  memberId: string | null
  title: string | null
  body: string
  pinned: boolean
}

/**
 * Write or edit a post. A new post picks a channel and an optional author (a
 * member), with a title and body, and can be pinned to the top of the feed.
 * Editing keeps the post in its channel — only the title, body and pinned flag
 * change — so the feed's authorship stays truthful.
 */
export function PostDialog({
  post,
  channels,
  members,
  defaultChannelId,
  onCancel,
  onSave,
}: {
  post?: CommunityPostDetail
  channels: CommunityChannelWithCount[]
  members: CommunityMember[]
  defaultChannelId?: string
  onCancel: () => void
  onSave: (draft: PostDraft) => Promise<void>
}) {
  const editing = Boolean(post)
  const [channelId, setChannelId] = useState(
    post?.channel_id ?? defaultChannelId ?? channels[0]?.id ?? '',
  )
  const [memberId, setMemberId] = useState(post?.member_id ?? '')
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [pinned, setPinned] = useState(post?.pinned ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = body.trim().length > 0 && channelId.length > 0 && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        channelId,
        memberId: memberId || null,
        title: title.trim() ? title.trim() : null,
        body: body.trim(),
        pinned,
      })
    } catch {
      setError('Could not save the post. Please try again.')
      setSaving(false)
    }
  }

  return (
    <Overlay onCancel={onCancel}>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          {editing ? 'Edit post' : 'Write a post'}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {editing
            ? 'Update the title, body, or pin state. The post stays in its channel.'
            : 'Post to a channel as a member. Pin it to keep it at the top.'}
        </p>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="post-channel">Channel</Label>
            {editing ? (
              <Input
                id="post-channel"
                value={channels.find((ch) => ch.id === channelId)?.name ?? 'Channel'}
                disabled
              />
            ) : (
              <select
                id="post-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className={selectClass}
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <Label htmlFor="post-author">Author</Label>
            {editing ? (
              <Input
                id="post-author"
                value={members.find((m) => m.id === memberId)?.name ?? 'No author'}
                disabled
              />
            ) : (
              <select
                id="post-author"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className={selectClass}
              >
                <option value="">No author</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="post-title">Title (optional)</Label>
          <Input
            id="post-title"
            value={title}
            placeholder="e.g. Hit my goal!"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="post-body">Body</Label>
          <Textarea
            id="post-body"
            value={body}
            rows={6}
            placeholder="Write the post. Leave a blank line between paragraphs."
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => setPinned((p) => !p)}
          className="flex items-center gap-2 text-sm text-slate-600"
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded border ${
              pinned ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
            }`}
          >
            {pinned && <Pin className="h-3 w-3" />}
          </span>
          Pin this post to the top of the feed
        </button>
        {error && <p className="text-xs text-rose-500">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Post'}
        </Button>
      </div>
    </Overlay>
  )
}
