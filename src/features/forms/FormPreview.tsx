import type { FormContent } from '../../lib/api'

/**
 * A live, device-framed preview of a standalone form rendered from its
 * structured `content` — the same data the public page serves. It re-renders as
 * the editor changes, so the operator sees exactly what a visitor will get.
 * Non-interactive (inputs are disabled): a faithful preview, not the live form.
 */
export function FormPreview({
  content,
  brandColor,
  slug,
  name,
}: {
  content: FormContent
  brandColor: string
  slug: string
  name: string
}) {
  const fields = content.fields ?? []
  const headline = content.headline || name
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/40">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <div className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-slate-400 ring-1 ring-slate-200">
            yourbrand.com/forms/{slug}
          </div>
        </div>

        {/* Page canvas */}
        <div className="min-h-[440px] bg-gradient-to-b from-slate-50 to-white px-8 py-12">
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
            <div className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/60">
              <div className="space-y-3">
                {fields.length === 0 && (
                  <p className="text-center text-xs text-slate-400">
                    Add a field to start capturing leads.
                  </p>
                )}
                {fields.map((f) => (
                  <div key={f.name}>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      {f.label}
                      {f.required && <span className="ml-0.5 text-rose-500">*</span>}
                    </label>
                    <input
                      disabled
                      placeholder={f.label}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  disabled
                  className="mt-1 h-11 w-full rounded-lg text-sm font-semibold text-white shadow-sm"
                  style={{ backgroundColor: brandColor }}
                >
                  {content.cta || 'Submit'}
                </button>
              </div>
            </div>
            <p className="mt-4 text-center text-[11px] text-slate-400">
              Your details are kept private and never shared.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
