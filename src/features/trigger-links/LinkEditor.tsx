import {
  ArrowLeft,
  ExternalLink,
  Link2,
  MousePointerClick,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type TriggerLinkClick, type TriggerLinkListItem, type TriggerLinkPatch, api } from '../../lib/api'
import { CopyButton, hostedUrl } from './link-ui'
import { formatClickTime, prettyUrl } from './trigger-links-meta'

/**
 * The link editor: rename a link, change its slug or destination, copy/open its
 * hosted short URL, and read the recent-click activity feed. Every figure here —
 * total clicks, distinct contacts, the feed itself — is DERIVED from real click
 * rows the public route recorded, never a stored counter, so editing the link
 * leaves its history intact and honest.
 */
export function LinkEditor({
  loc,
  linkId,
  onBack,
  onChanged,
  onDeleted,
}: {
  loc: string
  linkId: string
  onBack: () => void
  /** Bubble up so the list + KPI band re-derive after any edit. */
  onChanged: () => void
  onDeleted: () => void
}) {
  const [link, setLink] = useState<TriggerLinkListItem | null>(null)
  const [clicks, setClicks] = useState<TriggerLinkClick[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const r = await api.triggerLink(loc, linkId)
    setLink(r.link)
    setClicks(r.clicks)
    return r.link
  }, [loc, linkId])

  useEffect(() => {
    let active = true
    setStatus('loading')
    api
      .triggerLink(loc, linkId)
      .then((r) => {
        if (!active) return
        setLink(r.link)
        setClicks(r.clicks)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc, linkId])

  async function afterMutation() {
    await refresh()
    onChanged()
  }

  async function reallyDelete() {
    setBusy(true)
    try {
      await api.deleteTriggerLink(loc, linkId)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading' || !link) return <PageSpinner />

  const url = hostedUrl(link.link)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* On mobile the name row takes full width and the action buttons wrap below it;
          on desktop (lg+) everything stays in a single row as before. */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Back to links"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        {/* min-w floor keeps the name readable: when the row gets tighter than
            this the action buttons wrap below instead of crushing the name to a
            single letter; truncate still handles very long names */}
        <div className="min-w-[10rem] flex-1">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 truncate text-base font-semibold text-slate-900">{link.name}</h1>
            <span className="shrink-0 flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
              <MousePointerClick className="h-3.5 w-3.5" />
              {link.clicks} {link.clicks === 1 ? 'click' : 'clicks'}
            </span>
          </div>
          <p className="truncate text-xs text-slate-500">→ {prettyUrl(link.destination_url)}</p>
        </div>
        {/* shrink-0 so these buttons never compress and w-full on mobile lets them fill the
            row they wrap onto, keeping them reachable at 390px */}
        <div className="flex shrink-0 gap-2">
          <CopyButton text={url} />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </a>
        </div>
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50">
        {/* grid-cols-1 (minmax(0,1fr)) keeps the implicit mobile track from
            growing to max-content and overflowing the viewport */}
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_18rem]">
          {/* Left: editable link + the activity feed + danger zone */}
          <div className="flex flex-col gap-5">
            <LinkDetailsCard
              key={link.id}
              link={link}
              onSave={async (patch) => {
                await api.updateTriggerLink(loc, linkId, patch)
                await afterMutation()
              }}
            />

            <ActivityCard clicks={clicks} totalClicks={link.clicks} />

            {/* Danger zone */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              {confirmDelete ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">
                    Delete <span className="font-medium text-slate-900">{link.name}</span>? Its
                    click history goes with it. This can't be undone.
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
                      Delete link
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">Remove this link permanently.</p>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4" />
                    Delete link
                  </Button>
                </div>
              )}
            </section>
          </div>

          {/* Right: the hosted link + its derived stats */}
          <aside className="lg:sticky lg:top-0">
            <HostedCard link={link} url={url} />
          </aside>
        </div>
      </div>
    </div>
  )
}

/** The hosted short URL and the link's derived stats. The URL is shown in full and
 *  is copy/open-able; the stats below are aggregated from real click rows. */
function HostedCard({ link, url }: { link: TriggerLinkListItem; url: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Link2 className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900">Hosted link</h2>
      </div>
      <div className="space-y-3 px-4 py-4">
        <p className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
          {url}
        </p>
        <div className="flex gap-2">
          <CopyButton text={url} className="flex-1" />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </a>
        </div>

        <dl className="space-y-2.5 border-t border-slate-100 pt-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1.5 text-slate-500">
              <MousePointerClick className="h-3.5 w-3.5 text-slate-400" />
              Clicks
            </dt>
            <dd className="font-semibold tabular-nums text-slate-900">{link.clicks}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1.5 text-slate-500">
              <Users className="h-3.5 w-3.5 text-slate-400" />
              Contacts reached
            </dt>
            <dd className="font-semibold tabular-nums text-slate-900">{link.contacts}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Last click</dt>
            <dd className="tabular-nums text-slate-700">{formatClickTime(link.last_clicked_at)}</dd>
          </div>
        </dl>
        <p className="text-xs text-slate-400">
          Every figure is counted from real opens — a click belongs to exactly one link, and
          contacts reached counts distinct identified people, never anonymous opens twice.
        </p>
      </div>
    </section>
  )
}

/** The recent-click activity feed — newest first, naming known clickers and showing
 *  anonymous opens honestly. An unclicked link shows an explicit empty state. */
function ActivityCard({
  clicks,
  totalClicks,
}: {
  clicks: TriggerLinkClick[]
  totalClicks: number
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Recent clicks</h2>
        {totalClicks > clicks.length && (
          <span className="text-xs text-slate-400">
            showing {clicks.length} of {totalClicks}
          </span>
        )}
      </div>
      {clicks.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <MousePointerClick className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">No clicks yet</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Share the hosted link — every open shows up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {clicks.map((c) => {
            const known = !!c.contact_id && !!c.contact_name
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={
                    known
                      ? 'flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-600'
                      : 'flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400'
                  }
                >
                  <UserRound className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {known ? (
                    c.contact_name
                  ) : (
                    <span className="text-slate-400">Anonymous open</span>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {formatClickTime(c.clicked_at)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Editable fields: name, slug, destination. Save lights up only when something
 *  actually changed, so there's no phantom-save. */
function LinkDetailsCard({
  link,
  onSave,
}: {
  link: TriggerLinkListItem
  onSave: (patch: TriggerLinkPatch) => Promise<void>
}) {
  const [name, setName] = useState(link.name)
  const [slug, setSlug] = useState(link.slug)
  const [destinationUrl, setDestinationUrl] = useState(link.destination_url)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const n = name.trim()
  const s = slug.trim()
  const d = destinationUrl.trim()
  const validUrl = /^https?:\/\/.+/i.test(d)
  const dirty =
    n.length > 0 &&
    s.length > 0 &&
    validUrl &&
    (n !== link.name || s !== link.slug || d !== link.destination_url)

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: n, slug: s, destinationUrl: d })
    } catch {
      // Most likely a slug already taken by another link in this location.
      setError('Could not save — that slug may already be in use. Try a different one.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Link</h2>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="link-name">Name</Label>
          <Input id="link-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="link-slug">URL slug</Label>
          <Input
            id="link-slug"
            value={slug}
            placeholder="free-offer"
            onChange={(e) => setSlug(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">
            The end of the short link. Changing it retires the old short URL.
          </p>
        </div>

        <div>
          <Label htmlFor="link-dest">Destination URL</Label>
          <Input
            id="link-dest"
            value={destinationUrl}
            placeholder="https://yoursite.com/offer"
            onChange={(e) => setDestinationUrl(e.target.value)}
          />
          {!validUrl && d.length > 0 && (
            <p className="mt-1 text-xs text-rose-500">Must be a full http(s) URL.</p>
          )}
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save link'}
          </Button>
        </div>
      </div>
    </section>
  )
}
