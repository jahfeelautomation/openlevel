import { ArrowLeft, LayoutTemplate, Mail, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { PageSpinner } from '../../components/ui/spinner'
import { type CustomValue, type Template, type TemplateChannel, api } from '../../lib/api'
import { cn, relativeTime } from '../../lib/utils'
import { useTenant } from '../../state/location'
import {
  MERGE_FIELDS,
  SAMPLE_CONTACT,
  TEMPLATE_CHANNELS,
  channelLabel,
  renderTemplate,
} from './templates-meta'

const textareaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

type ChannelFilter = 'all' | TemplateChannel
// The sentinel selection for an unsaved, blank template.
const NEW = '__new__'

/**
 * Templates — the reusable email/SMS message library (the GHL "Templates" area).
 * A master-detail: the saved library on the left, a live editor with a merge-field
 * preview on the right. The preview renders the body against a sample contact so an
 * author sees the real "Hi Derek," output, not the raw "{{first_name}}" token.
 * Templates are just saved drafts — nothing here sends a message or moves money.
 */
export function TemplatesPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [templates, setTemplates] = useState<Template[]>([])
  const [customValues, setCustomValues] = useState<CustomValue[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ChannelFilter>('all')

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.templates(loc)
    setTemplates(r.templates)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setSelectedId(null)
    api
      .templates(loc)
      .then((r) => {
        if (!active) return
        setTemplates(r.templates)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    // Custom values feed the editor's insert menu and live preview. They load
    // independently so a hiccup here never blocks the template library.
    api
      .customValues(loc)
      .then((r) => active && setCustomValues(r.values))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [loc])

  if (!loc || status === 'loading') return <PageSpinner label="Loading templates" />

  const visible = filter === 'all' ? templates : templates.filter((t) => t.channel === filter)
  const selected =
    selectedId === NEW ? null : (templates.find((t) => t.id === selectedId) ?? null)
  const editing = selectedId !== null

  // The location's custom values, in the two shapes the editor needs: a key→value
  // map for the live preview, and a token+label list for the insert menu.
  const customValueMap: Record<string, string> = Object.fromEntries(
    customValues.map((v) => [v.key, v.value] as const),
  )
  const customValueTokens = customValues.map((v) => ({
    token: `{{custom_values.${v.key}}}`,
    label: v.name,
  }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Templates</h1>
          <p className="text-xs text-slate-500">
            Reusable email and SMS messages with merge fields.
          </p>
        </div>
        <Button size="sm" onClick={() => setSelectedId(NEW)}>
          <Plus className="h-4 w-4" />
          New template
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Library list — full-width on mobile, fixed w-80 on desktop */}
        <aside className={cn('flex-col border-r border-slate-200 bg-white lg:flex lg:w-80 lg:shrink-0', editing ? 'hidden' : 'flex w-full')}>
          <div className="flex gap-1 border-b border-slate-100 px-3 py-2.5">
            {(['all', 'email', 'sms'] as ChannelFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  filter === f
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
                )}
              >
                {f === 'all' ? 'All' : channelLabel(f)}
              </button>
            ))}
          </div>

          <div className="ol-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {visible.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <LayoutTemplate className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-600">
                  {templates.length === 0 ? 'No templates yet' : 'None in this channel'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {templates.length === 0
                    ? 'Create a reusable message to get started.'
                    : 'Try a different filter or add one.'}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {visible.map((t) => (
                  <li key={t.id}>
                    <TemplateRow
                      template={t}
                      active={t.id === selectedId}
                      onSelect={() => setSelectedId(t.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Editor / preview — hidden on mobile until a template is selected */}
        <section className={cn('ol-scroll min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50 lg:flex', editing ? 'flex' : 'hidden')}>
          {editing ? (
            <TemplateEditor
              key={selectedId}
              loc={loc}
              template={selected}
              customValueMap={customValueMap}
              customValueTokens={customValueTokens}
              onSaved={async (id) => {
                await refresh()
                setSelectedId(id)
              }}
              onDeleted={async () => {
                await refresh()
                setSelectedId(null)
              }}
              onCancel={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <LayoutTemplate className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-600">Select a template</p>
                <p className="mt-1 text-sm text-slate-400">
                  Pick one from the library to edit, or create a new one.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function TemplateRow({
  template,
  active,
  onSelect,
}: {
  template: Template
  active: boolean
  onSelect: () => void
}) {
  const isEmail = template.channel === 'email'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-brand-200 bg-brand-50'
          : 'border-transparent hover:border-slate-200 hover:bg-slate-50',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            isEmail ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600',
          )}
        >
          {isEmail ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
          {template.name}
        </span>
      </div>
      <p className="line-clamp-2 pl-8 text-xs text-slate-500">{template.body}</p>
      <p className="pl-8 text-[11px] text-slate-400">Updated {relativeTime(template.updated_at)}</p>
    </button>
  )
}

function TemplateEditor({
  loc,
  template,
  customValueMap,
  customValueTokens,
  onSaved,
  onDeleted,
  onCancel,
}: {
  loc: string
  template: Template | null
  customValueMap: Record<string, string>
  customValueTokens: { token: string; label: string }[]
  onSaved: (id: string) => void | Promise<void>
  onDeleted: () => void | Promise<void>
  onCancel: () => void
}) {
  const isNew = template == null
  const [name, setName] = useState(template?.name ?? '')
  const [channel, setChannel] = useState<TemplateChannel>(
    (template?.channel as TemplateChannel) ?? 'email',
  )
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  const [activeField, setActiveField] = useState<'subject' | 'body'>('body')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = Boolean(name.trim() && body.trim())

  function insert(token: string) {
    const target = channel === 'email' ? activeField : 'body'
    if (target === 'subject') setSubject((s) => (s ? `${s} ${token}` : token))
    else setBody((b) => (b ? `${b} ${token}` : token))
  }

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    const input = {
      name: name.trim(),
      channel,
      subject: channel === 'email' ? subject.trim() || null : null,
      body: body.trim(),
    }
    try {
      const r = isNew
        ? await api.createTemplate(loc, input)
        : await api.updateTemplate(loc, template.id, input)
      await onSaved(r.template.id)
    } catch {
      setError('Could not save the template. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (isNew || saving) return
    setSaving(true)
    try {
      await api.deleteTemplate(loc, template.id)
      await onDeleted()
    } finally {
      setSaving(false)
    }
  }

  const previewSubject = renderTemplate(subject, SAMPLE_CONTACT, customValueMap)
  const previewBody = renderTemplate(body, SAMPLE_CONTACT, customValueMap)
  const charCount = body.length
  const segments = Math.max(1, Math.ceil(charCount / 160))

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* Mobile back affordance — hidden on lg and up */}
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center gap-1.5 -mx-6 mb-4 w-[calc(100%+3rem)] border-b border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        All templates
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          {isNew ? 'New template' : 'Edit template'}
        </h2>
        {!isNew &&
          (confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Delete this template?</span>
              <Button variant="danger" size="sm" disabled={saving} onClick={() => void remove()}>
                Delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-4">
          <div>
            <Label htmlFor="tpl-name">Template name</Label>
            <Input
              id="tpl-name"
              value={name}
              autoFocus
              placeholder="e.g. Welcome — new lead"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <Label>Channel</Label>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {TEMPLATE_CHANNELS.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannel(ch)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                    channel === ch
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {ch === 'email' ? (
                    <Mail className="h-3.5 w-3.5" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5" />
                  )}
                  {channelLabel(ch)}
                </button>
              ))}
            </div>
          </div>

          {channel === 'email' && (
            <div>
              <Label htmlFor="tpl-subject">Subject</Label>
              <Input
                id="tpl-subject"
                value={subject}
                placeholder="Subject line"
                onFocus={() => setActiveField('subject')}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}

          <div>
            <div className="flex items-end justify-between">
              <Label htmlFor="tpl-body">Message</Label>
              {channel === 'sms' && (
                <span className="pb-1.5 text-[11px] text-slate-400 tabular-nums">
                  {charCount} chars · {segments} SMS
                </span>
              )}
            </div>
            <textarea
              id="tpl-body"
              value={body}
              rows={channel === 'email' ? 8 : 4}
              placeholder={
                channel === 'sms'
                  ? 'Hi {{first_name}}, …'
                  : 'Write your message. Use merge fields to personalize.'
              }
              onFocus={() => setActiveField('body')}
              onChange={(e) => setBody(e.target.value)}
              className={textareaClass}
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">Insert:</span>
              {MERGE_FIELDS.map((field) => (
                <button
                  key={field.token}
                  type="button"
                  title={field.label}
                  onClick={() => insert(field.token)}
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 transition-colors hover:bg-slate-200"
                >
                  {field.token}
                </button>
              ))}
              {customValueTokens.map((field) => (
                <button
                  key={field.token}
                  type="button"
                  title={field.label}
                  onClick={() => insert(field.token)}
                  className="rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] text-brand-600 transition-colors hover:bg-brand-100"
                >
                  {field.token}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Preview</Label>
            <span className="text-[11px] text-slate-400">Sample: {SAMPLE_CONTACT.name}</span>
          </div>
          <Preview
            channel={channel}
            subject={previewSubject}
            body={previewBody}
            sampleName={SAMPLE_CONTACT.name ?? ''}
          />
        </div>
      </div>

      {error && <p className="mt-4 text-xs text-rose-500">{error}</p>}

      <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!valid || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : isNew ? 'Create template' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

/** A faithful little mock of how the rendered message lands: an email card with a
 *  subject line, or an SMS chat bubble. Empty states are honest, never filler. */
function Preview({
  channel,
  subject,
  body,
  sampleName,
}: {
  channel: TemplateChannel
  subject: string
  body: string
  sampleName: string
}) {
  if (channel === 'email') {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Subject</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">
            {subject || <span className="font-normal text-slate-400">No subject</span>}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="mb-2 text-xs text-slate-400">To: {sampleName}</p>
          {body ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{body}</p>
          ) : (
            <p className="text-sm text-slate-400">Your message will appear here.</p>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm leading-relaxed text-white shadow-sm">
          {body ? (
            <span className="whitespace-pre-wrap">{body}</span>
          ) : (
            <span className="text-white/70">Your message will appear here.</span>
          )}
        </div>
      </div>
      <p className="mt-2 text-right text-[11px] text-slate-400">SMS to {sampleName}</p>
    </div>
  )
}
