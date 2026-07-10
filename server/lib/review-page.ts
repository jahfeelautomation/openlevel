import type { ReviewRequest } from '../repos/review-requests-repo'
import { CHECK_SVG, escAttr, escText, eyebrow, jsonForScript, notFoundPage, pageShell, safeColor } from './page-html'

/**
 * Server-side renderer for the public, unauthenticated review page — the same
 * self-contained document language (inline CSS via the `--brand` variable, no
 * external requests, `noindex`) the funnel and form pages use, so a review
 * invite looks like the rest of the brand's hosted pages to a customer.
 *
 * A review posts a different shape than a form ({rating, body, name} rather than
 * a free field map), so this file carries its own small submit script instead of
 * the shared captureScript. The star picker is pure CSS + radio inputs (no
 * framework), accessible by keyboard, and the comment is optional. Nothing here
 * fabricates anything — it only collects what the customer chooses to give.
 */

const PUBLIC_BASE = '/api/public/reviews'

export interface ReviewPageOpts {
  brandColor?: string
  /** The location's display name, shown in the eyebrow + prompt. */
  businessName: string
  /** Prefill for the name field — the contact we asked, if we know them. */
  reviewerName?: string | null
}

// Review-only styling, injected per page so the shared form/funnel CSS stays
// lean. The star row is laid out reversed so DOM order 5→1 displays 1→5 left to
// right, which lets `:hover ~ label` and `:checked ~ label` fill from the left.
const REVIEW_STYLE = `<style>
.ol-stars{display:inline-flex;flex-direction:row-reverse;justify-content:center;gap:8px;margin:8px 0 22px}
.ol-stars input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.ol-stars label{font-size:46px;line-height:1;color:#d7dde5;cursor:pointer;transition:color .12s,transform .05s;user-select:none}
.ol-stars label:hover,.ol-stars label:hover ~ label,.ol-stars input:checked ~ label{color:var(--brand)}
.ol-stars input:focus-visible + label{outline:2px solid var(--brand);outline-offset:3px;border-radius:6px}
.ol-stars label:active{transform:scale(1.12)}
.ol-textarea{height:auto;min-height:104px;padding:12px 14px;resize:vertical;font-family:inherit;line-height:1.5}
</style>`

/** The five star radios, DOM-ordered 5→1 (see REVIEW_STYLE for why). */
function starInputs(): string {
  return [5, 4, 3, 2, 1]
    .map((n) => {
      const label = `${n} star${n === 1 ? '' : 's'}`
      return `<input type="radio" name="rating" id="ol-star-${n}" value="${n}" />` +
        `<label for="ol-star-${n}" title="${label}" aria-label="${label}">★</label>`
    })
    .join('')
}

/** This page's own submit handler: posts {rating, body, name} and shows an inline
 *  thank-you. Separate from the shared form captureScript by design. */
function reviewCaptureScript(successText: string): string {
  const ok = jsonForScript(successText)
  return `<script>
(function(){
  var form=document.getElementById('ol-review-form');
  if(!form)return;
  var status=document.getElementById('ol-review-status');
  var btn=form.querySelector('button[type="submit"]');
  var label=btn?btn.textContent:'';
  function fail(msg){if(btn){btn.disabled=false;btn.textContent=label;}if(status){status.textContent=msg;status.style.display='block';}}
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var checked=form.querySelector('input[name="rating"]:checked');
    if(!checked){fail('Please choose a star rating.');return;}
    var bodyEl=form.querySelector('textarea[name="body"]');
    var nameEl=form.querySelector('input[name="name"]');
    var payload={rating:parseInt(checked.value,10),body:bodyEl?bodyEl.value:'',name:nameEl?nameEl.value:''};
    if(btn){btn.disabled=true;btn.textContent='Sending…';}
    fetch(form.getAttribute('action'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json().catch(function(){return {};});})
      .then(function(data){
        if(data&&data.ok){form.style.display='none';if(status){status.textContent=${ok};status.style.display='block';}}
        else{fail('Please check your details and try again.');}
      })
      .catch(function(){fail('Network error — please try again.');});
  });
})();
</script>`
}

export function renderReviewPage(
  request: Pick<ReviewRequest, 'location_id' | 'token'>,
  opts: ReviewPageOpts,
): string {
  const brand = safeColor(opts.brandColor)
  const business = opts.businessName
  const action = `${PUBLIC_BASE}/${escAttr(request.location_id)}/${escAttr(request.token)}/submit`
  const nameValue = escAttr(opts.reviewerName ?? '')
  const success = `Thank you! Your review helps ${business}.`

  const body = `<div class="ol-card ol-center">
      ${REVIEW_STYLE}
      ${eyebrow(business)}
      <h1 class="ol-h1">How did we do?</h1>
      <p class="ol-sub">Your honest feedback helps ${escText(business)} and other customers. It only takes a moment.</p>
      <form id="ol-review-form" action="${action}" method="post" novalidate>
        <div class="ol-stars" role="radiogroup" aria-label="Star rating">
          ${starInputs()}
        </div>
        <div class="ol-field">
          <label class="ol-label" for="ol-review-name">Your name</label>
          <input class="ol-input" id="ol-review-name" name="name" type="text" placeholder="Your name" value="${nameValue}" />
        </div>
        <div class="ol-field">
          <label class="ol-label" for="ol-review-body">Tell us more (optional)</label>
          <textarea class="ol-input ol-textarea" id="ol-review-body" name="body" rows="4" placeholder="What stood out?"></textarea>
        </div>
        <button class="ol-cta" type="submit">Submit review</button>
      </form>
      <p class="ol-status" id="ol-review-status"></p>
      <p class="ol-foot">Your feedback is shared only with ${escText(business)}.</p>
    </div>`

  return pageShell({ title: `Review ${business}`, brand, body, script: reviewCaptureScript(success) })
}

/** Confirmation page — shown when a link was already used, or as a generic
 *  thank-you. Self-contained like the form/funnel success states. */
export function renderReviewDone(opts: {
  businessName: string
  brandColor?: string
  message?: string
}): string {
  const brand = safeColor(opts.brandColor)
  const message = opts.message ?? 'Thanks for your feedback.'
  const body = `<div class="ol-card ol-center">
      <div class="ol-check">${CHECK_SVG}</div>
      ${eyebrow(opts.businessName)}
      <h1 class="ol-h1">Thank you</h1>
      <p class="ol-sub">${escText(message)}</p>
    </div>`
  return pageShell({ title: 'Thank you', brand, body })
}

/** A small styled 404 for an invalid/expired review link — still self-contained. */
export function renderReviewNotFound(): string {
  return notFoundPage('This review link is invalid or has expired.')
}
