import type { Form } from '../repos/forms-repo'
import type { RenderOpts } from './page-html'
import {
  captureScript,
  escAttr,
  escText,
  eyebrow,
  notFoundPage,
  pageShell,
  readFields,
  readStr,
  renderField,
  safeColor,
} from './page-html'

/**
 * Server-side renderer for a public standalone form. Pure: it takes a form and
 * returns one self-contained HTML document (inline CSS, no external requests)
 * built from the same ./page-html shell, styling and field markup a funnel
 * opt-in uses — so the two are visually identical to a visitor.
 *
 * Unlike a funnel (an ordered set of steps), a form is single-page: the visitor
 * submits once and stays put. The shared capture script posts the field values
 * as JSON to the form's own endpoint (`POST /api/public/forms/:loc/:slug/submit`)
 * and, because a form has no `next` step, shows the operator-authored success
 * message inline. The route behind that endpoint additionally STORES the
 * submission — the capability that distinguishes a form from a funnel step.
 */

const PUBLIC_BASE = '/api/public/forms'
const DEFAULT_SUCCESS = 'Thanks — we got your details.'

export type { RenderOpts }

export function renderFormPage(form: Form, opts?: RenderOpts): string {
  const brand = safeColor(opts?.brandColor)
  const c = form.content
  const headline = readStr(c, 'headline') || form.name
  const sub = readStr(c, 'subhead')
  const cta = readStr(c, 'cta') || 'Submit'
  const success = readStr(c, 'successMessage') || DEFAULT_SUCCESS
  const action = `${PUBLIC_BASE}/${form.location_id}/${form.slug}/submit`
  const inputs = readFields(c).map(renderField).join('\n')
  const title = headline || form.name

  const body = `<div class="ol-card ol-center">
      ${eyebrow(form.name)}
      <h1 class="ol-h1">${escText(headline)}</h1>
      ${sub ? `<p class="ol-sub">${escText(sub)}</p>` : ''}
      <form id="ol-lead-form" action="${escAttr(action)}" method="post" novalidate>
        ${inputs}
        <button class="ol-cta" type="submit">${escText(cta)}</button>
      </form>
      <p class="ol-status" id="ol-lead-status"></p>
      <p class="ol-foot">Your details are kept private and never shared.</p>
    </div>`

  // Single-page: no next step, so nextBase is empty and the script always shows
  // the inline success message rather than redirecting.
  const script = captureScript({
    formId: 'ol-lead-form',
    statusId: 'ol-lead-status',
    nextBase: '',
    successText: success,
  })
  return pageShell({ title, brand, body, script })
}

/** A small styled 404 for an unpublished/unknown form — still self-contained. */
export function renderFormNotFound(): string {
  return notFoundPage('This form isn’t published, or the link is incorrect.')
}
