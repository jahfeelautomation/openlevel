import { type FormEvent, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { ActionType, WorkflowActionInput } from '../../lib/api'
import { ACTIONS, actionMeta } from './automation-meta'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'
const textareaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

/** Add one action step: pick the action type, then fill the fields that type
 *  needs. The config shape mirrors the server vocab (send_sms{body},
 *  send_email{subject,body}, add_tag{tag}, wait{minutes}). */
export function AddStepDialog({
  onCancel,
  onAdd,
}: {
  onCancel: () => void
  onAdd: (step: WorkflowActionInput) => void
}) {
  const [type, setType] = useState<ActionType>('send_sms')
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  const [tag, setTag] = useState('')
  const [minutes, setMinutes] = useState('5')

  const valid =
    (type === 'send_sms' && body.trim().length > 0) ||
    (type === 'send_email' && subject.trim().length > 0 && body.trim().length > 0) ||
    (type === 'add_tag' && tag.trim().length > 0) ||
    (type === 'wait' && Number(minutes) > 0)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    let config: Record<string, unknown> = {}
    if (type === 'send_sms') config = { body: body.trim() }
    else if (type === 'send_email') config = { subject: subject.trim(), body: body.trim() }
    else if (type === 'add_tag') config = { tag: tag.trim() }
    else if (type === 'wait') config = { minutes: Number(minutes) }
    onAdd({ type, config })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Add step</h2>
        </div>

        <div className="ol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <Label htmlFor="step-type">Action</Label>
            <select
              id="step-type"
              value={type}
              onChange={(e) => setType(e.target.value as ActionType)}
              className={selectClass}
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {actionMeta(a).label}
                </option>
              ))}
            </select>
          </div>

          {type === 'send_email' && (
            <div>
              <Label htmlFor="step-subject">Subject</Label>
              <Input
                id="step-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject line"
                autoFocus
              />
            </div>
          )}

          {(type === 'send_sms' || type === 'send_email') && (
            <div>
              <Label htmlFor="step-body">Message</Label>
              <textarea
                id="step-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Hi {{first_name}}, …"
                className={textareaClass}
              />
            </div>
          )}

          {type === 'add_tag' && (
            <div>
              <Label htmlFor="step-tag">Tag</Label>
              <Input
                id="step-tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="e.g. lead"
                autoFocus
              />
            </div>
          )}

          {type === 'wait' && (
            <div>
              <Label htmlFor="step-minutes">Wait (minutes)</Label>
              <Input
                id="step-minutes"
                type="number"
                min={1}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!valid}>
            Add step
          </Button>
        </div>
      </form>
    </div>
  )
}
