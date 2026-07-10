import { Plus, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import type { FormContent, FormField } from '../../lib/api'
import { fieldFromLabel } from './forms-meta'

export interface FormDraft {
  name: string
  content: FormContent
}

/** The right-pane settings editor for one form. It owns no state — it reflects
 *  `draft` and reports every edit through `onChange`, so the center preview
 *  re-renders live as the operator types. A form is single-page, so there's no
 *  page type or URL path to edit (unlike a funnel step). */
export function FormEditor({
  draft,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  draft: FormDraft
  dirty: boolean
  saving: boolean
  onChange: (next: FormDraft) => void
  onSave: () => void
}) {
  const setContent = (patch: Partial<FormContent>) =>
    onChange({ ...draft, content: { ...draft.content, ...patch } })

  const fields = draft.content.fields ?? []
  const setFields = (next: FormField[]) => setContent({ fields: next })

  return (
    <div className="flex w-full flex-col border-t border-slate-200 bg-white lg:h-full lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Form settings
        </p>
        <Button size="sm" variant={dirty ? 'brand' : 'outline'} disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>

      <div className="ol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <Label htmlFor="fm-name">Form name</Label>
          <Input
            id="fm-name"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <Label htmlFor="fm-headline">Headline</Label>
          <Input
            id="fm-headline"
            value={draft.content.headline ?? ''}
            onChange={(e) => setContent({ headline: e.target.value })}
            placeholder="Get in touch"
          />
        </div>

        <div>
          <Label htmlFor="fm-subhead">Subheadline</Label>
          <Textarea
            id="fm-subhead"
            rows={2}
            value={draft.content.subhead ?? ''}
            onChange={(e) => setContent({ subhead: e.target.value })}
            placeholder="A supporting line under the headline"
          />
        </div>

        <div>
          <Label htmlFor="fm-cta">Button text</Label>
          <Input
            id="fm-cta"
            value={draft.content.cta ?? ''}
            onChange={(e) => setContent({ cta: e.target.value })}
            placeholder="Submit"
          />
        </div>

        <div>
          <Label htmlFor="fm-success">Success message</Label>
          <Textarea
            id="fm-success"
            rows={2}
            value={draft.content.successMessage ?? ''}
            onChange={(e) => setContent({ successMessage: e.target.value })}
            placeholder="Thanks — we got your details."
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Shown in place of the form after a visitor submits.
          </p>
        </div>

        <div>
          <Label htmlFor="fm-tag">Tag applied on submit</Label>
          <Input
            id="fm-tag"
            value={draft.content.tag ?? ''}
            onChange={(e) => setContent({ tag: e.target.value })}
            placeholder="lead"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Every lead captured here is tagged this, which can start an automation.
          </p>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">Form fields</Label>
            <button
              type="button"
              onClick={() => setFields([...fields, { name: 'field', label: 'New field', type: 'text' }])}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add field
            </button>
          </div>
          <div className="space-y-2">
            {fields.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
                No fields yet — add one to capture leads.
              </p>
            )}
            {fields.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2"
              >
                <input
                  value={f.label}
                  onChange={(e) => {
                    const { name, type } = fieldFromLabel(e.target.value)
                    setFields(
                      fields.map((x, idx) =>
                        idx === i ? { ...x, label: e.target.value, name, type } : x,
                      ),
                    )
                  }}
                  className="h-7 flex-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-brand-500 focus:outline-none"
                />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={!!f.required}
                    onChange={() =>
                      setFields(
                        fields.map((x, idx) => (idx === i ? { ...x, required: !x.required } : x)),
                      )
                    }
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  Req
                </label>
                <button
                  type="button"
                  onClick={() => setFields(fields.filter((_, idx) => idx !== i))}
                  title="Remove field"
                  className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
