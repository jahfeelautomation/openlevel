import { useState } from 'react'
import type { SurveyContent, SurveyField } from '../../lib/api'
import { humanizeField } from './surveys-meta'

/**
 * A live, device-framed preview of a multi-step survey rendered from its
 * structured `content` — the same data the public page serves. It steps through
 * exactly like the live survey (progress bar, Back / Continue, Submit on the last
 * step) so the operator sees the real flow, but every input is disabled: a
 * faithful preview, not a working survey.
 */
export function SurveyPreview({
  content,
  brandColor,
  slug,
  name,
}: {
  content: SurveyContent
  brandColor: string
  slug: string
  name: string
}) {
  const steps = content.steps ?? []
  const total = steps.length
  const [step, setStep] = useState(0)
  const current = total > 0 ? Math.min(step, total - 1) : 0
  const active = steps[current]
  const headline = content.headline || name
  const pct = total > 0 ? Math.round(((current + 1) / total) * 100) : 0
  const isLast = current === total - 1

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/40">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <div className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-slate-400 ring-1 ring-slate-200">
            yourbrand.com/surveys/{slug}
          </div>
        </div>

        {/* Page canvas */}
        <div className="min-h-[460px] bg-gradient-to-b from-slate-50 to-white px-8 py-12">
          <div className="mx-auto max-w-md">
            <div className="text-center">
              <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight text-slate-900">
                {headline || 'Your headline goes here'}
              </h1>
              {content.subhead && (
                <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-slate-500">
                  {content.subhead}
                </p>
              )}
            </div>

            {total === 0 ? (
              <div className="mt-7 rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
                <p className="text-sm text-slate-400">Add a step to preview your survey.</p>
              </div>
            ) : (
              <div className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/60">
                {/* Progress */}
                <div className="mb-5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500">
                      {active?.title || `Step ${current + 1}`}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400">
                      Step {current + 1} of {total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: brandColor }}
                    />
                  </div>
                </div>

                {active?.subtitle && (
                  <p className="-mt-1 mb-4 text-sm text-slate-500">{active.subtitle}</p>
                )}

                <div className="space-y-3">
                  {(active?.fields ?? []).length === 0 && (
                    <p className="text-center text-xs text-slate-400">
                      This step has no questions yet.
                    </p>
                  )}
                  {(active?.fields ?? []).map((f, i) => (
                    <PreviewField key={`${f.name}-${i}`} field={f} />
                  ))}
                </div>

                {/* Buttons */}
                <div className="mt-5 flex items-center gap-2">
                  {current > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep(current - 1)}
                      className="h-11 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => !isLast && setStep(current + 1)}
                    className="h-11 flex-1 rounded-lg text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                    style={{ backgroundColor: brandColor }}
                  >
                    {isLast ? content.cta || 'Submit' : 'Continue'}
                  </button>
                </div>
              </div>
            )}

            <p className="mt-4 text-center text-[11px] text-slate-400">
              Your answers are kept private and never shared.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Renders one disabled preview input matching the field's type. */
function PreviewField({ field }: { field: SurveyField }) {
  const label = field.label || humanizeField(field.name)
  const type = field.type || 'text'
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {field.required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          disabled
          rows={3}
          placeholder={label}
          className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
        />
      ) : type === 'select' ? (
        <select
          disabled
          className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400"
        >
          <option>{(field.options ?? [])[0] ?? 'Choose…'}</option>
        </select>
      ) : (
        <input
          disabled
          placeholder={label}
          className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400"
        />
      )}
    </div>
  )
}
