import { CalendarClock, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { type SocialAccount, type SocialPost, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { platformMeta } from './social-meta'

/** ISO → the `YYYY-MM-DDTHH:mm` local value a datetime-local input expects. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local datetime-local value → ISO (treated as local time, per the HTML spec). */
function localToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * Compose or edit a social post. The body (plus an optional image URL) fans out
 * to any number of selected channels; an optional date/time drops it into the
 * scheduled queue. Three honest outcomes: save as a draft, schedule it, or
 * publish now — which REALLY pushes through the location's own connected
 * channels. Zero deliveries surface the per-channel reasons right here and the
 * post stays put; nothing fabricates reach. Editing a post reuses this surface.
 */
export function PostComposer({
  loc,
  accounts,
  post,
  onClose,
  onSaved,
}: {
  loc: string
  accounts: SocialAccount[]
  post?: SocialPost
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!post
  const isPublished = post?.status === 'published'
  const [body, setBody] = useState(post?.body ?? '')
  const [mediaUrl, setMediaUrl] = useState(post?.media_url ?? '')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(post?.targets.map((t) => t.accountId) ?? []),
  )
  const [scheduledLocal, setScheduledLocal] = useState(toLocalInput(post?.scheduled_at))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accountIds = () => accounts.filter((a) => selected.has(a.id)).map((a) => a.id)
  const canSave = body.trim().length > 0 && !busy
  const media = () => mediaUrl.trim() || null

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function run(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  function saveDraft() {
    if (!canSave) return
    void run(async () => {
      if (isEdit && post)
        await api.updateSocialPost(loc, post.id, { body: body.trim(), mediaUrl: media(), accountIds: accountIds() })
      else await api.createSocialPost(loc, { body: body.trim(), mediaUrl: media(), accountIds: accountIds() })
    })
  }

  function schedule() {
    if (!canSave) return
    const iso = localToIso(scheduledLocal)
    if (!iso) {
      setError('Pick a date and time to schedule this post.')
      return
    }
    void run(async () => {
      if (isEdit && post) {
        await api.updateSocialPost(loc, post.id, { body: body.trim(), mediaUrl: media(), accountIds: accountIds() })
        await api.scheduleSocialPost(loc, post.id, iso, accountIds())
      } else {
        await api.createSocialPost(loc, {
          body: body.trim(),
          mediaUrl: media(),
          accountIds: accountIds(),
          scheduledAt: iso,
        })
      }
    })
  }

  function publishNow() {
    if (!canSave) return
    void run(async () => {
      if (isEdit && post) {
        await api.updateSocialPost(loc, post.id, { body: body.trim(), mediaUrl: media(), accountIds: accountIds() })
        await api.publishSocialPost(loc, post.id)
      } else {
        const r = await api.createSocialPost(loc, { body: body.trim(), mediaUrl: media(), accountIds: accountIds() })
        await api.publishSocialPost(loc, r.post.id)
      }
    })
  }

  function remove() {
    if (!post || busy) return
    void run(async () => {
      await api.deleteSocialPost(loc, post.id)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            {isEdit ? 'Edit post' : 'New post'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Write once, choose the channels, then save a draft, schedule it, or publish now.
          </p>
        </div>

        <div className="ol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <Label htmlFor="post-body">Post</Label>
            <Textarea
              id="post-body"
              rows={5}
              value={body}
              autoFocus
              placeholder="What do you want to share?"
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-slate-400">
              {body.trim().length} characters
            </p>
          </div>

          <div>
            <Label htmlFor="post-media">Image URL (optional)</Label>
            <Input
              id="post-media"
              type="url"
              value={mediaUrl}
              placeholder="https://example.com/photo.jpg"
              onChange={(e) => setMediaUrl(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              A public image link to attach. Instagram requires one.
            </p>
          </div>

          <div>
            <Label>Channels</Label>
            {accounts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-400">
                No channels yet — add one from the planner to choose where this posts. You can still
                save a draft now.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => {
                  const meta = platformMeta(a.platform)
                  const on = selected.has(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggle(a.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        on
                          ? 'border-brand-300 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                          meta.tile,
                        )}
                      >
                        {meta.short}
                      </span>
                      {a.handle}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {!isPublished && (
            <div>
              <Label htmlFor="post-schedule">Schedule for (optional)</Label>
              <Input
                id="post-schedule"
                type="datetime-local"
                value={scheduledLocal}
                onChange={(e) => setScheduledLocal(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Leave empty to keep it a draft. Publish now pushes through your connected
                channels immediately.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5">
          <div>
            {isEdit && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                <span className="text-rose-500">Delete</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            {!isPublished && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSave}
                onClick={publishNow}
              >
                <Send className="h-3.5 w-3.5" />
                Publish now
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={!canSave} onClick={saveDraft}>
              {isEdit ? 'Save changes' : 'Save draft'}
            </Button>
            {!isPublished && (
              <Button type="button" size="sm" disabled={!canSave} onClick={schedule}>
                <CalendarClock className="h-3.5 w-3.5" />
                Schedule
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
