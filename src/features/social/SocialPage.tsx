import { CalendarClock, Clock, Plus, Send, Share2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type SocialAccount,
  type SocialPlanner,
  type SocialPlatform,
  type SocialPost,
  type SocialPostTargetView,
  api,
} from '../../lib/api'
import { cn, formatTime, relativeTime } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { PostComposer } from './PostComposer'
import {
  ALL_PLATFORMS,
  draftPosts,
  groupPostsByDay,
  platformMeta,
  publishedFirst,
  scheduledByDate,
  statusBadge,
} from './social-meta'

/**
 * Social Planner — plan, schedule and publish posts across channels. The KPI band
 * and every count are the server's derived rollup (real COUNTs over rows), so the
 * page can never overstate what exists. Two honesty rules show through: Connect
 * verifies the channel's ids (Settings > Social) and vault key really build a
 * working publisher and the flag follows the truth in both directions; Publish
 * REALLY pushes through the location's own channels — a post is marked published
 * only when at least one channel accepted it, and each target records its true
 * outcome. There is no fabricated reach or engagement anywhere on this surface.
 */
export function SocialPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [planner, setPlanner] = useState<SocialPlanner | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [composerOpen, setComposerOpen] = useState(false)
  const [editing, setEditing] = useState<SocialPost | null>(null)
  const [addingChannel, setAddingChannel] = useState(false)
  const [connectNote, setConnectNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.social(loc)
    setPlanner(r)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    api
      .social(loc)
      .then((r) => {
        if (!active) return
        setPlanner(r)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  function openNew() {
    setEditing(null)
    setComposerOpen(true)
  }

  function openEdit(post: SocialPost) {
    setEditing(post)
    setComposerOpen(true)
  }

  async function onSaved() {
    setComposerOpen(false)
    setEditing(null)
    await refresh()
  }

  async function connect(account: SocialAccount) {
    if (!loc) return
    const r = await api.connectSocialAccount(loc, account.id)
    setConnectNote(r.ok ? null : (r.message ?? r.reason ?? 'Could not verify this channel.'))
    await refresh()
  }

  async function addChannel(platform: SocialPlatform, handle: string) {
    if (!loc) return
    await api.addSocialAccount(loc, { platform, handle })
    setAddingChannel(false)
    await refresh()
  }

  async function removeChannel(account: SocialAccount) {
    if (!loc) return
    await api.deleteSocialAccount(loc, account.id)
    await refresh()
  }

  if (!loc || status === 'loading' || !planner) return <PageSpinner />

  const { rollup, accounts } = planner
  const scheduled = scheduledByDate(planner.posts)
  const calendar = groupPostsByDay(scheduled, 'scheduled_at')
  const published = publishedFirst(planner.posts)
  const drafts = draftPosts(planner.posts)
  const nextUp = planner.queue[0]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Social Planner</h1>
          <p className="text-xs text-slate-500">
            Plan, schedule, and publish posts across your channels.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" />
          New post
        </Button>
      </header>

      {/* KPI band — every figure is the server-derived rollup */}
      <div className="grid grid-cols-3 gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-6">
        <Kpi label="Posts" value={rollup.total} sub="all time" />
        <Kpi label="Scheduled" value={rollup.scheduled} sub="in the queue" tone="brand" />
        <Kpi label="Published" value={rollup.published} sub="recorded" tone="emerald" />
        <Kpi label="Drafts" value={rollup.draft} sub="not scheduled" />
        <Kpi label="Channels" value={rollup.accounts} sub="connected accounts" />
        <Kpi label="Connected" value={rollup.connected} sub={`of ${rollup.accounts}`} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden xl:grid-cols-[1fr_21rem]">
        {/* Main column — calendar, drafts, published */}
        <div className="ol-scroll min-h-0 overflow-y-auto bg-slate-50 p-5">
          <div className="mx-auto max-w-3xl space-y-6">
            {nextUp && (
              <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
                  <Clock className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
                    Next to go out
                  </p>
                  <p className="truncate text-sm text-slate-700">{nextUp.body}</p>
                </div>
                {nextUp.scheduled_at && (
                  <span className="ml-auto shrink-0 text-xs font-medium tabular-nums text-slate-500">
                    {formatTime(nextUp.scheduled_at)}
                  </span>
                )}
              </div>
            )}

            {drafts.length > 0 && (
              <Section title="Drafts" hint="Not scheduled yet — open one to schedule or publish it.">
                <div className="grid gap-3 sm:grid-cols-2">
                  {drafts.map((post) => (
                    <PostCard key={post.id} post={post} onOpen={() => openEdit(post)} />
                  ))}
                </div>
              </Section>
            )}

            <Section
              title="Content calendar"
              hint="Scheduled posts, grouped by the day they go out."
            >
              {calendar.length === 0 ? (
                <EmptyBlock
                  icon={<CalendarClock className="h-7 w-7 text-slate-300" />}
                  title="Nothing scheduled yet"
                  body="Compose a post and pick a date to fill your calendar."
                  onNew={openNew}
                />
              ) : (
                <div className="space-y-5">
                  {calendar.map((group) => (
                    <div key={group.key}>
                      <div className="mb-2 flex items-center gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {group.label}
                        </h3>
                        <span className="text-xs text-slate-400">
                          {group.posts.length} post{group.posts.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {group.posts.map((post) => (
                          <PostCard key={post.id} post={post} onOpen={() => openEdit(post)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {published.length > 0 && (
              <Section title="Published" hint="Recorded in OpenLevel's ledger — newest first.">
                <div className="grid gap-3 sm:grid-cols-2">
                  {published.map((post) => (
                    <PostCard key={post.id} post={post} onOpen={() => openEdit(post)} />
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>

        {/* Channels sidebar */}
        <aside className="ol-scroll min-h-0 overflow-y-auto border-t border-slate-200 bg-white p-5 xl:border-l xl:border-t-0">
          <ChannelsPanel
            accounts={accounts}
            connected={rollup.connected}
            connectNote={connectNote}
            onAdd={() => setAddingChannel(true)}
            onConnect={connect}
            onRemove={removeChannel}
          />
        </aside>
      </div>

      {composerOpen && (
        <PostComposer
          loc={loc}
          accounts={accounts}
          post={editing ?? undefined}
          onClose={() => {
            setComposerOpen(false)
            setEditing(null)
          }}
          onSaved={onSaved}
        />
      )}

      {addingChannel && (
        <AddChannelDialog onCancel={() => setAddingChannel(false)} onAdd={addChannel} />
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: number
  sub: string
  tone?: 'default' | 'brand' | 'emerald'
}) {
  return (
    <div className="bg-white px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          tone === 'brand' && 'text-brand-600',
          tone === 'emerald' && 'text-emerald-600',
          tone === 'default' && 'text-slate-900',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function ChannelChips({ targets }: { targets: SocialPostTargetView[] }) {
  if (targets.length === 0) {
    return <span className="text-[11px] text-slate-400">No channel</span>
  }
  return (
    <div className="flex items-center gap-1">
      {targets.slice(0, 5).map((t) => {
        const meta = platformMeta(t.platform)
        return (
          <span
            key={t.accountId}
            title={t.handle ?? meta.label}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
              meta.tile,
            )}
          >
            {meta.short}
          </span>
        )
      })}
    </div>
  )
}

function PostCard({ post, onOpen }: { post: SocialPost; onOpen: () => void }) {
  const badge = statusBadge(post.status)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <ChannelChips targets={post.targets} />
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="mt-2 line-clamp-3 min-h-[3.5rem] text-sm text-slate-700">{post.body}</p>
      <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        {post.status === 'published' ? (
          <>
            <Send className="h-3 w-3" />
            <span>Published {relativeTime(post.published_at)}</span>
          </>
        ) : post.status === 'scheduled' && post.scheduled_at ? (
          <>
            <CalendarClock className="h-3 w-3" />
            <span className="tabular-nums">{formatTime(post.scheduled_at)}</span>
          </>
        ) : (
          <span>Draft</span>
        )}
      </div>
    </button>
  )
}

function ChannelsPanel({
  accounts,
  connected,
  connectNote,
  onAdd,
  onConnect,
  onRemove,
}: {
  accounts: SocialAccount[]
  connected: number
  connectNote: string | null
  onAdd: () => void
  onConnect: (a: SocialAccount) => void
  onRemove: (a: SocialAccount) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Channels</h2>
          <p className="text-xs text-slate-500">
            {connected} of {accounts.length} connected
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
          <Share2 className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">No channels yet</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Add a channel to plan posts for it. You can schedule right away.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {accounts.map((a) => {
            const meta = platformMeta(a.platform)
            return (
              <div
                key={a.id}
                className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    meta.tile,
                  )}
                >
                  {meta.short}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{a.handle}</p>
                  <p className="truncate text-xs text-slate-400">{meta.label}</p>
                </div>
                {a.connected ? (
                  <Badge variant="green">Connected</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onConnect(a)}>
                    Connect
                  </Button>
                )}
                <button
                  type="button"
                  title="Remove channel"
                  onClick={() => onRemove(a)}
                  className="rounded-md p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-rose-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Honest disclosure — Connect verifies the channel really resolves; the
          flag is never silently flipped on. */}
      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
        Connect checks that the channel's ids in{' '}
        <Link to="/settings/social" className="font-medium text-brand-600 hover:underline">
          Settings &gt; Social
        </Link>{' '}
        and its access key in the vault really work. Publish pushes through connected channels —
        no reach is ever invented.
      </p>
      {connectNote && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
          {connectNote}
        </p>
      )}
    </div>
  )
}

function EmptyBlock({
  icon,
  title,
  body,
  onNew,
}: {
  icon: React.ReactNode
  title: string
  body: string
  onNew: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
      {icon}
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{body}</p>
      </div>
      <Button size="sm" onClick={onNew}>
        <Plus className="h-4 w-4" />
        New post
      </Button>
    </div>
  )
}

/** Minimal add-channel modal — a platform and a handle. The account starts
 *  honestly unconnected; scheduling for it works immediately. */
function AddChannelDialog({
  onCancel,
  onAdd,
}: {
  onCancel: () => void
  onAdd: (platform: SocialPlatform, handle: string) => Promise<void>
}) {
  const [platform, setPlatform] = useState<SocialPlatform>('facebook')
  const [handle, setHandle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!handle.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await onAdd(platform, handle.trim())
    } catch {
      setError('Could not add the channel. Please try again.')
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
          <h2 className="text-base font-semibold text-slate-900">Add a channel</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Pick the network and the account handle. It starts unconnected — you can still schedule
            posts for it now.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="channel-platform">Network</Label>
            <select
              id="channel-platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {ALL_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {platformMeta(p).label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="channel-handle">Handle</Label>
            <Input
              id="channel-handle"
              value={handle}
              autoFocus
              placeholder="e.g. @jamalbuyshouses"
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
              }}
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!handle.trim() || saving} onClick={() => void add()}>
            {saving ? 'Adding…' : 'Add channel'}
          </Button>
        </div>
      </div>
    </div>
  )
}
