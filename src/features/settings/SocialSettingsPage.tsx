import { CheckCircle2, CircleSlash, KeyRound, Share2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type ChannelStatus, type SocialSettings, api } from '../../lib/api'
import { useTenant } from '../../state/location'

interface SocialForm {
  facebookPageId: string
  instagramUserId: string
  linkedinAuthorUrn: string
  googleAccountId: string
  googleLocationId: string
}

function toForm(s: SocialSettings): SocialForm {
  return {
    facebookPageId: s.facebookPageId ?? '',
    instagramUserId: s.instagramUserId ?? '',
    linkedinAuthorUrn: s.linkedinAuthorUrn ?? '',
    googleAccountId: s.googleAccountId ?? '',
    googleLocationId: s.googleLocationId ?? '',
  }
}

function fingerprint(f: SocialForm): string {
  return JSON.stringify({
    facebookPageId: f.facebookPageId.trim(),
    instagramUserId: f.instagramUserId.trim(),
    linkedinAuthorUrn: f.linkedinAuthorUrn.trim(),
    googleAccountId: f.googleAccountId.trim(),
    googleLocationId: f.googleLocationId.trim(),
  })
}

/**
 * Social publishing connections — the same model as Payments and Email & SMS:
 * this sub-account publishes through its OWN pages and profiles. Only the
 * non-secret channel ids are stored here; the page/access tokens live in the
 * platform vault by name and are never typed into this app. The per-platform
 * readouts are honest — `connected` is true only when the channel's ids and
 * vault key actually build a working publisher server-side.
 */
export function SocialSettingsPage() {
  const { current } = useTenant()
  const loc = current?.id
  const slug = current ? (current.client_slug ?? current.slug) : 'your-account'

  const [base, setBase] = useState<SocialForm | null>(null)
  const [form, setForm] = useState<SocialForm | null>(null)
  const [view, setView] = useState<SocialSettings | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setError(null)
    setSaved(false)
    api
      .socialSettings(loc)
      .then((s) => {
        if (!active) return
        const f = toForm(s)
        setBase(f)
        setForm(f)
        setView(s)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  const dirty = useMemo(
    () => (base && form ? fingerprint(base) !== fingerprint(form) : false),
    [base, form],
  )

  function patch(p: Partial<SocialForm>) {
    setForm((f) => (f ? { ...f, ...p } : f))
    setSaved(false)
  }

  async function save() {
    if (!loc || !form || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateSocialSettings(loc, {
        facebookPageId: form.facebookPageId.trim() || null,
        instagramUserId: form.instagramUserId.trim() || null,
        linkedinAuthorUrn: form.linkedinAuthorUrn.trim() || null,
        googleAccountId: form.googleAccountId.trim() || null,
        googleLocationId: form.googleLocationId.trim() || null,
      })
      const f = toForm(updated)
      setBase(f)
      setForm(f)
      setView(updated)
      setSaved(true)
    } catch {
      setError('Could not save the social settings.')
    } finally {
      setBusy(false)
    }
  }

  if (!loc || status === 'loading' || !form) return <PageSpinner label="Loading social settings" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Social</h1>
          <p className="text-xs text-slate-500">
            Connect this sub-account's own pages and profiles. Posts publish through their
            accounts — the audience, reach, and page ownership stay theirs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && !dirty ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </span>
          ) : null}
          <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-2xl space-y-4">
          {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}

          <ChannelSection title="Facebook" status={view?.channels.facebook} dirty={dirty}>
            <Label htmlFor="fb-page-id">Page ID</Label>
            <p className="mb-2 mt-1 text-xs text-slate-500">
              The numeric id of the Facebook Page this account posts as.
            </p>
            <Input
              id="fb-page-id"
              value={form.facebookPageId}
              maxLength={200}
              placeholder="102934857261"
              onChange={(e) => patch({ facebookPageId: e.target.value })}
            />
          </ChannelSection>

          <ChannelSection title="Instagram" status={view?.channels.instagram} dirty={dirty}>
            <Label htmlFor="ig-user-id">Instagram user ID</Label>
            <p className="mb-2 mt-1 text-xs text-slate-500">
              The IG professional-account id linked to the Facebook Page. Instagram posts
              need an image.
            </p>
            <Input
              id="ig-user-id"
              value={form.instagramUserId}
              maxLength={200}
              placeholder="17841405822304914"
              onChange={(e) => patch({ instagramUserId: e.target.value })}
            />
          </ChannelSection>

          <ChannelSection title="LinkedIn" status={view?.channels.linkedin} dirty={dirty}>
            <Label htmlFor="li-author-urn">Author URN</Label>
            <p className="mb-2 mt-1 text-xs text-slate-500">
              The profile or organization that owns the post, e.g.
              urn:li:organization:12345.
            </p>
            <Input
              id="li-author-urn"
              value={form.linkedinAuthorUrn}
              maxLength={200}
              placeholder="urn:li:organization:12345"
              onChange={(e) => patch({ linkedinAuthorUrn: e.target.value })}
            />
          </ChannelSection>

          <ChannelSection title="X" status={view?.channels.x} dirty={dirty}>
            <p className="text-xs text-slate-500">
              X needs no ids here — only the account's access key in the vault below. Posts
              go out as the account that owns the key.
            </p>
          </ChannelSection>

          <ChannelSection
            title="Google Business Profile"
            status={view?.channels.google_business}
            dirty={dirty}
          >
            <p className="mb-3 text-xs text-slate-500">
              Review sync only — Reputation pulls in the reviews customers leave on this
              listing. Nothing posts to Google.
            </p>
            <Label htmlFor="gbp-account-id">Account ID</Label>
            <Input
              id="gbp-account-id"
              className="mb-3 mt-1"
              value={form.googleAccountId}
              maxLength={200}
              placeholder="1098765432109876543"
              onChange={(e) => patch({ googleAccountId: e.target.value })}
            />
            <Label htmlFor="gbp-location-id">Location ID</Label>
            <p className="mb-2 mt-1 text-xs text-slate-500">
              The listing under that account whose reviews to mirror in.
            </p>
            <Input
              id="gbp-location-id"
              value={form.googleLocationId}
              maxLength={200}
              placeholder="12345678901234567"
              onChange={(e) => patch({ googleLocationId: e.target.value })}
            />
          </ChannelSection>

          {/* Where the keys live — never in this app */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <KeyRound className="h-[18px] w-[18px] text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">Access keys</h2>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Tokens are never typed into this app and never stored with this sub-account's
              data. Your platform operator places them in the secure vault under these names:
            </p>
            <ul className="space-y-1.5">
              {[
                `${slug}:facebook:page_token`,
                `${slug}:instagram:access_token`,
                `${slug}:linkedin:access_token`,
                `${slug}:x:access_token`,
                `${slug}:google_business:access_token`,
              ].map((name) => (
                <li key={name}>
                  <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{name}</code>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function ChannelSection({
  title,
  status,
  dirty,
  children,
}: {
  title: string
  status: ChannelStatus | undefined
  dirty: boolean
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Share2 className="h-[18px] w-[18px] text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        </div>
        <ChannelBadge dirty={dirty} status={status} />
      </div>
      {children}
    </section>
  )
}

/** The saved-state connection chip. An unsaved edit must not flip the readout
 *  until it actually persists, so a dirty form shows neutral. */
function ChannelBadge({ dirty, status }: { dirty: boolean; status: ChannelStatus | undefined }) {
  if (dirty || !status) {
    return <span className="text-xs font-medium text-slate-400">Save to check connection</span>
  }
  if (status.connected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Connected
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500"
      title={status.reason}
    >
      <CircleSlash className="h-3.5 w-3.5" />
      {status.reason ?? 'Not connected'}
    </span>
  )
}
