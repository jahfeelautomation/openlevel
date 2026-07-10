import type { Proposal } from '../repos/proposals-repo'
import { formatMoneyCents, proposalTotalCents, readLineItems } from './proposal-math'
import type { RenderOpts } from './page-html'
import {
  CHECK_SVG,
  escAttr,
  escText,
  eyebrow,
  notFoundPage,
  pageShell,
  readStr,
  safeColor,
} from './page-html'

/**
 * Server-side renderer for a public, signable proposal. Pure: takes a proposal
 * and returns one self-contained HTML document (inline CSS, no external
 * requests, `noindex`) built from the same ./page-html shell every public
 * OpenLevel surface uses, so a proposal looks of-a-piece with a funnel, form or
 * survey.
 *
 * A proposal is a document: an intro, an itemised quote (the dollar total is
 * DERIVED from the line items here, never trusted from a stored field), optional
 * terms, and a signature block. The signature block is honest about state:
 *   - draft/sent/viewed -> a "type your name to accept" form (+ a quiet Decline)
 *   - signed            -> the real signer name + signed date, no form
 *   - declined          -> a plain "declined" note, no form
 * Signing posts to the proposal's own endpoint
 * (`POST /api/public/proposals/:loc/:slug/sign`); the route records the typed
 * name + a timestamp and fires the `proposal_signed` workflow trigger.
 */

const PUBLIC_BASE = '/api/public/proposals'

export type { RenderOpts }

export function renderProposalPage(proposal: Proposal, opts?: RenderOpts): string {
  const brand = safeColor(opts?.brandColor)
  const c = proposal.content
  const intro = readStr(c, 'intro')
  const terms = readStr(c, 'terms')
  const items = readLineItems(c)
  const total = proposalTotalCents(items)
  const currency = proposal.currency || 'usd'
  const title = proposal.title
  const signed = proposal.status === 'signed'
  const declined = proposal.status === 'declined'

  const base = `${PUBLIC_BASE}/${proposal.location_id}/${proposal.slug}`
  const signAction = `${base}/sign`
  const declineAction = `${base}/decline`

  const itemsTable =
    items.length > 0
      ? `<table class="ol-items">
        <thead><tr>
          <th>Item</th>
          <th class="ol-num">Qty</th>
          <th class="ol-num">Unit</th>
          <th class="ol-num">Amount</th>
        </tr></thead>
        <tbody>
          ${items
            .map(
              (it) => `<tr>
            <td class="ol-itemdesc">${escText(it.description)}</td>
            <td class="ol-num">${escText(String(it.quantity))}</td>
            <td class="ol-num">${escText(formatMoneyCents(it.unit_amount, currency))}</td>
            <td class="ol-num">${escText(formatMoneyCents(it.quantity * it.unit_amount, currency))}</td>
          </tr>`,
            )
            .join('\n')}
          <tr class="ol-total-row">
            <td></td>
            <td></td>
            <td class="ol-num ol-total-label">Total</td>
            <td class="ol-num ol-total">${escText(formatMoneyCents(total, currency))}</td>
          </tr>
        </tbody>
      </table>`
      : ''

  const termsHtml = terms
    ? `<div class="ol-terms">
        <h2 class="ol-terms-h">Terms</h2>
        <p class="ol-body">${escText(terms)}</p>
      </div>`
    : ''

  // The closing block depends on the real status — we never show a sign form for
  // an already-signed proposal, and never fake a signature.
  let closing: string
  if (signed) {
    closing = signedBanner(proposal, { visible: true })
  } else if (declined) {
    closing = `<div class="ol-center" style="border-top:1px solid #e7ebf0;padding-top:24px;margin-top:24px">
        <h2 class="ol-sign-h">Proposal declined</h2>
        <p class="ol-sign-lede">This proposal was declined. Contact us if that was a mistake.</p>
      </div>`
  } else {
    closing = `<form id="ol-proposal-form" class="ol-sign" action="${escAttr(signAction)}" method="post" novalidate>
        <h2 class="ol-sign-h">Sign to accept</h2>
        <p class="ol-sign-lede">Type your full name to accept this proposal${
          items.length > 0 ? ` for ${escText(formatMoneyCents(total, currency))}` : ''
        }.</p>
        <div class="ol-field">
          <label class="ol-label" for="ol-signer">Full name</label>
          <input class="ol-input" id="ol-signer" name="signer_name" type="text" placeholder="Your full name" required />
        </div>
        <button class="ol-cta" type="submit">Agree &amp; sign</button>
        <p class="ol-sign-note">By typing your name and clicking Agree &amp; sign, you agree this counts as your electronic signature accepting this proposal.</p>
      </form>
      <button class="ol-decline" id="ol-decline" type="button">Decline this proposal</button>
      ${signedBanner(proposal, { visible: false })}
      <div class="ol-center" id="ol-declined-note" style="display:none;border-top:1px solid #e7ebf0;padding-top:24px;margin-top:24px">
        <h2 class="ol-sign-h">Proposal declined</h2>
        <p class="ol-sign-lede">Thanks for letting us know.</p>
      </div>`
  }

  const body = `<div class="ol-card ol-wide">
      <div>
        ${eyebrow('Proposal')}
        <h1 class="ol-h1">${escText(title)}</h1>
      </div>
      ${intro ? `<p class="ol-body">${escText(intro)}</p>` : ''}
      ${itemsTable}
      ${termsHtml}
      ${closing}
      <p class="ol-status" id="ol-proposal-status"></p>
      <p class="ol-foot">Powered by OpenLevel.</p>
    </div>`

  // Only the signable state needs the client script; a finished proposal is static.
  const script =
    signed || declined
      ? undefined
      : proposalSignScript({
          formId: 'ol-proposal-form',
          statusId: 'ol-proposal-status',
          signedId: 'ol-signed-banner',
          declinedId: 'ol-declined-note',
          declineBtnId: 'ol-decline',
          declineUrl: declineAction,
        })
  return pageShell({ title, brand, body, script })
}

/**
 * The signed-state confirmation. Rendered visible when a proposal is already
 * signed (filled with the real stored name + date), or hidden when shown above a
 * sign form (the client script reveals and fills it from the server's response
 * after a successful signature). Either way the values come from the server —
 * nothing is invented client-side.
 */
function signedBanner(proposal: Proposal, opts: { visible: boolean }): string {
  const when = proposal.signed_at ? formatSignedDate(proposal.signed_at) : ''
  const nameHtml = opts.visible ? escText(proposal.signer_name ?? '') : ''
  const whenHtml = opts.visible && when ? `on ${escText(when)}` : ''
  const display = opts.visible ? 'block' : 'none'
  return `<div class="ol-center" id="ol-signed-banner" style="display:${display};border-top:1px solid #e7ebf0;padding-top:24px;margin-top:24px">
      <div class="ol-check">${CHECK_SVG}</div>
      <h2 class="ol-sign-h">Signed</h2>
      <p class="ol-signed-meta">Signed by <strong data-signer>${nameHtml}</strong> <span data-signed-when>${whenHtml}</span></p>
    </div>`
}

/** Format an ISO timestamp as a stable "June 3, 2026" (UTC, so it's
 *  deterministic regardless of server timezone — and testable). */
export function formatSignedDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The inline signature driver. The submit handler posts the typed name to the
 * sign endpoint and, on success, hides the form and reveals the signed banner
 * (filled from the server's response). The Decline button posts to the decline
 * endpoint behind a confirm() and reveals the declined note. There is exactly
 * one copy of this logic.
 */
export function proposalSignScript(opts: {
  formId: string
  statusId: string
  signedId: string
  declinedId: string
  declineBtnId: string
  declineUrl: string
}): string {
  const fid = JSON.stringify(opts.formId)
  const sid = JSON.stringify(opts.statusId)
  const okId = JSON.stringify(opts.signedId)
  const noId = JSON.stringify(opts.declinedId)
  const decId = JSON.stringify(opts.declineBtnId)
  const decUrl = JSON.stringify(opts.declineUrl)
  return `<script>
(function(){
  var form=document.getElementById(${fid});
  if(!form)return;
  var status=document.getElementById(${sid});
  var signed=document.getElementById(${okId});
  var declined=document.getElementById(${noId});
  var declineBtn=document.getElementById(${decId});
  function fmtDate(iso){try{return new Date(iso).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});}catch(e){return '';}}
  function fail(msg){if(status){status.textContent=msg;status.style.display='block';}}
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var el=form.querySelector('input[name="signer_name"]');
    var name=el?el.value.trim():'';
    if(!name){if(el){el.reportValidity();}return;}
    var btn=form.querySelector('button[type="submit"]');
    var label=btn?btn.textContent:'';
    if(btn){btn.disabled=true;btn.textContent='Signing…';}
    fetch(form.getAttribute('action'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signer_name:name})})
      .then(function(r){return r.json().catch(function(){return {};});})
      .then(function(data){
        if(data&&data.ok){
          form.style.display='none';
          if(declineBtn){declineBtn.style.display='none';}
          if(signed){
            var who=signed.querySelector('[data-signer]');if(who){who.textContent=data.signer_name||name;}
            var when=signed.querySelector('[data-signed-when]');if(when){when.textContent=data.signed_at?('on '+fmtDate(data.signed_at)):'';}
            signed.style.display='block';
          }
        }else{
          if(btn){btn.disabled=false;btn.textContent=label;}
          fail('Could not record your signature — please try again.');
        }
      })
      .catch(function(){
        if(btn){btn.disabled=false;btn.textContent=label;}
        fail('Network error — please try again.');
      });
  });
  if(declineBtn){
    declineBtn.addEventListener('click',function(e){
      e.preventDefault();
      if(!window.confirm('Decline this proposal?'))return;
      declineBtn.disabled=true;
      fetch(${decUrl},{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
        .then(function(r){return r.json().catch(function(){return {};});})
        .then(function(data){
          if(data&&data.ok){
            form.style.display='none';declineBtn.style.display='none';
            if(declined){declined.style.display='block';}
          }else{declineBtn.disabled=false;fail('Could not decline — please try again.');}
        })
        .catch(function(){declineBtn.disabled=false;fail('Network error — please try again.');});
    });
  }
})();
</script>`
}

/** A small styled 404 for an unknown/unsent proposal — still self-contained. */
export function renderProposalNotFound(): string {
  return notFoundPage('This proposal isn’t available, or the link is incorrect.')
}
