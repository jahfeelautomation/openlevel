import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import type { SurveyContent, SurveyField, SurveyStep } from '../../lib/api'
import { FIELD_TYPE_OPTIONS, LABEL_DERIVED_TYPES, fieldFromLabel, uid } from './surveys-meta'

export interface SurveyDraft {
  name: string
  content: SurveyContent
}

/** The right-pane builder for one survey. It owns no state — it reflects `draft`
 *  and reports every edit through `onChange`, so the center preview re-renders
 *  live. Unlike a single-page form, a survey is a list of STEPS, each with its
 *  own questions; the operator adds, reorders, and removes both. */
export function SurveyEditor({
  draft,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  draft: SurveyDraft
  dirty: boolean
  saving: boolean
  onChange: (next: SurveyDraft) => void
  onSave: () => void
}) {
  const setContent = (patch: Partial<SurveyContent>) =>
    onChange({ ...draft, content: { ...draft.content, ...patch } })

  const steps = draft.content.steps ?? []
  const setSteps = (next: SurveyStep[]) => setContent({ steps: next })

  const updateStep = (si: number, patch: Partial<SurveyStep>) =>
    setSteps(steps.map((s, i) => (i === si ? { ...s, ...patch } : s)))

  const removeStep = (si: number) => setSteps(steps.filter((_, i) => i !== si))

  const moveStep = (si: number, dir: -1 | 1) => {
    const sj = si + dir
    if (sj < 0 || sj >= steps.length) return
    const next = steps.slice()
    const a = next[si]
    const b = next[sj]
    if (!a || !b) return
    next[si] = b
    next[sj] = a
    setSteps(next)
  }

  const addStep = () =>
    setSteps([
      ...steps,
      { id: uid('step'), title: `Step ${steps.length + 1}`, fields: [] },
    ])

  const setFields = (si: number, next: SurveyField[]) => updateStep(si, { fields: next })

  const updateField = (si: number, fi: number, patch: Partial<SurveyField>) =>
    setFields(
      si,
      (steps[si]?.fields ?? []).map((f, j) => (j === fi ? { ...f, ...patch } : f)),
    )

  const removeField = (si: number, fi: number) =>
    setFields(si, (steps[si]?.fields ?? []).filter((_, j) => j !== fi))

  const addField = (si: number) =>
    setFields(si, [
      ...(steps[si]?.fields ?? []),
      { name: uid('q'), label: 'New question', type: 'text' },
    ])

  return (
    <div className="flex w-full flex-col border-t border-slate-200 bg-white lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Survey settings
        </p>
        <Button size="sm" variant={dirty ? 'brand' : 'outline'} disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>

      <div className="ol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <Label htmlFor="sv-name">Survey name</Label>
          <Input
            id="sv-name"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <Label htmlFor="sv-headline">Headline</Label>
          <Input
            id="sv-headline"
            value={draft.content.headline ?? ''}
            onChange={(e) => setContent({ headline: e.target.value })}
            placeholder="Tell us about your project"
          />
        </div>

        <div>
          <Label htmlFor="sv-subhead">Subheadline</Label>
          <Textarea
            id="sv-subhead"
            rows={2}
            value={draft.content.subhead ?? ''}
            onChange={(e) => setContent({ subhead: e.target.value })}
            placeholder="A supporting line under the headline"
          />
        </div>

        <div>
          <Label htmlFor="sv-cta">Final button text</Label>
          <Input
            id="sv-cta"
            value={draft.content.cta ?? ''}
            onChange={(e) => setContent({ cta: e.target.value })}
            placeholder="Submit"
          />
        </div>

        <div>
          <Label htmlFor="sv-success">Success message</Label>
          <Textarea
            id="sv-success"
            rows={2}
            value={draft.content.successMessage ?? ''}
            onChange={(e) => setContent({ successMessage: e.target.value })}
            placeholder="Thanks — your answers are in."
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Shown in place of the survey once a visitor finishes.
          </p>
        </div>

        <div>
          <Label htmlFor="sv-tag">Tag applied on submit</Label>
          <Input
            id="sv-tag"
            value={draft.content.tag ?? ''}
            onChange={(e) => setContent({ tag: e.target.value })}
            placeholder="lead"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Every lead who completes the survey is tagged this, which can start an automation.
          </p>
        </div>

        {/* Steps builder */}
        <div className="border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">Steps</Label>
            <span className="text-xs text-slate-400">
              {steps.length} {steps.length === 1 ? 'step' : 'steps'}
            </span>
          </div>

          <div className="space-y-3">
            {steps.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                No steps yet — add one to start asking questions.
              </p>
            )}

            {steps.map((step, si) => (
              <div
                key={step.id ?? si}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-100 text-xs font-semibold text-brand-700">
                    {si + 1}
                  </span>
                  <input
                    value={step.title ?? ''}
                    onChange={(e) => updateStep(si, { title: e.target.value })}
                    placeholder="Step title"
                    className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconBtn
                      title="Move step up"
                      disabled={si === 0}
                      onClick={() => moveStep(si, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      title="Move step down"
                      disabled={si === steps.length - 1}
                      onClick={() => moveStep(si, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn title="Remove step" danger onClick={() => removeStep(si)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                </div>

                <input
                  value={step.subtitle ?? ''}
                  onChange={(e) => updateStep(si, { subtitle: e.target.value })}
                  placeholder="Optional subtitle"
                  className="mt-2 h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />

                <div className="mt-2.5 space-y-2">
                  {(step.fields ?? []).map((f, fi) => (
                    <div
                      key={`${f.name}-${fi}`}
                      className="rounded-lg border border-slate-200 bg-white p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          value={f.label ?? ''}
                          onChange={(e) => {
                            const label = e.target.value
                            const derived = fieldFromLabel(label)
                            const type =
                              f.type && !LABEL_DERIVED_TYPES.has(f.type) ? f.type : derived.type
                            updateField(si, fi, { label, name: derived.name, type })
                          }}
                          placeholder="Question label"
                          className="h-7 flex-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-brand-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeField(si, fi)}
                          title="Remove question"
                          className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <select
                          value={f.type ?? 'text'}
                          onChange={(e) => {
                            const type = e.target.value
                            const patch: Partial<SurveyField> = { type }
                            if (type === 'select' && !(f.options && f.options.length))
                              patch.options = ['Option 1', 'Option 2']
                            updateField(si, fi, patch)
                          }}
                          className="h-7 flex-1 rounded border border-slate-200 bg-white px-1.5 text-xs text-slate-700 focus:border-brand-500 focus:outline-none"
                        >
                          {FIELD_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
                          <input
                            type="checkbox"
                            checked={!!f.required}
                            onChange={() => updateField(si, fi, { required: !f.required })}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          Required
                        </label>
                      </div>

                      {f.type === 'select' && (
                        <div className="mt-2">
                          <input
                            value={(f.options ?? []).join(', ')}
                            onChange={(e) =>
                              updateField(si, fi, {
                                options: e.target.value
                                  .split(',')
                                  .map((o) => o.trim())
                                  .filter(Boolean),
                              })
                            }
                            placeholder="Option 1, Option 2, Option 3"
                            className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-brand-500 focus:outline-none"
                          />
                          <p className="mt-1 text-[10px] text-slate-400">
                            Separate choices with commas.
                          </p>
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addField(si)}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add question
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addStep}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add step
          </button>
        </div>
      </div>
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        danger
          ? 'rounded p-1 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600'
          : 'rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent'
      }
    >
      {children}
    </button>
  )
}
