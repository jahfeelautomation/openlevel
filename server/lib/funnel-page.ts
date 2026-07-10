import type { FunnelStep } from '../repos/funnel-steps-repo'
import type { Funnel } from '../repos/funnels-repo'
import type { RenderOpts } from './page-html'
import {
  CHECK_SVG,
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
 * Server-side renderer for a public funnel page. Pure: it takes a funnel + the
 * step a visitor is on and returns a single self-contained HTML document
 * (inline CSS, no external requests) that a browser can render on its own. This
 * is what makes a *published* funnel an actually-hostable landing page rather
 * than a JSON blob — the operator's "View live" link points at real HTML.
 *
 * The shared document shell, styling, field markup and capture script live in
 * ./page-html so a funnel opt-in and a standalone form look identical. The
 * opt-in form posts via that one inline `fetch()` to the EXISTING capture
 * endpoint (`POST /api/public/f/:loc/:slug/:path/submit`) — there is no second
 * copy of the capture logic. On success it advances to the next step (or shows
 * an inline confirmation), mirroring how a real funnel flows opt-in → thank-you.
 */

const PUBLIC_BASE = '/api/public/f'

export type { RenderOpts }

/** The path of the next step after this one (by position), or null if last. */
function nextPath(step: FunnelStep, allSteps: FunnelStep[]): string | null {
  const after = allSteps
    .filter((s) => s.position > step.position)
    .sort((a, b) => a.position - b.position)
  return after[0]?.path ?? null
}

// --- per-type bodies ------------------------------------------------------

function optInBody(funnel: Funnel, step: FunnelStep): string {
  const c = step.content
  const headline = readStr(c, 'headline') || funnel.name
  const sub = readStr(c, 'subhead')
  const cta = readStr(c, 'cta') || 'Submit'
  const action = `${PUBLIC_BASE}/${funnel.location_id}/${funnel.slug}/${step.path}/submit`
  const inputs = readFields(c).map(renderField).join('\n')
  return `<div class="ol-card ol-center">
      ${eyebrow(funnel.name)}
      <h1 class="ol-h1">${escText(headline)}</h1>
      ${sub ? `<p class="ol-sub">${escText(sub)}</p>` : ''}
      <form id="ol-funnel-form" action="${escAttr(action)}" method="post" novalidate>
        ${inputs}
        <button class="ol-cta" type="submit">${escText(cta)}</button>
      </form>
      <p class="ol-status" id="ol-form-status"></p>
      <p class="ol-foot">Your details are kept private and never shared.</p>
    </div>`
}

function salesBody(funnel: Funnel, step: FunnelStep, allSteps: FunnelStep[]): string {
  const c = step.content
  const headline = readStr(c, 'headline') || funnel.name
  const sub = readStr(c, 'subhead')
  const body = readStr(c, 'body')
  const cta = readStr(c, 'cta') || 'Continue'
  const next = nextPath(step, allSteps)
  const ctaHtml = next
    ? `<a class="ol-cta" href="${escAttr(`${PUBLIC_BASE}/${funnel.location_id}/${funnel.slug}/${next}`)}">${escText(cta)}</a>`
    : `<button class="ol-cta" type="button">${escText(cta)}</button>`
  return `<div class="ol-card ol-wide">
      ${eyebrow(funnel.name)}
      <h1 class="ol-h1">${escText(headline)}</h1>
      ${sub ? `<p class="ol-sub">${escText(sub)}</p>` : ''}
      ${body ? `<div class="ol-body">${escText(body)}</div>` : ''}
      ${ctaHtml}
    </div>`
}

function thankYouBody(step: FunnelStep): string {
  const c = step.content
  const headline = readStr(c, 'headline') || 'Thank you'
  const body = readStr(c, 'body')
  return `<div class="ol-card ol-center">
      <div class="ol-check">${CHECK_SVG}</div>
      <h1 class="ol-h1">${escText(headline)}</h1>
      ${body ? `<p class="ol-sub">${escText(body)}</p>` : ''}
    </div>`
}

// --- public API -----------------------------------------------------------

export function renderFunnelPage(
  funnel: Funnel,
  step: FunnelStep,
  allSteps: FunnelStep[],
  opts?: RenderOpts,
): string {
  const brand = safeColor(opts?.brandColor)
  const title = readStr(step.content, 'headline') || step.name || funnel.name

  if (step.type === 'thank_you') {
    return pageShell({ title, brand, body: thankYouBody(step) })
  }
  if (step.type === 'sales') {
    return pageShell({ title, brand, body: salesBody(funnel, step, allSteps) })
  }

  // opt_in (and any future capture type): a real form wired to the existing
  // submit endpoint, advancing to the next step on success.
  const nextBase = `${PUBLIC_BASE}/${funnel.location_id}/${funnel.slug}/`
  const script = captureScript({
    formId: 'ol-funnel-form',
    statusId: 'ol-form-status',
    nextBase,
    successText: 'Thanks — we got your details.',
  })
  return pageShell({ title, brand, body: optInBody(funnel, step), script })
}

/** A small styled 404 for an unpublished/unknown funnel — still self-contained. */
export function renderFunnelNotFound(): string {
  return notFoundPage('This funnel isn’t published, or the link is incorrect.')
}
