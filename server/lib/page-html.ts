/**
 * Shared server-side HTML building blocks for OpenLevel's public pages — funnel
 * steps and standalone forms. Both are self-contained documents (inline CSS via
 * a `--brand` CSS variable, no external requests, `noindex`) so a *published*
 * page is an actually-hostable landing page rather than a JSON blob. Keeping the
 * visual language in one place means a funnel opt-in and a lead form look
 * identical to a visitor, and a polish pass lands on both at once.
 *
 * Everything here is pure (string in, string out) and side-effect free, so the
 * renderers that compose it stay trivially testable.
 */

export const DEFAULT_BRAND = '#4f46e5'

export interface RenderOpts {
  /** Location branding color used for the CTA and accents. */
  brandColor?: string
}

export interface FormField {
  name: string
  label?: string
  type?: string
  required?: boolean
  /** Choices for a `select` field. Ignored by text/textarea inputs. */
  options?: string[]
}

/**
 * One page of a multi-step survey. A survey's `content.steps` is an ordered
 * array of these; each step shows its own title/subtitle and a slice of the
 * capture fields. Forms are the degenerate single-step case and don't use this.
 */
export interface SurveyStep {
  id?: string
  title?: string
  subtitle?: string
  fields: FormField[]
}

// --- small, safe primitives ----------------------------------------------

/** Escape for an HTML text node (quotes are safe between tags). */
export function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape for a double-quoted HTML attribute value. */
export function escAttr(s: string): string {
  return escText(s).replace(/"/g, '&quot;')
}

/**
 * Serialize a value for safe embedding INSIDE an inline `<script>` element.
 * Plain JSON.stringify is NOT enough: it leaves the literal substring
 * `</script>` (and the `<!--` comment opener, and the JS line separators
 * U+2028/U+2029) intact, so a value containing `</script>` would close the
 * script element early and let an attacker inject a fresh one — a stored-XSS
 * vector whenever the value is operator- or visitor-supplied. Escaping `<`,
 * `>`, `&`, and the two separators to their `\uXXXX` forms keeps the output
 * valid JSON (a browser's JSON.parse recovers the exact original) while making
 * script-context breakout impossible. Every inline-script string embed must go
 * through this, never raw JSON.stringify.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Read a string field from a jsonb content blob, defaulting to ''. */
export function readStr(content: Record<string, unknown>, key: string): string {
  const v = content[key]
  return typeof v === 'string' ? v : ''
}

/** Read the declared capture fields from a content blob, defaulting to []. */
export function readFields(content: Record<string, unknown>): FormField[] {
  const f = (content as { fields?: unknown }).fields
  return Array.isArray(f) ? (f as FormField[]) : []
}

/** Read the ordered steps of a survey's content blob, defaulting to []. Each
 *  step's `fields` is normalized to an array so renderers/validators never have
 *  to null-check it. */
export function readSteps(content: Record<string, unknown>): SurveyStep[] {
  const s = (content as { steps?: unknown }).steps
  if (!Array.isArray(s)) return []
  return s.map((raw) => {
    const step = (raw ?? {}) as SurveyStep
    return { ...step, fields: Array.isArray(step.fields) ? step.fields : [] }
  })
}

/** Flatten every field across a survey's steps — the single source of truth for
 *  "which fields exist", used by both the renderer and the submit validator so
 *  they can never disagree about what's required. */
export function readAllFields(content: Record<string, unknown>): FormField[] {
  return readSteps(content).flatMap((step) => step.fields)
}

/** Keep a branding color from breaking out of the `--brand: …;` declaration. */
export function safeColor(input: string | undefined): string {
  if (!input || input.length > 32) return DEFAULT_BRAND
  if (/[;{}<>"']/.test(input)) return DEFAULT_BRAND
  return input
}

export const CHECK_SVG =
  '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="20 6 9 17 4 12"></polyline></svg>'

// --- styling + document shell --------------------------------------------

function styles(): string {
  return `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#f1f5f9;line-height:1.5;-webkit-font-smoothing:antialiased}
.ol-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;background:radial-gradient(1100px 560px at 50% -12%,color-mix(in srgb,var(--brand) 16%,transparent),transparent),#f1f5f9}
.ol-card{width:100%;max-width:480px;background:#fff;border:1px solid #e7ebf0;border-radius:22px;box-shadow:0 30px 60px -28px rgba(15,23,42,.35);padding:38px 34px}
.ol-card.ol-wide{max-width:660px}
.ol-center{text-align:center}
.ol-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--brand);background:color-mix(in srgb,var(--brand) 12%,#fff);padding:5px 12px;border-radius:999px;margin-bottom:18px}
.ol-h1{margin:0 0 12px;font-size:30px;line-height:1.14;font-weight:800;letter-spacing:-.02em;color:#0f172a}
.ol-sub{margin:0 0 24px;font-size:16px;color:#475569}
.ol-body{margin:0 0 26px;font-size:16px;color:#334155;white-space:pre-wrap;text-align:left}
.ol-field{margin-bottom:14px;text-align:left}
.ol-label{display:block;font-size:13px;font-weight:600;color:#334155;margin-bottom:6px}
.ol-input{width:100%;height:46px;border:1px solid #d7dde5;border-radius:12px;padding:0 14px;font-size:15px;color:#0f172a;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s}
.ol-input:focus{border-color:var(--brand);box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 22%,transparent)}
.ol-cta{display:inline-flex;align-items:center;justify-content:center;width:100%;height:50px;margin-top:6px;border:0;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700;cursor:pointer;text-decoration:none;box-shadow:0 14px 26px -12px color-mix(in srgb,var(--brand) 70%,transparent);transition:filter .15s,transform .04s}
.ol-cta:hover{filter:brightness(1.05)}
.ol-cta:active{transform:translateY(1px)}
.ol-cta[disabled]{opacity:.6;cursor:default}
.ol-foot{margin-top:18px;font-size:12px;color:#94a3b8}
.ol-status{display:none;margin-top:16px;font-size:15px;color:#0f172a;font-weight:600}
.ol-check{width:64px;height:64px;border-radius:999px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--brand) 14%,#fff);color:var(--brand)}
.ol-textarea{height:auto;min-height:108px;padding:12px 14px;resize:vertical;font-family:inherit;line-height:1.5}
.ol-select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:40px;cursor:pointer}
.ol-progress{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.ol-progress-track{flex:1;height:7px;border-radius:999px;background:#eef2f6;overflow:hidden}
.ol-progress-bar{height:100%;border-radius:999px;background:var(--brand);transition:width .35s cubic-bezier(.4,0,.2,1)}
.ol-stepcount{font-size:12px;font-weight:600;color:#94a3b8;white-space:nowrap;letter-spacing:.02em}
.ol-step{display:none}
.ol-step.ol-active{display:block;animation:ol-fade .28s ease}
@keyframes ol-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ol-steptitle{margin:0 0 6px;font-size:21px;font-weight:800;letter-spacing:-.01em;color:#0f172a;text-align:left}
.ol-stepsub{margin:0 0 20px;font-size:15px;color:#64748b;text-align:left}
.ol-btnrow{display:flex;align-items:center;gap:12px;margin-top:8px}
.ol-back{flex:0 0 auto;height:50px;padding:0 20px;border:1px solid #d7dde5;border-radius:12px;background:#fff;color:#475569;font-size:15px;font-weight:600;cursor:pointer;transition:border-color .15s,color .15s}
.ol-back:hover{border-color:#c2cad4;color:#0f172a}
.ol-btnrow .ol-cta{margin-top:0}
.ol-items{width:100%;border-collapse:collapse;margin:8px 0 24px}
.ol-items th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;font-weight:600;padding:0 0 10px;border-bottom:1px solid #e7ebf0;text-align:left}
.ol-items td{padding:13px 0;border-bottom:1px solid #f1f5f9;font-size:15px;color:#334155;vertical-align:top}
.ol-items .ol-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ol-itemdesc{font-weight:600;color:#0f172a}
.ol-total-row td{border-bottom:0;padding-top:18px}
.ol-total-label{text-align:right;font-weight:600;color:#475569;font-size:15px}
.ol-total{text-align:right;font-weight:800;color:#0f172a;font-size:21px;font-variant-numeric:tabular-nums}
.ol-terms{text-align:left;margin:0 0 6px}
.ol-terms-h{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;font-weight:600;margin:0 0 8px}
.ol-sign{border-top:1px solid #e7ebf0;padding-top:24px;margin-top:24px;text-align:left}
.ol-sign-h{font-size:19px;font-weight:800;letter-spacing:-.01em;color:#0f172a;margin:0 0 4px}
.ol-sign-lede{font-size:14px;color:#64748b;margin:0 0 18px}
.ol-sign-note{font-size:12px;color:#94a3b8;margin:14px 0 0;line-height:1.5}
.ol-decline{display:block;margin:16px auto 0;background:none;border:0;color:#94a3b8;font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline}
.ol-decline:hover{color:#64748b}
.ol-signed-meta{margin:0;font-size:15px;color:#475569}
.ol-signed-meta strong{color:#0f172a}
`
}

/** Wrap a body fragment in a complete, self-contained HTML document. */
export function pageShell(opts: {
  title: string
  brand: string
  body: string
  script?: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escText(opts.title)}</title>
<style>:root{--brand:${opts.brand}}${styles()}</style>
</head>
<body>
<div class="ol-wrap">
${opts.body}
</div>
${opts.script ?? ''}
</body>
</html>`
}

// --- shared fragments -----------------------------------------------------

/** The small pill above a page headline (funnel name / form name). */
export function eyebrow(label: string): string {
  return `<span class="ol-eyebrow">${escText(label)}</span>`
}

/** One labelled capture input. Attribute order is name → type → placeholder →
 *  required, so a required field carries a trailing `required` and an optional
 *  one does not. */
export function renderField(field: FormField): string {
  const name = String(field.name ?? '')
  if (!name) return ''
  const label = field.label ?? name
  const type = field.type ?? 'text'
  const req = field.required ? ' required' : ''

  // A `textarea` field renders a multi-line box (surveys often want a free-text
  // "anything else?" answer). Same label/required contract as a text input.
  if (type === 'textarea') {
    return `<div class="ol-field">
        <label class="ol-label" for="ol-f-${escAttr(name)}">${escText(label)}</label>
        <textarea class="ol-input ol-textarea" id="ol-f-${escAttr(name)}" name="${escAttr(name)}" rows="4" placeholder="${escAttr(label)}"${req}></textarea>
      </div>`
  }

  // A `select` field renders a single-choice dropdown from `options`. A required
  // select gets a disabled empty first option so the browser enforces a pick.
  if (type === 'select') {
    const options = Array.isArray(field.options) ? field.options : []
    const placeholder = field.required
      ? `<option value="" disabled selected>${escText(`Select ${label}`)}</option>`
      : `<option value="">${escText(`Select ${label}`)}</option>`
    const opts = options
      .map((o) => `<option value="${escAttr(String(o))}">${escText(String(o))}</option>`)
      .join('')
    return `<div class="ol-field">
        <label class="ol-label" for="ol-f-${escAttr(name)}">${escText(label)}</label>
        <select class="ol-input ol-select" id="ol-f-${escAttr(name)}" name="${escAttr(name)}"${req}>${placeholder}${opts}</select>
      </div>`
  }

  return `<div class="ol-field">
        <label class="ol-label" for="ol-f-${escAttr(name)}">${escText(label)}</label>
        <input class="ol-input" id="ol-f-${escAttr(name)}" name="${escAttr(name)}" type="${escAttr(type)}" placeholder="${escAttr(label)}"${req} />
      </div>`
}

/**
 * The inline submit handler shared by every capture page. Posts the collected
 * field values as JSON to the form's own `action` endpoint, then either
 * advances to the next page (`nextBase + data.next`, used by funnels) or shows
 * an inline confirmation (`successText`, used by standalone forms and the last
 * step of a funnel). There is exactly one copy of the capture logic.
 */
export function captureScript(opts: {
  formId: string
  statusId: string
  /** Base URL a returned `next` path is appended to. '' for single-page forms. */
  nextBase: string
  successText: string
}): string {
  const base = jsonForScript(opts.nextBase)
  const fid = jsonForScript(opts.formId)
  const sid = jsonForScript(opts.statusId)
  const okText = jsonForScript(opts.successText)
  return `<script>
(function(){
  var form=document.getElementById(${fid});
  if(!form)return;
  var status=document.getElementById(${sid});
  var btn=form.querySelector('button[type="submit"]');
  var label=btn?btn.textContent:'';
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var values={};
    var els=form.querySelectorAll('input[name], textarea[name], select[name]');
    for(var i=0;i<els.length;i++){values[els[i].name]=els[i].value;}
    if(btn){btn.disabled=true;btn.textContent='Sending…';}
    fetch(form.getAttribute('action'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:values})})
      .then(function(r){return r.json().catch(function(){return {};});})
      .then(function(data){
        if(data&&data.ok){
          if(data.next){window.location.assign(${base}+data.next);return;}
          form.style.display='none';
          if(status){status.textContent=${okText};status.style.display='block';}
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

/** A small styled 404 for an unpublished/unknown public page. */
export function notFoundPage(message: string): string {
  const body = `<div class="ol-card ol-center">
      <h1 class="ol-h1">Page not found</h1>
      <p class="ol-sub">${escText(message)}</p>
    </div>`
  return pageShell({ title: 'Not found', brand: DEFAULT_BRAND, body })
}
