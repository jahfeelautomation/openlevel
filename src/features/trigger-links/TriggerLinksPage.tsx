import { Link2, MousePointerClick, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type TriggerLinkListItem, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { LinkEditor } from './LinkEditor'
import { formatClickTime, prettyUrl, triggerLinkTotals } from './trigger-links-meta'

/**
 * Trigger Links — trackable short links. Name a link to a destination, share the
 * short URL, and watch real clicks roll in. The list is a KPI band of honest
 * aggregates (links, total clicks, how many links have been clicked, the most
 * recent click) over a grid of link cards; selecting one opens its editor with the
 * recent-click activity feed. Every figure is DERIVED from real click rows — a
 * brand-new link reads as an honest zero, never a flattering estimate.
 */
export function TriggerLinksPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [links, setLinks] = useState<TriggerLinkListItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.triggerLinks(loc)
    setLinks(r.links)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setSelectedId(null)
    api
      .triggerLinks(loc)
      .then((r) => {
        if (!active) return
        setLinks(r.links)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  async function createLink(name: string, destinationUrl: string) {
    if (!loc) return
    const r = await api.createTriggerLink(loc, { name, destinationUrl })
    setCreating(false)
    await refresh()
    setSelectedId(r.link.id)
  }

  if (!loc || status === 'loading') return <PageSpinner />

  // Detail view — the editor for the selected link.
  if (selectedId) {
    return (
      <LinkEditor
        loc={loc}
        linkId={selectedId}
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

  const totals = triggerLinkTotals(links)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Trigger Links</h1>
          <p className="text-xs text-slate-500">
            Share a short link, see who clicks, and start automations off a click.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New link
        </Button>
      </header>

      {/* KPI band — exact aggregates off the link list; total clicks is the sum of
          real click rows, last click is the most recent open. Nothing invented. */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Kpi label="Links" value={String(totals.links)} sub="trackable" />
        <Kpi
          label="Total clicks"
          value={String(totals.clicks)}
          sub="across all links"
          accent
        />
        <Kpi
          label="Links clicked"
          value={String(totals.clickedLinks)}
          sub={`of ${totals.links}`}
        />
        <Kpi label="Last click" value={formatClickTime(totals.lastClickedAt)} sub="most recent" />
      </div>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
        {links.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Link2 className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No links yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Create a trackable link — every open is counted and can trigger an automation.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New link
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {links.map((link) => (
              <LinkCard key={link.id} link={link} onOpen={() => setSelectedId(link.id)} />
            ))}
          </div>
        )}
      </div>

      {creating && <NewLinkDialog onCancel={() => setCreating(false)} onCreate={createLink} />}
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

function LinkCard({ link, onOpen }: { link: TriggerLinkListItem; onOpen: () => void }) {
  const clicked = link.clicks > 0
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Link2 className="h-[18px] w-[18px]" />
        </span>
        <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
          <MousePointerClick className="h-3.5 w-3.5" />
          {link.clicks}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-1 text-sm font-semibold text-slate-900">{link.name}</h3>
      <p className="mt-1 line-clamp-1 text-xs text-slate-500">→ {prettyUrl(link.destination_url)}</p>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-400">
        <span className="truncate font-mono text-[11px] text-slate-400">/{link.slug}</span>
        <span className="shrink-0 tabular-nums">
          {clicked ? `${link.contacts} ${link.contacts === 1 ? 'contact' : 'contacts'}` : 'No clicks'}
        </span>
      </div>
    </button>
  )
}

/** Create modal — a name and a destination URL. The slug is derived from the name
 *  and shown (editable) in the editor once the link exists. */
function NewLinkDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (name: string, destinationUrl: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = name.trim().length > 0 && /^https?:\/\/.+/i.test(destinationUrl.trim())

  async function create() {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      await onCreate(name.trim(), destinationUrl.trim())
    } catch {
      setError('Could not create the link. Check the destination is a full http(s) URL.')
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
          <h2 className="text-base font-semibold text-slate-900">New trigger link</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Name it and point it somewhere. You'll get a short link that counts every open.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="new-link-name">Name</Label>
            <Input
              id="new-link-name"
              value={name}
              autoFocus
              placeholder="e.g. Free Cash Offer Quote"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-link-dest">Destination URL</Label>
            <Input
              id="new-link-dest"
              value={destinationUrl}
              placeholder="https://yoursite.com/offer"
              onChange={(e) => setDestinationUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create()
              }}
            />
            <p className="mt-1 text-xs text-slate-400">Must be a full http(s) link.</p>
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!ready || saving} onClick={() => void create()}>
            {saving ? 'Creating…' : 'Create link'}
          </Button>
        </div>
      </div>
    </div>
  )
}
