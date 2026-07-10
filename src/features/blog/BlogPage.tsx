import { Calendar, Clock, FileText, Newspaper, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type BlogPostListItem, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { blogTotals, formatDate, statusLabel } from './blog-meta'
import { PostEditor } from './PostEditor'

/**
 * Blog — write posts, publish them to a hosted page, and keep drafts private. The
 * list view is a KPI band of honest totals (posts, how many are live, drafts in
 * progress, total published reading time) over a grid of post cards; selecting a
 * post opens the editor. Every read-time figure is derived from the post's real
 * word count — an empty draft reads as an honest "—", never a flattering estimate.
 */
export function BlogPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [posts, setPosts] = useState<BlogPostListItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.blogPosts(loc)
    setPosts(r.posts)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setSelectedId(null)
    api
      .blogPosts(loc)
      .then((r) => {
        if (!active) return
        setPosts(r.posts)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function createPost(title: string) {
    if (!loc) return
    const r = await api.createBlogPost(loc, { title })
    setCreating(false)
    await refresh()
    setSelectedId(r.post.id)
  }

  if (!loc || status === 'loading') return <PageSpinner />

  // Detail view — the editor for the selected post.
  if (selectedId) {
    return (
      <PostEditor
        loc={loc}
        postId={selectedId}
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

  const totals = blogTotals(posts)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Blog</h1>
          <p className="text-xs text-slate-500">Write posts and publish them to a hosted page.</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New post
        </Button>
      </header>

      {/* KPI band — real totals off the post list; published read time is summed
          from each post's word-count-derived minutes, never a stored figure. */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Kpi label="Posts" value={String(totals.posts)} sub={`${totals.published} published`} />
        <Kpi
          label="Published"
          value={String(totals.published)}
          sub={totals.drafts > 0 ? `${totals.drafts} in draft` : 'all live'}
        />
        <Kpi label="Drafts" value={String(totals.drafts)} sub="not yet public" />
        <Kpi
          label="Reading"
          value={totals.readMinutes > 0 ? `${totals.readMinutes}m` : '—'}
          sub="published, derived"
          accent
        />
      </div>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
        {posts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Newspaper className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No posts yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Write your first post — it stays a private draft until you publish it.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New post
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onOpen={() => setSelectedId(post.id)} />
            ))}
          </div>
        )}
      </div>

      {creating && <NewPostDialog onCancel={() => setCreating(false)} onCreate={createPost} />}
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

function PostCard({ post, onOpen }: { post: BlogPostListItem; onOpen: () => void }) {
  const published = post.status === 'published'
  const liveDate = published ? formatDate(post.published_at) : ''
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <FileText className="h-[18px] w-[18px]" />
        </span>
        <Badge variant={published ? 'green' : 'amber'}>{statusLabel(post.status)}</Badge>
      </div>
      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-slate-900">{post.title}</h3>
      {/* min-h must equal exactly two text-xs lines (2rem): anything taller
          opens a gap below the clamp that shows a sliver of the third line */}
      <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs text-slate-500">
        {post.excerpt || 'No excerpt yet.'}
      </p>

      <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
        <span className="flex items-center gap-1 tabular-nums">
          <Clock className="h-3.5 w-3.5" />
          {post.readingMinutes > 0 ? `${post.readingMinutes} min read` : 'Empty'}
        </span>
        {liveDate && (
          <>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {liveDate}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

/** Minimal create modal — just a title; everything else is edited in the editor. */
function NewPostDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (title: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await onCreate(title.trim())
    } catch {
      setError('Could not create the post. Please try again.')
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
          <h2 className="text-base font-semibold text-slate-900">New post</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Give it a title to get started — you'll write the body next. It stays a draft until you
            publish.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="new-post-title">Post title</Label>
            <Input
              id="new-post-title"
              value={title}
              autoFocus
              placeholder="e.g. How a Cash Offer Actually Works"
              onChange={(e) => setTitle(e.target.value)}
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
            disabled={!title.trim() || saving}
            onClick={() => void create()}
          >
            {saving ? 'Creating…' : 'Create post'}
          </Button>
        </div>
      </div>
    </div>
  )
}
