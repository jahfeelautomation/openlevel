import { Users } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { CampaignChannel, Contact, NewCampaign } from '../../lib/api'
import { cn } from '../../lib/utils'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'
const textareaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

// Tokens swapped per-recipient at send time (rendering lands in a later slice; for
// now they're stored verbatim, same as GHL stores them in the draft).
const MERGE_FIELDS = ['{{first_name}}', '{{name}}'] as const
const CHANNELS: CampaignChannel[] = ['sms', 'email']
const channelLabel = (ch: CampaignChannel) => (ch === 'sms' ? 'SMS' : 'Email')

/** Compose a campaign: pick a channel, write the message, and choose the audience
 *  (everyone or a tag segment) with a live recipient count derived from the
 *  contacts already loaded on the page — no extra round-trip. */
export function NewCampaignDialog({
  contacts,
  onCancel,
  onCreate,
}: {
  contacts: Contact[]
  onCancel: () => void
  onCreate: (input: NewCampaign) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<CampaignChannel>('sms')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audienceTag, setAudienceTag] = useState('') // '' = all contacts
  const [saving, setSaving] = useState(false)

  // Distinct tags across loaded contacts → audience segment options.
  const tags = useMemo(() => {
    const set = new Set<string>()
    for (const c of contacts) for (const t of c.tags) set.add(t)
    return Array.from(set).sort()
  }, [contacts])

  const countForTag = (tag: string) =>
    tag ? contacts.filter((c) => c.tags.includes(tag)).length : contacts.length
  const recipientCount = countForTag(audienceTag)

  const valid = Boolean(name.trim() && body.trim() && recipientCount > 0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      await onCreate({
        name: name.trim(),
        channel,
        subject: channel === 'email' ? subject.trim() || null : null,
        body: body.trim(),
        audienceTag: audienceTag || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">New campaign</h2>
        </div>

        <div className="ol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <Label htmlFor="camp-name">Campaign name</Label>
            <Input
              id="camp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. May cash-offer blast"
              autoFocus
            />
          </div>

          <div>
            <Label>Channel</Label>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {CHANNELS.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannel(ch)}
                  className={cn(
                    'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                    channel === ch
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {channelLabel(ch)}
                </button>
              ))}
            </div>
          </div>

          {channel === 'email' && (
            <div>
              <Label htmlFor="camp-subject">Subject</Label>
              <Input
                id="camp-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject line"
              />
            </div>
          )}

          <div>
            <div className="flex items-end justify-between">
              <Label htmlFor="camp-body">Message</Label>
              {channel === 'sms' && (
                <span className="pb-1.5 text-[11px] text-slate-400">{body.length} chars</span>
              )}
            </div>
            <textarea
              id="camp-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={channel === 'email' ? 6 : 4}
              placeholder={
                channel === 'sms'
                  ? 'Hi {{first_name}}, …'
                  : 'Write your email. Use merge fields to personalize.'
              }
              className={textareaClass}
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400">Insert:</span>
              {MERGE_FIELDS.map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => setBody((b) => (b ? `${b} ${field}` : field))}
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 transition-colors hover:bg-slate-200"
                >
                  {field}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="camp-audience">Audience</Label>
            <select
              id="camp-audience"
              value={audienceTag}
              onChange={(e) => setAudienceTag(e.target.value)}
              className={selectClass}
            >
              <option value="">All contacts ({contacts.length})</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  Tag: {t} ({countForTag(t)})
                </option>
              ))}
            </select>
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Users className="h-3.5 w-3.5 text-slate-400" />
              {recipientCount} {recipientCount === 1 ? 'recipient' : 'recipients'}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!valid || saving}>
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      </form>
    </div>
  )
}
