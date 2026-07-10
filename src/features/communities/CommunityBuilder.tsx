import {
  ArrowLeft,
  ExternalLink,
  Eye,
  Hash,
  Heart,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Send,
  Trash2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Avatar } from '../../components/ui/avatar'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { Textarea } from '../../components/ui/textarea'
import {
  type CommunityDetail,
  type CommunityMember,
  type CommunityPostDetail,
  type Contact,
  api,
} from '../../lib/api'
import { cn, relativeTime } from '../../lib/utils'
import { ChannelDialog, MemberDialog, PostDialog } from './CommunityDialogs'
import { roleBadgeVariant, roleLabel, statusLabel } from './communities-meta'

/**
 * The community builder: curate channels, members, and the post feed, then publish
 * to a hosted page. Every count shown here — member roster size, a channel's post
 * count, a post's likes and comments — is the same server-derived figure the
 * public feed shows, read straight off the detail payload. Publishing only flips a
 * flag; it can't inflate anyone's real engagement. A draft has no public link (its
 * URL honestly 404s), so "View live" only appears once the community is published.
 */
export function CommunityBuilder({
  loc,
  communityId,
  contacts,
  onBack,
  onChanged,
  onDeleted,
}: {
  loc: string
  communityId: string
  contacts: Contact[]
  onBack: () => void
  /** Bubble up so the catalog list + KPI band re-derive after any edit. */
  onChanged: () => void
  onDeleted: () => void
}) {
  const [detail, setDetail] = useState<CommunityDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Dialog state — 'new' to create, a row to edit, null when closed.
  const [channelDialog, setChannelDialog] = useState<CommunityDetail['channels'][number] | 'new' | null>(null)
  const [memberDialog, setMemberDialog] = useState<CommunityMember | 'new' | null>(null)
  const [postDialog, setPostDialog] = useState<CommunityPostDetail | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = useCallback(async () => {
    const d = await api.community(loc, communityId)
    setDetail(d)
    return d
  }, [loc, communityId])

  useEffect(() => {
    let active = true
    setStatus('loading')
    api
      .community(loc, communityId)
      .then((d) => {
        if (!active) return
        setDetail(d)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc, communityId])

  async function afterMutation() {
    await refresh()
    onChanged()
  }

  async function togglePublish() {
    if (!detail) return
    setBusy(true)
    const next = detail.community.status === 'published' ? 'draft' : 'published'
    try {
      await api.updateCommunity(loc, communityId, { status: next })
      await afterMutation()
    } finally {
      setBusy(false)
    }
  }

  async function reallyDelete() {
    setBusy(true)
    try {
      await api.deleteCommunity(loc, communityId)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  const linkedContactIds = useMemo(
    () =>
      new Set(
        (detail?.members ?? [])
          .map((m) => m.contact_id)
          .filter((x): x is string => !!x),
      ),
    [detail],
  )

  if (status === 'loading' || !detail) return <PageSpinner />

  const { community, channels, members, posts } = detail
  const published = community.status === 'published'
  const activeChannel = activeChannelId ? channels.find((ch) => ch.id === activeChannelId) : null
  const visiblePosts = activeChannelId
    ? posts.filter((p) => p.channel_id === activeChannelId)
    : posts
  const defaultChannelId = activeChannelId ?? channels[0]?.id

  // --- channel ops ---
  async function saveChannel(draft: { name: string; slug: string | null }) {
    if (channelDialog === 'new') {
      await api.addCommunityChannel(loc, communityId, {
        name: draft.name,
        slug: draft.slug ?? undefined,
      })
    } else if (channelDialog) {
      await api.updateCommunityChannel(loc, communityId, channelDialog.id, {
        name: draft.name,
        slug: draft.slug ?? undefined,
      })
    }
    setChannelDialog(null)
    await afterMutation()
  }

  async function deleteChannel(id: string) {
    await api.deleteCommunityChannel(loc, communityId, id)
    if (activeChannelId === id) setActiveChannelId(null)
    await afterMutation()
  }

  // --- member ops ---
  async function saveMember(draft: {
    name: string
    email: string | null
    role: CommunityMember['role']
    contactId: string | null
  }) {
    if (memberDialog === 'new') {
      await api.addCommunityMember(loc, communityId, {
        name: draft.name,
        email: draft.email,
        role: draft.role,
        contactId: draft.contactId,
      })
    } else if (memberDialog) {
      await api.updateCommunityMember(loc, communityId, memberDialog.id, {
        name: draft.name,
        email: draft.email,
        role: draft.role,
      })
    }
    setMemberDialog(null)
    await afterMutation()
  }

  async function deleteMember(id: string) {
    await api.deleteCommunityMember(loc, communityId, id)
    await afterMutation()
  }

  // --- post ops ---
  async function savePost(draft: {
    channelId: string
    memberId: string | null
    title: string | null
    body: string
    pinned: boolean
  }) {
    if (postDialog === 'new') {
      await api.addCommunityPost(loc, communityId, {
        channelId: draft.channelId,
        memberId: draft.memberId,
        title: draft.title,
        body: draft.body,
        pinned: draft.pinned,
      })
    } else if (postDialog) {
      await api.updateCommunityPost(loc, communityId, postDialog.id, {
        title: draft.title,
        body: draft.body,
        pinned: draft.pinned,
      })
    }
    setPostDialog(null)
    await afterMutation()
  }

  async function togglePin(post: CommunityPostDetail) {
    await api.pinCommunityPost(loc, communityId, post.id, !post.pinned)
    await afterMutation()
  }

  async function deletePost(id: string) {
    await api.deleteCommunityPost(loc, communityId, id)
    await afterMutation()
  }

  async function addComment(postId: string, body: string, memberId: string | null) {
    await api.addCommunityComment(loc, communityId, postId, { body, memberId })
    await afterMutation()
  }

  async function deleteComment(postId: string, commentId: string) {
    await api.deleteCommunityComment(loc, communityId, postId, commentId)
    await afterMutation()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* flex-wrap lets the Publish button drop below the title row on narrow screens */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Back to communities"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold text-slate-900">{community.name}</h1>
            <Badge variant={published ? 'green' : 'amber'}>{statusLabel(community.status)}</Badge>
          </div>
          <p className="text-xs text-slate-500">
            {channels.length} channel{channels.length === 1 ? '' : 's'} · {members.length} member
            {members.length === 1 ? '' : 's'} · {posts.length} post{posts.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button
          size="sm"
          variant={published ? 'outline' : 'brand'}
          disabled={busy}
          onClick={() => void togglePublish()}
        >
          {published ? 'Unpublish' : 'Publish'}
        </Button>
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50">
        {/* grid-cols-1 (minmax(0,1fr)) is load-bearing on mobile: without it the
            implicit auto track grows to the widest post's max-content and the
            whole builder overflows the 390px viewport */}
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 p-5 lg:grid-cols-[13rem_1fr_19rem]">
          {/* Left: channel rail */}
          <ChannelRail
            channels={channels}
            activeChannelId={activeChannelId}
            totalPosts={posts.length}
            onSelect={setActiveChannelId}
            onAdd={() => setChannelDialog('new')}
            onEdit={(ch) => setChannelDialog(ch)}
            onDelete={(id) => void deleteChannel(id)}
          />

          {/* Center: the post feed */}
          <PostFeed
            posts={visiblePosts}
            members={members}
            channelName={activeChannel?.name ?? null}
            canPost={channels.length > 0}
            onWrite={() => setPostDialog('new')}
            onEdit={(p) => setPostDialog(p)}
            onTogglePin={(p) => void togglePin(p)}
            onDelete={(id) => void deletePost(id)}
            onAddComment={addComment}
            onDeleteComment={deleteComment}
          />

          {/* Right: details, visibility, members, danger */}
          <aside className="flex flex-col gap-5">
            <DetailsCard
              key={community.id}
              community={community}
              onSave={async (patch) => {
                await api.updateCommunity(loc, communityId, patch)
                await afterMutation()
              }}
            />
            <VisibilityCard detail={detail} />
            <MembersCard
              members={members}
              onAdd={() => setMemberDialog('new')}
              onEdit={(m) => setMemberDialog(m)}
              onRemove={(id) => void deleteMember(id)}
            />

            {/* Danger zone */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              {confirmDelete ? (
                <div>
                  <p className="text-sm text-slate-600">
                    Delete <span className="font-medium text-slate-900">{community.name}</span> and
                    all its channels, members and posts? This can't be undone.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => void reallyDelete()}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">Remove this community.</p>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>

      {channelDialog && (
        <ChannelDialog
          channel={channelDialog === 'new' ? undefined : channelDialog}
          onCancel={() => setChannelDialog(null)}
          onSave={saveChannel}
        />
      )}
      {memberDialog && (
        <MemberDialog
          member={memberDialog === 'new' ? undefined : memberDialog}
          contacts={contacts}
          linkedContactIds={linkedContactIds}
          onCancel={() => setMemberDialog(null)}
          onSave={saveMember}
        />
      )}
      {postDialog && (
        <PostDialog
          post={postDialog === 'new' ? undefined : postDialog}
          channels={channels}
          members={members}
          defaultChannelId={defaultChannelId}
          onCancel={() => setPostDialog(null)}
          onSave={savePost}
        />
      )}
    </div>
  )
}

// --- Channel rail ----------------------------------------------------------

function ChannelRail({
  channels,
  activeChannelId,
  totalPosts,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
}: {
  channels: CommunityDetail['channels']
  activeChannelId: string | null
  totalPosts: number
  onSelect: (id: string | null) => void
  onAdd: () => void
  onEdit: (ch: CommunityDetail['channels'][number]) => void
  onDelete: (id: string) => void
}) {
  return (
    <aside className="lg:sticky lg:top-0">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Channels</h2>
          </div>
          <button
            type="button"
            onClick={onAdd}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="Add channel"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="p-1.5">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors',
              activeChannelId === null
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            <span>All channels</span>
            <span className="tabular-nums text-xs text-slate-400">{totalPosts}</span>
          </button>

          {channels.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-slate-400">
              No channels yet. Add one to start the feed.
            </p>
          ) : (
            channels.map((ch) => (
              <div key={ch.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(ch.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors',
                    activeChannelId === ch.id
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Hash className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{ch.name}</span>
                  </span>
                  <span className="tabular-nums text-xs text-slate-400">{ch.postCount}</span>
                </button>
                <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onEdit(ch)}
                    className="rounded bg-white/80 p-1 text-slate-400 hover:text-slate-700"
                    title="Edit channel"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(ch.id)}
                    className="rounded bg-white/80 p-1 text-slate-400 hover:text-rose-600"
                    title="Delete channel"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  )
}

// --- Post feed -------------------------------------------------------------

function PostFeed({
  posts,
  members,
  channelName,
  canPost,
  onWrite,
  onEdit,
  onTogglePin,
  onDelete,
  onAddComment,
  onDeleteComment,
}: {
  posts: CommunityPostDetail[]
  members: CommunityMember[]
  channelName: string | null
  canPost: boolean
  onWrite: () => void
  onEdit: (p: CommunityPostDetail) => void
  onTogglePin: (p: CommunityPostDetail) => void
  onDelete: (id: string) => void
  onAddComment: (postId: string, body: string, memberId: string | null) => Promise<void>
  onDeleteComment: (postId: string, commentId: string) => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-sm font-semibold text-slate-900">
          {channelName ? `# ${channelName}` : 'All posts'}
        </h2>
        <Button size="sm" variant="subtle" disabled={!canPost} onClick={onWrite}>
          <Plus className="h-4 w-4" />
          Write a post
        </Button>
      </div>

      {!canPost ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center">
          <Hash className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">Add a channel first</p>
          <p className="mt-1 text-sm text-slate-400">
            Posts live in channels — create one in the rail to start the feed.
          </p>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">No posts yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Write the first post{channelName ? ` in ${channelName}` : ''} to kick things off.
          </p>
          <Button className="mt-3" size="sm" onClick={onWrite}>
            <Plus className="h-4 w-4" />
            Write a post
          </Button>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            members={members}
            onEdit={() => onEdit(post)}
            onTogglePin={() => onTogglePin(post)}
            onDelete={() => onDelete(post.id)}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
          />
        ))
      )}
    </div>
  )
}

function PostCard({
  post,
  members,
  onEdit,
  onTogglePin,
  onDelete,
  onAddComment,
  onDeleteComment,
}: {
  post: CommunityPostDetail
  members: CommunityMember[]
  onEdit: () => void
  onTogglePin: () => void
  onDelete: () => void
  onAddComment: (postId: string, body: string, memberId: string | null) => Promise<void>
  onDeleteComment: (postId: string, commentId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const author = post.authorName ?? 'Unknown member'

  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <Avatar name={author} size="sm" />
        <div className="min-w-0 flex-1">
          {/* flex-wrap: on a phone the Pinned badge drops to its own line
              instead of overflowing into the action icons */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-slate-800">{author}</span>
            {post.channelName && (
              <span className="flex items-center gap-0.5 text-xs text-slate-400">
                <Hash className="h-3 w-3" />
                {post.channelName}
              </span>
            )}
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-400">{relativeTime(post.created_at)}</span>
            {post.pinned && (
              <Badge variant="brand" className="ml-0.5">
                <Pin className="h-3 w-3" />
                Pinned
              </Badge>
            )}
          </div>
          {post.title && (
            <h3 className="mt-1.5 text-sm font-semibold text-slate-900">{post.title}</h3>
          )}
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">
            {post.body}
          </p>

          {/* Engagement — both figures derived from real rows */}
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1 tabular-nums" title="Likes from members">
              <Heart className="h-3.5 w-3.5" />
              {post.likes}
            </span>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 tabular-nums transition-colors hover:text-slate-700"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {post.comments} comment{post.comments === 1 ? '' : 's'}
            </button>
          </div>
        </div>

        {/* Hover actions */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onTogglePin}
            className={cn(
              'rounded-md p-1.5 transition-colors hover:bg-slate-100',
              post.pinned ? 'text-brand-600' : 'text-slate-400 hover:text-slate-700',
            )}
            title={post.pinned ? 'Unpin' : 'Pin to top'}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="Edit post"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
            title="Delete post"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {open && (
        <CommentThread
          post={post}
          members={members}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
        />
      )}
    </article>
  )
}

const commentSelectClass =
  'h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

function CommentThread({
  post,
  members,
  onAddComment,
  onDeleteComment,
}: {
  post: CommunityPostDetail
  members: CommunityMember[]
  onAddComment: (postId: string, body: string, memberId: string | null) => Promise<void>
  onDeleteComment: (postId: string, commentId: string) => Promise<void>
}) {
  const [body, setBody] = useState('')
  const [memberId, setMemberId] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (!body.trim() || sending) return
    setSending(true)
    try {
      await onAddComment(post.id, body.trim(), memberId || null)
      setBody('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
      {post.commentThread.length > 0 && (
        <ul className="mb-3 space-y-2.5">
          {post.commentThread.map((cm) => (
            <li key={cm.id} className="group flex items-start gap-2.5">
              <Avatar name={cm.authorName ?? 'Member'} size="sm" />
              <div className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-700">
                    {cm.authorName ?? 'Unknown member'}
                  </span>
                  <span className="text-[11px] text-slate-400">{relativeTime(cm.created_at)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{cm.body}</p>
              </div>
              <button
                type="button"
                onClick={() => void onDeleteComment(post.id, cm.id)}
                className="mt-1 shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100"
                title="Delete comment"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* w-24 shrink-0 keeps the author select from eating into the comment input at 390px */}
      <div className="flex items-center gap-2">
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className={cn(commentSelectClass, 'w-24 shrink-0')}
          title="Comment as"
        >
          <option value="">No author</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <Input
          value={body}
          placeholder="Add a comment…"
          className="h-9 min-w-0 flex-1"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
        />
        <Button size="sm" disabled={!body.trim() || sending} onClick={() => void send()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// --- Right column cards -----------------------------------------------------

function DetailsCard({
  community,
  onSave,
}: {
  community: CommunityDetail['community']
  onSave: (patch: { name?: string; description?: string | null }) => Promise<void>
}) {
  const [name, setName] = useState(community.name)
  const [description, setDescription] = useState(community.description ?? '')
  const [saving, setSaving] = useState(false)

  const trimmedName = name.trim()
  const trimmedDesc = description.trim()
  const dirty =
    trimmedName.length > 0 &&
    (trimmedName !== community.name || trimmedDesc !== (community.description ?? ''))

  async function save() {
    if (!dirty) return
    setSaving(true)
    try {
      await onSave({ name: trimmedName, description: trimmedDesc ? trimmedDesc : null })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Community details</h2>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="community-name">Name</Label>
          <Input id="community-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="community-desc">Description</Label>
          <Textarea
            id="community-desc"
            value={description}
            rows={3}
            placeholder="A short summary members see at the top of the space."
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save details'}
          </Button>
        </div>
      </div>
    </section>
  )
}

/** Status, and the honest public link — but only when the community is actually
 *  published. A draft's URL 404s, so we never present it as clickable. */
function VisibilityCard({ detail }: { detail: CommunityDetail }) {
  const published = detail.community.status === 'published'
  const url = `${window.location.origin}${detail.publicUrl}`
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Eye className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900">Visibility</h2>
      </div>
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Status</span>
          <Badge variant={published ? 'green' : 'amber'}>
            {statusLabel(detail.community.status)}
          </Badge>
        </div>
        {published ? (
          <>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              <ExternalLink className="h-4 w-4" />
              View live
            </a>
            <p className="break-all text-xs text-slate-400">{url}</p>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            This community is a private draft. Publish it to get a public link members can open.
          </p>
        )}
      </div>
    </section>
  )
}

function MembersCard({
  members,
  onAdd,
  onEdit,
  onRemove,
}: {
  members: CommunityMember[]
  onAdd: () => void
  onEdit: (m: CommunityMember) => void
  onRemove: (id: string) => void
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900">Members</h2>
          <span className="text-xs text-slate-400">{members.length}</span>
        </div>
        <Button size="sm" variant="subtle" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
      {members.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Users className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">No members yet</p>
          <p className="mt-1 text-sm text-slate-400">Add a member to start the roster.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.id} className="group flex items-center gap-2.5 px-4 py-2.5">
              <Avatar name={m.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{m.name}</p>
                {m.email && <p className="truncate text-xs text-slate-400">{m.email}</p>}
              </div>
              <Badge variant={roleBadgeVariant(m.role)}>{roleLabel(m.role)}</Badge>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onEdit(m)}
                  className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  title="Edit member"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(m.id)}
                  className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  title="Remove member"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
