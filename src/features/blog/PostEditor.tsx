import { ArrowLeft, Calendar, Clock, ExternalLink, Eye, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { Textarea } from '../../components/ui/textarea'
import { type BlogPostListItem, type BlogPostPatch, api } from '../../lib/api'
import { formatDate, statusLabel } from './blog-meta'

/**
 * The post editor: edit a post's fields, flip it between draft and published, and
 * jump to its live page. The read time shown here is the same word-count-derived
 * figure the public page shows — read straight off the decorated row, never padded.
 * A draft has no public link (its URL honestly 404s), so "View live" only appears
 * once the post is published.
 */
export function PostEditor({
  loc,
  postId,
  onBack,
  onChanged,
  onDeleted,
}: {
  loc: string
  postId: string
  onBack: () => void
  /** Bubble up so the list + KPI band re-derive after any edit. */
  onChanged: () => void
  onDeleted: () => void
}) {
  const [post, setPost] = useState<BlogPostListItem | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const r = await api.blogPost(loc, postId)
    setPost(r.post)
    return r.post
  }, [loc, postId])

  useEffect(() => {
    let active = true
    setStatus('loading')
    api
      .blogPost(loc, postId)
      .then((r) => {
        if (!active) return
        setPost(r.post)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc, postId])

  async function afterMutation() {
    await refresh()
    onChanged()
  }

  async function togglePublish() {
    if (!post) return
    setBusy(true)
    const next = post.status === 'published' ? 'draft' : 'published'
    try {
      await api.updateBlogPost(loc, postId, { status: next })
      await afterMutation()
    } finally {
      setBusy(false)
    }
  }

  async function reallyDelete() {
    setBusy(true)
    try {
      await api.deleteBlogPost(loc, postId)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading' || !post) return <PageSpinner />

  const published = post.status === 'published'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Back to posts"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold text-slate-900">{post.title}</h1>
            <Badge variant={published ? 'green' : 'amber'}>{statusLabel(post.status)}</Badge>
          </div>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <Clock className="h-3 w-3" />
            {post.readingMinutes > 0 ? `${post.readingMinutes} min read` : 'No body yet'}
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
        {/* grid-cols-1 (minmax(0,1fr)) keeps the implicit mobile track from
            growing to max-content and overflowing the viewport */}
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_18rem]">
          {/* Left: the editable post */}
          <div className="flex flex-col gap-5">
            <PostDetailsCard
              key={post.id}
              post={post}
              onSave={async (patch) => {
                await api.updateBlogPost(loc, postId, patch)
                await afterMutation()
              }}
            />

            {/* Danger zone */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              {confirmDelete ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">
                    Delete <span className="font-medium text-slate-900">{post.title}</span>? This
                    can't be undone.
                  </p>
                  <div className="flex shrink-0 gap-2">
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
                      Delete post
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">Remove this post permanently.</p>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4" />
                    Delete post
                  </Button>
                </div>
              )}
            </section>
          </div>

          {/* Right: visibility + the honest public link */}
          <aside className="lg:sticky lg:top-0">
            <VisibilityCard post={post} />
          </aside>
        </div>
      </div>
    </div>
  )
}

/** Status, the live date, and the public link — but only when the post is actually
 *  published. A draft's URL honestly 404s, so we never present it as clickable. */
function VisibilityCard({ post }: { post: BlogPostListItem }) {
  const published = post.status === 'published'
  const liveDate = formatDate(post.published_at)
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Eye className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900">Visibility</h2>
      </div>
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Status</span>
          <Badge variant={published ? 'green' : 'amber'}>{statusLabel(post.status)}</Badge>
        </div>

        {published ? (
          <>
            {liveDate && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Published</span>
                <span className="flex items-center gap-1 text-slate-700">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  {liveDate}
                </span>
              </div>
            )}
            <a
              href={post.link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              <ExternalLink className="h-4 w-4" />
              View live
            </a>
            <p className="break-all text-xs text-slate-400">{post.link}</p>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            This post is a private draft. Publish it to get a public link visitors can open.
          </p>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-500">Read time</span>
          <span className="flex items-center gap-1 tabular-nums text-slate-700">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            {post.readingMinutes > 0 ? `${post.readingMinutes} min` : '—'}
          </span>
        </div>
      </div>
    </section>
  )
}

/** The editable post: title, slug, author, excerpt, cover image, and body. The
 *  Save button only lights up when a field actually differs from what's stored, so
 *  there's no phantom-save. The read time isn't edited here — it's always derived
 *  from the body the visitor will read. */
function PostDetailsCard({
  post,
  onSave,
}: {
  post: BlogPostListItem
  onSave: (patch: BlogPostPatch) => Promise<void>
}) {
  const [title, setTitle] = useState(post.title)
  const [slug, setSlug] = useState(post.slug)
  const [author, setAuthor] = useState(post.author ?? '')
  const [excerpt, setExcerpt] = useState(post.excerpt ?? '')
  const [coverImageUrl, setCoverImageUrl] = useState(post.cover_image_url ?? '')
  const [body, setBody] = useState(post.body ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const t = title.trim()
  const s = slug.trim()
  const dirty =
    t.length > 0 &&
    s.length > 0 &&
    (t !== post.title ||
      s !== post.slug ||
      author.trim() !== (post.author ?? '') ||
      excerpt.trim() !== (post.excerpt ?? '') ||
      coverImageUrl.trim() !== (post.cover_image_url ?? '') ||
      body.trim() !== (post.body ?? ''))

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        title: t,
        slug: s,
        author: author.trim() ? author.trim() : null,
        excerpt: excerpt.trim() ? excerpt.trim() : null,
        coverImageUrl: coverImageUrl.trim() ? coverImageUrl.trim() : null,
        body: body.trim() ? body.trim() : null,
      })
    } catch {
      // The most likely cause is a slug that's already taken by another post.
      setError('Could not save — that slug may already be in use. Try a different one.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Post</h2>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="post-title">Title</Label>
          <Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="post-slug">URL slug</Label>
            <Input
              id="post-slug"
              value={slug}
              placeholder="how-cash-offers-work"
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="post-author">Author</Label>
            <Input
              id="post-author"
              value={author}
              placeholder="e.g. Alex Mercer"
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="post-excerpt">Excerpt</Label>
          <Textarea
            id="post-excerpt"
            value={excerpt}
            rows={2}
            placeholder="A one- or two-sentence summary shown on the blog index."
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="post-cover">Cover image URL</Label>
          <Input
            id="post-cover"
            value={coverImageUrl}
            placeholder="https://… (optional)"
            onChange={(e) => setCoverImageUrl(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="post-body">Body</Label>
          <Textarea
            id="post-body"
            value={body}
            rows={14}
            placeholder="Write the post. Leave a blank line between paragraphs."
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">
            Read time is derived from this body — {post.readingMinutes > 0
              ? `currently ${post.readingMinutes} min`
              : 'empty so far'}
            .
          </p>
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save post'}
          </Button>
        </div>
      </div>
    </section>
  )
}

