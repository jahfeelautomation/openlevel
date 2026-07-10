import type { Enrollment } from '../repos/enrollments-repo'
import { CHECK_SVG, escAttr, escText, eyebrow, notFoundPage, pageShell, safeColor } from './page-html'

/**
 * Server-side renderer for the public, unauthenticated course player — the same
 * self-contained document language (inline CSS via the `--brand` variable, no
 * external requests, `noindex`) the funnel, form and review pages use, so an
 * enrollee's course looks like the rest of the brand's hosted pages.
 *
 * The "X% complete" shown here is the figure derived in course-math.ts from the
 * enrollee's real lesson completions — passed in, never recomputed or invented by
 * this view. Marking a lesson posts to the tokenized public endpoint and the
 * server returns the freshly-derived progress, which the inline script renders;
 * the bar can only ever reflect what was actually finished. A video is shown only
 * as a safe http(s) link (no arbitrary embeds), and lesson content is escaped.
 */

const PUBLIC_BASE = '/api/public/courses'

export interface CoursePlayerLesson {
  id: string
  title: string
  content: string | null
  videoUrl?: string | null
  /** Whether this enrollee has finished this lesson (a real completion row). */
  done: boolean
}

export interface CoursePageProgress {
  completed: number
  total: number
  percent: number
  complete: boolean
}

export interface CoursePageOpts {
  brandColor?: string
  /** The location's display name, shown in the eyebrow. */
  businessName: string
  courseTitle: string
  description?: string | null
  lessons: CoursePlayerLesson[]
  /** Derived progress (from course-math) for the initial render. */
  progress: CoursePageProgress
}

// Player-only styling, injected per page so the shared form/funnel/review CSS
// stays lean. A header card carries the progress bar; each lesson is a bordered
// panel with a numbered badge and a complete toggle that turns green once done.
const COURSE_STYLE = `<style>
.ol-progress{margin:6px 0 26px;text-align:left}
.ol-progress-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}
.ol-progress-label{font-size:14px;font-weight:600;color:#475569}
.ol-progress-pct{font-size:18px;font-weight:800;color:var(--brand);letter-spacing:-.01em}
.ol-progress-track{height:10px;border-radius:999px;background:#e7ebf0;overflow:hidden}
.ol-progress-fill{height:100%;border-radius:999px;background:var(--brand);transition:width .35s cubic-bezier(.4,0,.2,1)}
.ol-done-banner{display:none;align-items:center;gap:10px;margin:0 0 22px;padding:13px 16px;border-radius:14px;background:color-mix(in srgb,var(--brand) 12%,#fff);color:var(--brand);font-weight:700;font-size:15px;text-align:left}
.ol-done-banner.show{display:flex}
.ol-done-banner svg{width:22px;height:22px;flex:none}
.ol-lessons{display:flex;flex-direction:column;gap:14px;text-align:left}
.ol-lesson{border:1px solid #e7ebf0;border-radius:16px;padding:20px 20px 18px;transition:border-color .15s,box-shadow .15s}
.ol-lesson--done{border-color:color-mix(in srgb,var(--brand) 38%,#e7ebf0);background:color-mix(in srgb,var(--brand) 4%,#fff)}
.ol-lesson-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.ol-lesson-num{flex:none;width:30px;height:30px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--brand);background:color-mix(in srgb,var(--brand) 13%,#fff)}
.ol-lesson--done .ol-lesson-num{color:#fff;background:var(--brand)}
.ol-lesson-title{margin:0;font-size:18px;font-weight:700;letter-spacing:-.01em;color:#0f172a}
.ol-lesson-body{margin:0 0 14px;font-size:15px;color:#334155;white-space:pre-wrap;line-height:1.6}
.ol-lesson-video{display:inline-flex;align-items:center;gap:7px;margin:0 0 14px;font-size:14px;font-weight:600;color:var(--brand);text-decoration:none}
.ol-lesson-video:hover{text-decoration:underline}
.ol-lesson-toggle{display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 18px;border-radius:11px;border:0;background:var(--brand);color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:filter .15s,transform .04s}
.ol-lesson-toggle:hover{filter:brightness(1.05)}
.ol-lesson-toggle:active{transform:translateY(1px)}
.ol-lesson-toggle:disabled{opacity:.6;cursor:default}
.ol-lesson--done .ol-lesson-toggle{background:color-mix(in srgb,var(--brand) 13%,#fff);color:var(--brand)}
.ol-empty{padding:30px 20px;text-align:center;color:#64748b;font-size:15px;border:1px dashed #d7dde5;border-radius:16px}
</style>`

/** Allow only http(s) video URLs — never emit a `javascript:`/`data:` link on a
 *  public page. Returns the trimmed URL or null when it isn't safe. */
function safeVideoUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

function toggleLabel(done: boolean): string {
  return done ? '✓ Completed' : 'Mark as complete'
}

function lessonPanel(lesson: CoursePlayerLesson, index: number): string {
  const done = lesson.done
  const cls = done ? 'ol-lesson ol-lesson--done' : 'ol-lesson'
  const video = safeVideoUrl(lesson.videoUrl)
  const body = lesson.content?.trim()
    ? `<p class="ol-lesson-body">${escText(lesson.content)}</p>`
    : ''
  const videoLink = video
    ? `<a class="ol-lesson-video" href="${escAttr(video)}" target="_blank" rel="noopener noreferrer">▶ Watch the video</a>`
    : ''
  return `<div class="${cls}">
        <div class="ol-lesson-head">
          <span class="ol-lesson-num">${index + 1}</span>
          <h2 class="ol-lesson-title">${escText(lesson.title)}</h2>
        </div>
        ${body}
        ${videoLink}
        <div>
          <button class="ol-lesson-toggle" type="button" data-lesson="${escAttr(lesson.id)}" data-done="${done ? '1' : '0'}">${toggleLabel(done)}</button>
        </div>
      </div>`
}

/** This page's own toggle handler: marks/unmarks a lesson against the tokenized
 *  endpoint and re-renders the progress bar from the server's derived figure. */
function courseScript(base: string): string {
  const b = JSON.stringify(base)
  return `<script>
(function(){
  var base=${b};
  var fill=document.getElementById('ol-progress-fill');
  var pct=document.getElementById('ol-progress-pct');
  var lab=document.getElementById('ol-progress-label');
  var banner=document.getElementById('ol-course-done');
  function render(p){
    if(!p)return;
    if(fill)fill.style.width=p.percent+'%';
    if(pct)pct.textContent=p.percent+'%';
    if(lab)lab.textContent=p.completed+' of '+p.total+(p.total===1?' lesson complete':' lessons complete');
    if(banner)banner.className='ol-done-banner'+(p.complete?' show':'');
  }
  var btns=document.querySelectorAll('.ol-lesson-toggle');
  for(var i=0;i<btns.length;i++){(function(btn){
    btn.addEventListener('click',function(){
      var done=btn.getAttribute('data-done')==='1';
      var lesson=btn.getAttribute('data-lesson');
      btn.disabled=true;
      fetch(base+'/lessons/'+encodeURIComponent(lesson)+'/complete',{method:done?'DELETE':'POST',headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json().catch(function(){return {};});})
        .then(function(data){
          btn.disabled=false;
          if(!data||!data.ok)return;
          var nowDone=!done;
          btn.setAttribute('data-done',nowDone?'1':'0');
          btn.textContent=nowDone?'\\u2713 Completed':'Mark as complete';
          var card=btn.closest('.ol-lesson');
          if(card)card.className=nowDone?'ol-lesson ol-lesson--done':'ol-lesson';
          render(data.progress);
        })
        .catch(function(){btn.disabled=false;});
    });
  })(btns[i]);}
})();
</script>`
}

export function renderCoursePage(
  enrollment: Pick<Enrollment, 'location_id' | 'token'>,
  opts: CoursePageOpts,
): string {
  const brand = safeColor(opts.brandColor)
  const base = `${PUBLIC_BASE}/${escAttr(enrollment.location_id)}/${escAttr(enrollment.token)}`
  const p = opts.progress
  const lessonLabel = `${p.completed} of ${p.total} ${p.total === 1 ? 'lesson complete' : 'lessons complete'}`
  const description = opts.description?.trim()
    ? `<p class="ol-sub">${escText(opts.description)}</p>`
    : ''

  const lessons = opts.lessons.length
    ? `<div class="ol-lessons">${opts.lessons.map(lessonPanel).join('')}</div>`
    : `<div class="ol-empty">This course doesn't have any lessons yet. Check back soon.</div>`

  const body = `<div class="ol-card ol-wide">
      ${COURSE_STYLE}
      ${eyebrow(opts.businessName)}
      <h1 class="ol-h1">${escText(opts.courseTitle)}</h1>
      ${description}
      <div class="ol-progress">
        <div class="ol-progress-head">
          <span class="ol-progress-label" id="ol-progress-label">${escText(lessonLabel)}</span>
          <span class="ol-progress-pct" id="ol-progress-pct">${p.percent}%</span>
        </div>
        <div class="ol-progress-track">
          <div class="ol-progress-fill" id="ol-progress-fill" style="width: ${p.percent}%"></div>
        </div>
      </div>
      <div class="ol-done-banner${p.complete ? ' show' : ''}" id="ol-course-done">${CHECK_SVG}<span>You've completed this course — nice work.</span></div>
      ${lessons}
    </div>`

  return pageShell({
    title: `${opts.courseTitle} — ${opts.businessName}`,
    brand,
    body,
    script: courseScript(base),
  })
}

/** A styled 404 for an invalid/expired enrollment link — still self-contained. */
export function renderCourseNotFound(): string {
  return notFoundPage('This course link is invalid or has expired.')
}
