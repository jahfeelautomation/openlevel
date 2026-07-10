import type { Survey } from '../repos/surveys-repo'
import type { RenderOpts } from './page-html'
import {
  CHECK_SVG,
  escAttr,
  escText,
  eyebrow,
  notFoundPage,
  pageShell,
  readStr,
  readSteps,
  renderField,
  safeColor,
} from './page-html'

/**
 * Server-side renderer for a public multi-step survey. Pure: takes a survey and
 * returns one self-contained HTML document (inline CSS, no external requests,
 * `noindex`) built from the same ./page-html shell, styling and field markup a
 * form or funnel uses — so every public capture surface looks identical.
 *
 * A survey differs from a form in one way: its questions are split across an
 * ordered set of `content.steps`, shown one page at a time behind a progress
 * bar. All steps live in a single `<form>`; a dedicated client script (see
 * `surveyScript`) advances between steps — validating only the visible step —
 * and posts EVERY field's value once, at the end, to the survey's own endpoint
 * (`POST /api/public/surveys/:loc/:slug/submit`). The route behind that endpoint
 * stores the submission and bumps the honest counter.
 */

const PUBLIC_BASE = '/api/public/surveys'
const DEFAULT_SUCCESS = 'Thanks — your answers are in.'

export type { RenderOpts }

export function renderSurveyPage(survey: Survey, opts?: RenderOpts): string {
  const brand = safeColor(opts?.brandColor)
  const c = survey.content
  const steps = readSteps(c)
  const headline = readStr(c, 'headline') || survey.name
  const sub = readStr(c, 'subhead')
  const success = readStr(c, 'successMessage') || DEFAULT_SUCCESS
  const action = `${PUBLIC_BASE}/${survey.location_id}/${survey.slug}/submit`
  const title = headline || survey.name
  const total = steps.length

  // A published-but-empty survey is a misconfiguration, not a 404; render a
  // clean shell rather than a broken form with no submit control.
  if (total === 0) {
    const empty = `<div class="ol-card ol-center">
      ${eyebrow(survey.name)}
      <h1 class="ol-h1">${escText(headline)}</h1>
      ${sub ? `<p class="ol-sub">${escText(sub)}</p>` : ''}
      <p class="ol-foot">This survey has no questions yet.</p>
    </div>`
    return pageShell({ title, brand, body: empty })
  }

  const finalCta = readStr(c, 'cta') || 'Submit'
  const stepsHtml = steps
    .map((step, idx) => {
      const isLast = idx === total - 1
      const stitle = step.title ? `<h2 class="ol-steptitle">${escText(step.title)}</h2>` : ''
      const ssub = step.subtitle ? `<p class="ol-stepsub">${escText(step.subtitle)}</p>` : ''
      const fields = step.fields.map(renderField).join('\n')
      const back =
        idx > 0 ? '<button class="ol-back" type="button" data-back>Back</button>' : ''
      const next = isLast
        ? `<button class="ol-cta" type="submit">${escText(finalCta)}</button>`
        : '<button class="ol-cta" type="button" data-next>Continue</button>'
      return `<div class="ol-step${idx === 0 ? ' ol-active' : ''}" data-step="${idx}">
        ${stitle}
        ${ssub}
        ${fields}
        <div class="ol-btnrow">${back}${next}</div>
      </div>`
    })
    .join('\n')

  const firstPct = Math.round((1 / total) * 100)
  const body = `<div class="ol-card ol-wide">
      <div class="ol-center">
        ${eyebrow(survey.name)}
        <h1 class="ol-h1">${escText(headline)}</h1>
        ${sub ? `<p class="ol-sub">${escText(sub)}</p>` : ''}
      </div>
      <div class="ol-progress">
        <div class="ol-progress-track"><div class="ol-progress-bar" id="ol-progress-bar" style="width:${firstPct}%"></div></div>
        <span class="ol-stepcount" id="ol-stepcount">Step 1 of ${total}</span>
      </div>
      <form id="ol-survey-form" action="${escAttr(action)}" method="post" novalidate>
        ${stepsHtml}
      </form>
      <div class="ol-center" id="ol-survey-success" style="display:none">
        <div class="ol-check">${CHECK_SVG}</div>
        <h1 class="ol-h1">${escText(success)}</h1>
      </div>
      <p class="ol-status" id="ol-survey-status"></p>
      <p class="ol-foot">Your answers are kept private and never shared.</p>
    </div>`

  const script = surveyScript({
    formId: 'ol-survey-form',
    statusId: 'ol-survey-status',
    successId: 'ol-survey-success',
    progressBarId: 'ol-progress-bar',
    stepCountId: 'ol-stepcount',
    total,
  })
  return pageShell({ title, brand, body, script })
}

/**
 * The inline multi-step driver. Walks the visitor through `.ol-step` pages:
 * Continue validates only the visible step (so required fields can't be skipped)
 * then reveals the next; Back returns; the final step's submit collects EVERY
 * field across all steps and posts once. There is exactly one copy of this.
 */
export function surveyScript(opts: {
  formId: string
  statusId: string
  successId: string
  progressBarId: string
  stepCountId: string
  total: number
}): string {
  const fid = JSON.stringify(opts.formId)
  const sid = JSON.stringify(opts.statusId)
  const okId = JSON.stringify(opts.successId)
  const barId = JSON.stringify(opts.progressBarId)
  const countId = JSON.stringify(opts.stepCountId)
  const total = JSON.stringify(opts.total)
  return `<script>
(function(){
  var form=document.getElementById(${fid});
  if(!form)return;
  var status=document.getElementById(${sid});
  var success=document.getElementById(${okId});
  var bar=document.getElementById(${barId});
  var count=document.getElementById(${countId});
  var total=${total};
  var steps=form.querySelectorAll('.ol-step');
  var i=0;
  function show(n){
    for(var k=0;k<steps.length;k++){steps[k].classList.toggle('ol-active',k===n);}
    i=n;
    if(bar){bar.style.width=Math.round(((n+1)/total)*100)+'%';}
    if(count){count.textContent='Step '+(n+1)+' of '+total;}
    if(status){status.style.display='none';}
    var f=steps[n]?steps[n].querySelector('input,textarea,select'):null;
    if(f){try{f.focus();}catch(e){}}
  }
  function validStep(n){
    var step=steps[n];if(!step)return true;
    var els=step.querySelectorAll('input[name],textarea[name],select[name]');
    for(var j=0;j<els.length;j++){
      if(!els[j].checkValidity()){els[j].reportValidity();return false;}
    }
    return true;
  }
  form.addEventListener('click',function(e){
    var t=e.target;
    if(!t||!t.hasAttribute)return;
    if(t.hasAttribute('data-next')){
      e.preventDefault();
      if(validStep(i)&&i<steps.length-1){show(i+1);}
    }else if(t.hasAttribute('data-back')){
      e.preventDefault();
      if(i>0){show(i-1);}
    }
  });
  form.addEventListener('submit',function(e){
    e.preventDefault();
    if(!validStep(i))return;
    var values={};
    var els=form.querySelectorAll('input[name], textarea[name], select[name]');
    for(var k=0;k<els.length;k++){values[els[k].name]=els[k].value;}
    var btn=form.querySelector('button[type="submit"]');
    var label=btn?btn.textContent:'';
    if(btn){btn.disabled=true;btn.textContent='Sending…';}
    fetch(form.getAttribute('action'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:values})})
      .then(function(r){return r.json().catch(function(){return {};});})
      .then(function(data){
        if(data&&data.ok){
          form.style.display='none';
          var prog=document.querySelector('.ol-progress');if(prog){prog.style.display='none';}
          if(success){success.style.display='block';}
        }else{
          if(btn){btn.disabled=false;btn.textContent=label;}
          if(status){status.textContent='Please check your details and try again.';status.style.display='block';}
        }
      })
      .catch(function(){
        if(btn){btn.disabled=false;btn.textContent=label;}
        if(status){status.textContent='Network error — please try again.';status.style.display='block';}
      });
  });
})();
</script>`
}

/** A small styled 404 for an unpublished/unknown survey — still self-contained. */
export function renderSurveyNotFound(): string {
  return notFoundPage('This survey isn’t published, or the link is incorrect.')
}
