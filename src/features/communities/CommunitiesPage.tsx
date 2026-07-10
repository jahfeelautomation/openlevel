import { Hash, MessageSquare, Plus, Users, UsersRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type CommunityListItem, type Contact, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { CommunityBuilder } from './CommunityBuilder'
import { catalogTotals, statusLabel } from './communities-meta'

/**
 * Communities — build Skool-style group spaces with channels, members, and a
 * post feed. The list view is a KPI band of honest totals (communities, how many
 * are live, total members, total posts) over a grid of community cards; selecting
 * one opens the builder. Every per-community figure is the server-derived rollup —
 * an empty community shows an honest zero, never a flattering estimate.
 */
export function CommunitiesPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [communities, setCommunities] = useState<CommunityListItem[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.communities(loc)
    setCommunities(r.communities)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setSelectedId(null)
    Promise.all([api.communities(loc), api.contacts(loc)])
      .then(([c, con]) => {
        if (!active) return
        setCommunities(c.communities)
        setContacts(con.contacts)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function createCommunity(name: string) {
    if (!loc) return
    const r = await api.createCommunity(loc, { name })
    setCreating(false)
    await refresh()
    setSelectedId(r.community.id)
  }

  if (!loc || status === 'loading') return <PageSpinner />

  // Detail view — the builder for the selected community.
  if (selectedId) {
    return (
      <CommunityBuilder
        loc={loc}
        communityId={selectedId}
        contacts={contacts}
        onBack={() => {
          setSelectedId(null)
          void refresh()
        }}
        onChanged={() => void refresh()}
        onDeleted={() => {
          setSelectedId(null)
          void refresh()
        }}
      />
    )
  }

  const totals = catalogTotals(communities)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Communities</h1>
          <p className="text-xs text-slate-500">
            Build a group space with channels, members, and a post feed.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New community
        </Button>
      </header>

      {/* KPI band — real totals summed from the server-derived rollups */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Kpi
          label="Communities"
          value={String(totals.communities)}
          sub={`${totals.published} published`}
        />
        <Kpi
          label="Published"
          value={String(totals.published)}
          sub={totals.drafts > 0 ? `${totals.drafts} in draft` : 'all live'}
        />
        <Kpi label="Members" value={String(totals.members)} sub="across communities" />
        <Kpi label="Posts" value={String(totals.posts)} sub="shared so far" accent />
      </div>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
        {communities.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <UsersRound className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No communities yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Create your first community — it stays a private draft until you publish it.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New community
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {communities.map((community) => (
              <CommunityCard
                key={community.id}
                community={community}
                onOpen={() => setSelectedId(community.id)}
              />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <NewCommunityDialog onCancel={() => setCreating(false)} onCreate={createCommunity} />
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <div className="bg-white px-5 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          accent ? 'text-emerald-600' : 'text-slate-900',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}

function CommunityCard({
  community,
  onOpen,
}: {
  community: CommunityListItem
  onOpen: () => void
}) {
  const { rollup } = community
  const published = community.status === 'published'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <UsersRound className="h-[18px] w-[18px]" />
        </span>
        <Badge variant={published ? 'green' : 'amber'}>{statusLabel(community.status)}</Badge>
      </div>
      <h3 className="mt-3 line-clamp-1 text-sm font-semibold text-slate-900">{community.name}</h3>
      {/* min-h must equal exactly two text-xs lines (2rem): anything taller
          opens a gap below the clamp that shows a sliver of the third line */}
      <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs text-slate-500">
        {community.description || 'No description yet.'}
      </p>

      <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
        <span className="flex items-center gap-1 tabular-nums">
          <Users className="h-3.5 w-3.5" />
          {rollup.members} member{rollup.members === 1 ? '' : 's'}
        </span>
        <span className="text-slate-300">·</span>
        <span className="flex items-center gap-1 tabular-nums">
          <MessageSquare className="h-3.5 w-3.5" />
          {rollup.posts} post{rollup.posts === 1 ? '' : 's'}
        </span>
        <span className="text-slate-300">·</span>
        <span className="flex items-center gap-1 tabular-nums">
          <Hash className="h-3.5 w-3.5" />
          {rollup.channelCount}
        </span>
      </div>

      {/* Most-active channel — derived, only shown once a channel has real posts */}
      {rollup.topChannel && (
        <p className="mt-2 truncate text-xs text-slate-400">
          Most active: <span className="font-medium text-slate-600">{rollup.topChannel}</span>
        </p>
      )}
    </button>
  )
}

/** Minimal create modal — just a name; channels, members and posts are added in
 *  the builder. The community starts as a private draft. */
function NewCommunityDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await onCreate(name.trim())
    } catch {
      setError('Could not create the community. Please try again.')
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
          <h2 className="text-base font-semibold text-slate-900">New community</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Name it to get started — you'll add channels and members next. It stays a draft until you
            publish.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="new-community-name">Community name</Label>
            <Input
              id="new-community-name"
              value={name}
              autoFocus
              placeholder="e.g. Cash Offer Insiders"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create()
              }}
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!name.trim() || saving}
            onClick={() => void create()}
          >
            {saving ? 'Creating…' : 'Create community'}
          </Button>
        </div>
      </div>
    </div>
  )
}
