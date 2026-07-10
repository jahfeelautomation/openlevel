import { Mail, type LucideIcon, Megaphone, MessageSquare, Plus, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import { ApiError, type Campaign, type Contact, type NewCampaign, api } from '../../lib/api'
import { cn, relativeTime } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { NewCampaignDialog } from './NewCampaignDialog'

/** The outcome banner after a send attempt: real delivery counts on success,
 *  the server's honest refusal reason on failure. */
type SendNotice = { kind: 'success' | 'error'; text: string }

// Concrete fallback (not a Record lookup) so noUncheckedIndexedAccess stays happy.
const SMS_META = { label: 'SMS', icon: MessageSquare, tile: 'bg-brand-50 text-brand-600' }
const CHANNEL_META: Record<string, { label: string; icon: LucideIcon; tile: string }> = {
  sms: SMS_META,
  email: { label: 'Email', icon: Mail, tile: 'bg-violet-50 text-violet-600' },
}
const channelMeta = (channel: string) => CHANNEL_META[channel] ?? SMS_META

export function MarketingPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [showDialog, setShowDialog] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<SendNotice | null>(null)

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    Promise.all([api.campaigns(loc), api.contacts(loc)])
      .then(([c, ct]) => {
        if (!active) return
        setCampaigns(c.campaigns)
        setContacts(ct.contacts)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  const stats = useMemo(() => {
    const sent = campaigns.filter((c) => c.status === 'sent')
    const drafts = campaigns.filter((c) => c.status === 'draft')
    const delivered = sent.reduce((n, c) => n + c.sent_count, 0)
    return { total: campaigns.length, sent: sent.length, drafts: drafts.length, delivered }
  }, [campaigns])

  const reload = async () => {
    if (!loc) return
    const c = await api.campaigns(loc)
    setCampaigns(c.campaigns)
  }

  async function createCampaign(input: NewCampaign) {
    if (!loc) return
    await api.createCampaign(loc, input)
    setShowDialog(false)
    await reload()
  }

  async function send(id: string) {
    if (!loc) return
    setSendingId(id)
    setNotice(null)
    try {
      const res = await api.sendCampaign(loc, id)
      const { sent, skipped, failed } = res.delivery
      const extras = [
        skipped > 0 ? `${skipped} skipped` : null,
        failed > 0 ? `${failed} failed` : null,
      ].filter(Boolean)
      setNotice({
        kind: 'success',
        text: `Delivered ${sent} message${sent === 1 ? '' : 's'}${extras.length ? ` (${extras.join(', ')})` : ''}.`,
      })
      await reload()
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Could not send the campaign.',
      })
    } finally {
      setSendingId(null)
    }
  }

  if (!loc) return <Empty message="Select a sub-account to view marketing." />
  if (status === 'loading') return <PageSpinner />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3.5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Marketing</h1>
          <p className="text-xs text-slate-500">SMS &amp; email campaigns to your contacts</p>
        </div>
        <Button size="sm" onClick={() => setShowDialog(true)}>
          <Plus className="h-4 w-4" />
          New campaign
        </Button>
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-6 py-5">
        <div className="mx-auto max-w-4xl space-y-5">
          {notice ? (
            <div
              className={cn(
                'rounded-xl border px-4 py-2.5 text-xs',
                notice.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800',
              )}
            >
              {notice.text}
              {notice.kind === 'error' &&
              /no (email|sms) provider|not configured/i.test(notice.text) ? (
                <>
                  {' — '}
                  <Link to="/settings/sending" className="font-semibold underline">
                    connect a provider in Settings
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Campaigns" value={stats.total} />
            <StatCard label="Sent" value={stats.sent} />
            <StatCard label="Drafts" value={stats.drafts} />
            <StatCard label="Delivered" value={stats.delivered} />
          </div>

          {campaigns.length === 0 ? (
            <EmptyCard onNew={() => setShowDialog(true)} />
          ) : (
            <div className="ol-scroll overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              {/* min-w keeps columns readable and the Send button visible on narrow viewports */}
              <div className="min-w-[600px]">
                <div className="grid grid-cols-[1fr_5rem_6rem_7rem] items-center gap-4 border-b border-slate-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <span>Campaign</span>
                  <span className="text-center">Channel</span>
                  <span className="text-center">Recipients</span>
                  <span className="text-right">Status</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {campaigns.map((c) => (
                    <CampaignRow
                      key={c.id}
                      campaign={c}
                      sending={sendingId === c.id}
                      onSend={() => send(c.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showDialog && (
        <NewCampaignDialog
          contacts={contacts}
          onCancel={() => setShowDialog(false)}
          onCreate={createCampaign}
        />
      )}
    </div>
  )
}

function CampaignRow({
  campaign,
  sending,
  onSend,
}: {
  campaign: Campaign
  sending: boolean
  onSend: () => void
}) {
  const meta = channelMeta(campaign.channel)
  const Icon = meta.icon
  const isDraft = campaign.status === 'draft'
  const audience = campaign.audience_tag ? `Segment: ${campaign.audience_tag}` : 'All contacts'
  const subline =
    campaign.channel === 'email' && campaign.subject
      ? `${audience} · ${campaign.subject}`
      : audience

  return (
    <div className="grid grid-cols-[1fr_5rem_6rem_7rem] items-center gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', meta.tile)}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{campaign.name}</p>
          <p className="truncate text-xs text-slate-500">{subline}</p>
        </div>
      </div>

      <div className="text-center">
        <Badge variant={campaign.channel === 'email' ? 'slate' : 'brand'}>{meta.label}</Badge>
      </div>

      <div className="text-center text-sm">
        {campaign.status === 'sent' ? (
          <span className="font-medium text-slate-900">{campaign.recipient_count}</span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </div>

      <div className="flex items-center justify-end">
        {isDraft ? (
          <Button size="sm" variant="outline" onClick={onSend} disabled={sending}>
            <Send className="h-3.5 w-3.5" />
            {sending ? 'Sending…' : 'Send'}
          </Button>
        ) : (
          <div className="text-right">
            <Badge variant="green">Sent</Badge>
            <p className="mt-0.5 text-[11px] text-slate-400">{relativeTime(campaign.sent_at)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function EmptyCard({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <Megaphone className="h-8 w-8 text-slate-300" />
      <div>
        <p className="text-sm font-medium text-slate-900">No campaigns yet</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Send your first SMS or email blast to your contacts.
        </p>
      </div>
      <Button size="sm" onClick={onNew}>
        <Plus className="h-4 w-4" />
        New campaign
      </Button>
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-xs text-sm text-slate-400">{message}</p>
    </div>
  )
}
