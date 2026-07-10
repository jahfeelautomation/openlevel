import { Plus, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import type { FunnelField, FunnelStepContent, FunnelStepType } from '../../lib/api'
import { STEP_TYPE_OPTIONS, fieldFromLabel } from './sites-meta'

export interface DraftState {
  name: string
  path: string
  type: FunnelStepType
  content: FunnelStepContent
}

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30'

const sanitizePath = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')

/** The right-pane settings editor for one funnel page. It owns no state — it
 *  reflects `draft` and reports every edit through `onChange`, so the center
 *  preview re-renders live as the operator types. */
export function StepEditor({
  draft,
  slug,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  draft: DraftState
  slug: string
  dirty: boolean
  saving: boolean
  onChange: (next: DraftState) => void
  onSave: () => void
}) {
  const setContent = (patch: Partial<FunnelStepContent>) =>
    onChange({ ...draft, content: { ...draft.content, ...patch } })
  const setField = (patch: Partial<Pick<DraftState, 'name' | 'path' | 'type'>>) =>
    onChange({ ...draft, ...patch })

  const fields = draft.content.fields ?? []
  const setFields = (next: FunnelField[]) => setContent({ fields: next })

  const isOptIn = draft.type === 'opt_in'
  const isSales = draft.type === 'sales'
  const isThanks = draft.type === 'thank_you'

  return (
    <div className="flex w-full flex-col border-t border-slate-200 bg-white lg:h-full lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Page settings
        </p>
        <Button size="sm" variant={dirty ? 'brand' : 'outline'} disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>

      <div className="ol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <Label htmlFor="st-name">Page name</Label>
          <Input
            id="st-name"
            value={draft.name}
            onChange={(e) => setField({ name: e.target.value })}
          />
        </div>

        <div>
          <Label htmlFor="st-type">Page type</Label>
          <select
            id="st-type"
            value={draft.type}
            onChange={(e) => setField({ type: e.target.value as FunnelStepType })}
            className={selectClass}
          >
            {STEP_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="st-path">URL path</Label>
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30">
            <span className="truncate text-xs text-slate-400">/f/{slug}/</span>
            <input
              id="st-path"
              value={draft.path}
              onChange={(e) => setField({ path: sanitizePath(e.target.value) })}
              className="h-10 flex-1 bg-transparent px-1 text-sm text-slate-900 focus:outline-none"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <Label htmlFor="st-headline">Headline</Label>
          <Input
            id="st-headline"
            value={draft.content.headline ?? ''}
            onChange={(e) => setContent({ headline: e.target.value })}
            placeholder="Your big promise"
          />
        </div>

        {(isOptIn || isSales) && (
          <div>
            <Label htmlFor="st-subhead">Subheadline</Label>
            <Textarea
              id="st-subhead"
              rows={2}
              value={draft.content.subhead ?? ''}
              onChange={(e) => setContent({ subhead: e.target.value })}
              placeholder="A supporting line under the headline"
            />
          </div>
        )}

        {(isSales || isThanks) && (
          <div>
            <Label htmlFor="st-body">Body</Label>
            <Textarea
              id="st-body"
              rows={4}
              value={draft.content.body ?? ''}
              onChange={(e) => setContent({ body: e.target.value })}
              placeholder="The main copy of the page"
            />
          </div>
        )}

        {(isOptIn || isSales) && (
          <div>
            <Label htmlFor="st-cta">Button text</Label>
            <Input
              id="st-cta"
              value={draft.content.cta ?? ''}
              onChange={(e) => setContent({ cta: e.target.value })}
              placeholder={isOptIn ? 'Get my offer' : 'Buy now'}
            />
          </div>
        )}

        {isOptIn && (
          <>
            <div>
              <Label htmlFor="st-tag">Tag applied on submit</Label>
              <Input
                id="st-tag"
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
          </>
        )}
      </div>
    </div>
  )
}
