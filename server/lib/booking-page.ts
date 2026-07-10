/**
 * Server-side renderer for a calendar's PUBLIC booking page — the visitor-facing
 * "pick a day, pick a time, leave your details" screen, the booking analogue of
 * form-page / funnel-page. It reuses the shared `ol-*` visual language from
 * page-html so a booking page sits in the same design family as an opt-in form,
 * and adds a small `ob-*` layer for the date strip and slot grid.
 *
 * The page is a single self-contained HTML document (inline CSS, `noindex`, no
 * external requests). The server renders the *bookable dates* up front (cheap,
 * weekday-based) and the browser fetches the open *times* for whichever date is
 * active — so the heavy slot math (busy set, notice, buffer) runs once per click
 * against the live calendar rather than being baked into the page.
 *
 * Pure: calendar + data in, HTML string out. No DB, no side effects.
 */

import type { Calendar } from '../repos/calendars-repo'
import { dateLabel } from './availability'
import { DEFAULT_BRAND, escAttr, escText, eyebrow, pageShell, safeColor } from './page-html'

export interface BookingPageData {
  /** Public base URL for this calendar, e.g. `/api/public/booking/<loc>/<slug>`.
   *  `/slots` and `/book` hang off it. */
  actionBase: string
  /** Bookable dates (YYYY-MM-DD) the date strip offers, already filtered to the
   *  rolling window's open weekdays. */
  dates: string[]
  /** Location branding color for the CTA + accents. */
  brandColor?: string
}

/** A friendly timezone label — the city of an IANA zone, e.g. "New York". Falls
 *  back to the raw zone if it has no `/`. */
function prettyZone(tz: string): string {
  const city = tz.split('/').pop()
  return (city ?? tz).replace(/_/g, ' ')
}

/** The booking-specific styles layered on top of the shared `ol-*` ones. */
function bookingStyles(): string {
  return `<style>
.ob-tz{margin:-10px 0 22px;font-size:13px;color:#94a3b8;text-align:left}
.ob-dates{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
.ob-date{padding:9px 14px;border:1px solid #d7dde5;border-radius:11px;background:#fff;color:#334155;font-size:14px;font-weight:600;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.ob-date:hover{border-color:var(--brand)}
.ob-date.ob-active{background:var(--brand);border-color:var(--brand);color:#fff;box-shadow:0 12px 22px -12px color-mix(in srgb,var(--brand) 72%,transparent)}
.ob-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:10px;min-height:54px}
.ob-slot{padding:12px 8px;border:1px solid #d7dde5;border-radius:11px;background:#fff;color:#0f172a;font-size:15px;font-weight:600;cursor:pointer;font-variant-numeric:tabular-nums;transition:border-color .15s,background .15s}
.ob-slot:hover{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 8%,#fff)}
.ob-empty,.ob-loading{grid-column:1/-1;color:#94a3b8;font-size:14px;margin:6px 0;text-align:left}
.ob-chosen{font-size:15px;font-weight:700;color:#0f172a;margin:0 0 18px;padding:12px 14px;border-radius:12px;background:color-mix(in srgb,var(--brand) 10%,#fff);border:1px solid color-mix(in srgb,var(--brand) 24%,#fff)}
.ob-done{text-align:center}
</style>`
}

/** The inline browser script: load slots for the active date, switch dates, pick
 *  a slot, submit the booking, show confirmation. Vanilla, no dependencies. */
function bookingScript(actionBase: string): string {
  const base = JSON.stringify(actionBase)
  return `<script>
(function(){
  var base=${base};
  var pick=document.getElementById('ob-pick');
  var slotsEl=document.getElementById('ob-slots');
  var form=document.getElementById('ob-form');
  var done=document.getElementById('ob-done');
  var chosenEl=document.getElementById('ob-chosen');
  var statusEl=document.getElementById('ob-status');
  var doneWhen=document.getElementById('ob-done-when');
  var dateBtns=document.querySelectorAll('.ob-date');
  var activeDate=null,activeLabel='',chosen=null;
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function val(id){var el=document.getElementById(id);return el?el.value.trim():'';}
  function setActive(btn){
    for(var i=0;i<dateBtns.length;i++){dateBtns[i].classList.remove('ob-active');}
    btn.classList.add('ob-active');
    activeDate=btn.getAttribute('data-date');
    activeLabel=btn.textContent;
  }
  function pickSlot(e){
    var b=e.currentTarget;
    chosen={start:b.getAttribute('data-start'),end:b.getAttribute('data-end'),label:b.getAttribute('data-label')};
    chosenEl.textContent=activeLabel+' at '+chosen.label;
    pick.style.display='none';
    form.style.display='block';
    statusEl.style.display='none';
  }
  function renderSlots(slots){
    var html='';
    for(var i=0;i<slots.length;i++){
      var s=slots[i];
      html+='<button type="button" class="ob-slot" data-start="'+esc(s.start)+'" data-end="'+esc(s.end)+'" data-label="'+esc(s.label)+'">'+esc(s.label)+'</button>';
    }
    slotsEl.innerHTML=html;
    var btns=slotsEl.querySelectorAll('.ob-slot');
    for(var j=0;j<btns.length;j++){btns[j].addEventListener('click',pickSlot);}
  }
  function loadSlots(date,autoIdx){
    slotsEl.innerHTML='<p class="ob-loading">Loading times…</p>';
    fetch(base+'/slots?date='+encodeURIComponent(date)).then(function(r){return r.json();}).then(function(d){
      var slots=(d&&d.slots)||[];
      if(!slots.length){
        // On the INITIAL auto-selection only, a date with no remaining openings
        // (e.g. today, late in the day, past the notice window) should not strand
        // the visitor on an empty grid — skip ahead to the next offered date,
        // the way a booking widget should. A manual date click (autoIdx
        // undefined) keeps the honest per-day message so an explicit choice is
        // respected.
        if(typeof autoIdx==='number'&&autoIdx+1<dateBtns.length){
          var next=dateBtns[autoIdx+1];setActive(next);loadSlots(next.getAttribute('data-date'),autoIdx+1);return;
        }
        slotsEl.innerHTML='<p class="ob-empty">No open times on this day — try another date.</p>';return;
      }
      renderSlots(slots);
    }).catch(function(){slotsEl.innerHTML='<p class="ob-empty">Could not load times — please retry.</p>';});
  }
  for(var i=0;i<dateBtns.length;i++){
    dateBtns[i].addEventListener('click',function(e){setActive(e.currentTarget);loadSlots(activeDate);});
  }
  var back=document.getElementById('ob-back');
  if(back){back.addEventListener('click',function(){form.style.display='none';pick.style.display='block';});}
  if(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      if(!chosen)return;
      var btn=form.querySelector('button[type="submit"]');
      var payload={start:chosen.start,end:chosen.end,name:val('ob-name'),email:val('ob-email'),phone:val('ob-phone'),notes:val('ob-notes')};
      if(btn){btn.disabled=true;btn.textContent='Booking…';}
      fetch(base+'/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
        .then(function(r){return r.json().catch(function(){return {};}).then(function(d){return {ok:r.ok,d:d};});})
        .then(function(res){
          if(res.ok&&res.d&&res.d.ok){
            form.style.display='none';
            done.style.display='block';
            if(doneWhen){doneWhen.textContent=activeLabel+' at '+chosen.label;}
            return;
          }
          if(btn){btn.disabled=false;btn.textContent='Confirm booking';}
          var taken=res.d&&res.d.error==='slot taken';
          statusEl.textContent=taken?'That time was just taken — please pick another.':'Could not complete the booking — please try again.';
          statusEl.style.display='block';
          if(taken){form.style.display='none';pick.style.display='block';if(activeDate)loadSlots(activeDate);}
        })
        .catch(function(){
          if(btn){btn.disabled=false;btn.textContent='Confirm booking';}
          statusEl.textContent='Network error — please try again.';
          statusEl.style.display='block';
        });
    });
  }
  if(dateBtns.length){setActive(dateBtns[0]);loadSlots(activeDate,0);}
})();
</script>`
}

/**
 * Render a calendar's public booking page. The caller (the public route) has
 * already confirmed the calendar is booking-enabled and computed `dates`.
 */
export function renderBookingPage(calendar: Calendar, data: BookingPageData): string {
  const brand = safeColor(data.brandColor)
  const headline = calendar.booking_headline?.trim() || 'Book a time'
  const blurb = calendar.booking_blurb?.trim()
  const tzLabel = prettyZone(calendar.timezone)

  const datePills = data.dates
    .map(
      (d) =>
        `<button type="button" class="ob-date" data-date="${escAttr(d)}">${escText(dateLabel(d))}</button>`,
    )
    .join('')

  // The "pick" view: either the date strip + slot grid, or an honest empty state
  // when no dates are open in the rolling window.
  const picker = data.dates.length
    ? `<div class="ob-dates">${datePills}</div>
      <div class="ob-slots" id="ob-slots"><p class="ob-empty">Select a date to see open times.</p></div>`
    : `<p class="ob-empty">No times are open right now — please check back soon.</p>`

  const body = `${bookingStyles()}
    <div class="ol-card ol-wide" id="ob-card">
      <div id="ob-pick">
        ${eyebrow(calendar.name)}
        <h1 class="ol-h1">${escText(headline)}</h1>
        ${blurb ? `<p class="ol-sub">${escText(blurb)}</p>` : ''}
        <p class="ob-tz">All times shown in ${escText(tzLabel)} time.</p>
        ${picker}
      </div>
      <form class="ob-form" id="ob-form" style="display:none">
        <button type="button" class="ol-back" id="ob-back" style="margin-bottom:18px">Back</button>
        <p class="ob-chosen" id="ob-chosen"></p>
        <div class="ol-field">
          <label class="ol-label" for="ob-name">Your name</label>
          <input class="ol-input" id="ob-name" name="name" type="text" placeholder="Your name" required />
        </div>
        <div class="ol-field">
          <label class="ol-label" for="ob-email">Email</label>
          <input class="ol-input" id="ob-email" name="email" type="email" placeholder="you@example.com" required />
        </div>
        <div class="ol-field">
          <label class="ol-label" for="ob-phone">Phone (optional)</label>
          <input class="ol-input" id="ob-phone" name="phone" type="tel" placeholder="Phone" />
        </div>
        <div class="ol-field">
          <label class="ol-label" for="ob-notes">Anything we should know? (optional)</label>
          <textarea class="ol-input ol-textarea" id="ob-notes" name="notes" rows="3" placeholder="Optional"></textarea>
        </div>
        <button type="submit" class="ol-cta">Confirm booking</button>
        <p class="ol-status" id="ob-status"></p>
      </form>
      <div class="ob-done" id="ob-done" style="display:none">
        <div class="ol-check">${escText('✓')}</div>
        <h1 class="ol-h1">You are booked</h1>
        <p class="ol-sub" id="ob-done-when"></p>
      </div>
    </div>`

  return pageShell({
    title: `${headline} — ${calendar.name}`,
    brand,
    body,
    script: bookingScript(data.actionBase),
  })
}

/** A styled 404 for a booking slug that is unknown or not booking-enabled. */
export function renderBookingNotFound(): string {
  const body = `<div class="ol-card ol-center">
      <h1 class="ol-h1">Booking page unavailable</h1>
      <p class="ol-sub">This booking link is not active. Please check the link and try again.</p>
    </div>`
  return pageShell({ title: 'Booking unavailable', brand: DEFAULT_BRAND, body })
}
