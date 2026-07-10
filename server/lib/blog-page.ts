import { escAttr, escText, eyebrow, notFoundPage, pageShell, safeColor } from './page-html'

/**
 * Server-side renderer for the public, unauthenticated blog — the same
 * self-contained document language (inline CSS via the `--brand` variable, no
 * external requests, `noindex`) the funnel, form, review and course pages use, so
 * a location's blog looks like the rest of its hosted pages. Two views: an index
 * of published posts and a single post.
 *
 * The "5 min read" shown here is the figure derived in blog-math.ts from the
 * post's real word count — passed in, never invented by this view. Only published
 * posts ever reach these renderers (the route filters), the post body is escaped
 * (no injected HTML), and a cover image is shown only from a safe http(s) URL.
 */

const PUBLIC_BASE = '/api/public/blog'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** A readable, timezone-stable post date ("June 3, 2026") from an ISO timestamp.
 *  Empty/invalid dates render as '' so the meta line just omits them. UTC keeps
 *  the output deterministic across machines (and in tests). */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** Only emit http(s) image URLs on a public page — never a `javascript:`/`data:`
 *  src. Returns the trimmed URL or null when it isn't safe. */
function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

/** Join the non-empty parts of a meta line with a middot. */
function metaLine(parts: Array<string | null | undefined>): string {
  const kept = parts.filter((p): p is string => !!p && p.length > 0)
  return kept.map(escText).join(' · ')
}

/** Split a body into escaped paragraphs (blank-line separated); single newlines
 *  inside a paragraph survive via `white-space:pre-line`. */
function renderBody(body: string): string {
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paras.length === 0) return ''
  return paras.map((p) => `<p class="ol-article-p">${escText(p)}</p>`).join('')
}

const BLOG_STYLE = `<style>
.ol-blog{text-align:left}
.ol-blog-h1{margin:0 0 26px;font-size:28px;font-weight:800;letter-spacing:-.02em;color:#0f172a}
.ol-postlist{display:flex;flex-direction:column;gap:2px}
.ol-postcard{display:block;text-decoration:none;color:inherit;padding:20px 0;border-top:1px solid #eef1f5}
.ol-postcard:first-child{border-top:0}
.ol-post-title{margin:0 0 6px;font-size:19px;font-weight:700;letter-spacing:-.01em;color:#0f172a;transition:color .15s}
.ol-postcard:hover .ol-post-title{color:var(--brand)}
.ol-post-excerpt{margin:0 0 8px;font-size:15px;color:#475569;line-height:1.55}
.ol-post-meta{font-size:13px;color:#94a3b8;font-weight:500}
.ol-cover{width:100%;max-height:300px;object-fit:cover;border-radius:16px;margin:0 0 24px;border:1px solid #e7ebf0}
.ol-article-title{margin:0 0 12px;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-.02em;color:#0f172a}
.ol-article-meta{margin:0 0 24px;font-size:14px;color:#94a3b8;font-weight:500}
.ol-article-p{margin:0 0 18px;font-size:17px;line-height:1.7;color:#1e293b;white-space:pre-line}
.ol-article-p:last-child{margin-bottom:0}
.ol-backlink{display:inline-flex;align-items:center;gap:6px;margin-bottom:22px;font-size:14px;font-weight:600;color:var(--brand);text-decoration:none}
.ol-backlink:hover{text-decoration:underline}
.ol-empty{padding:30px 20px;text-align:center;color:#64748b;font-size:15px;border:1px dashed #d7dde5;border-radius:16px}
</style>`

export interface BlogIndexPost {
  slug: string
  title: string
  excerpt: string | null
  publishedAt: string | null
  /** Derived (blog-math) whole-minute read time. */
  readingMinutes: number
}

export interface BlogIndexOpts {
  businessName: string
  brandColor?: string
  /** Location id used to build per-post links. */
  loc: string
  posts: BlogIndexPost[]
}

/** Read-time label, omitted for an empty post (0 min). */
function readLabel(min: number): string {
  return min > 0 ? `${min} min read` : ''
}

function postRow(loc: string, post: BlogIndexPost): string {
  const href = `${PUBLIC_BASE}/${escAttr(loc)}/${escAttr(post.slug)}`
  const excerpt = post.excerpt?.trim()
    ? `<p class="ol-post-excerpt">${escText(post.excerpt)}</p>`
    : ''
  const meta = metaLine([formatDate(post.publishedAt), readLabel(post.readingMinutes)])
  return `<a class="ol-postcard" href="${href}">
        <h2 class="ol-post-title">${escText(post.title)}</h2>
        ${excerpt}
        <div class="ol-post-meta">${meta}</div>
      </a>`
}

/** The public blog index: a branded list of the location's published posts. */
export function renderBlogIndex(opts: BlogIndexOpts): string {
  const brand = safeColor(opts.brandColor)
  const list = opts.posts.length
    ? `<div class="ol-postlist">${opts.posts.map((p) => postRow(opts.loc, p)).join('')}</div>`
    : `<div class="ol-empty">No posts published yet. Check back soon.</div>`

  const body = `<div class="ol-card ol-wide ol-blog">
      ${BLOG_STYLE}
      ${eyebrow(opts.businessName)}
      <h1 class="ol-blog-h1">Blog</h1>
      ${list}
    </div>`

  return pageShell({ title: `Blog — ${opts.businessName}`, brand, body })
}

export interface BlogPostView {
  title: string
  body: string | null
  author: string | null
  coverImageUrl: string | null
  publishedAt: string | null
  /** Derived (blog-math) whole-minute read time. */
  readingMinutes: number
}

export interface BlogPostOpts {
  businessName: string
  brandColor?: string
  loc: string
  post: BlogPostView
}

/** A single published post, with an optional cover image and a link back to the
 *  index. */
export function renderBlogPost(opts: BlogPostOpts): string {
  const brand = safeColor(opts.brandColor)
  const p = opts.post
  const cover = safeImageUrl(p.coverImageUrl)
  const coverImg = cover
    ? `<img class="ol-cover" src="${escAttr(cover)}" alt="" />`
    : ''
  const meta = metaLine([p.author?.trim() || null, formatDate(p.publishedAt), readLabel(p.readingMinutes)])
  const article = p.body?.trim() ? renderBody(p.body) : ''
  const indexHref = `${PUBLIC_BASE}/${escAttr(opts.loc)}`

  const body = `<div class="ol-card ol-wide ol-blog">
      ${BLOG_STYLE}
      <a class="ol-backlink" href="${indexHref}">← All posts</a>
      ${eyebrow(opts.businessName)}
      ${coverImg}
      <h1 class="ol-article-title">${escText(p.title)}</h1>
      <div class="ol-article-meta">${meta}</div>
      ${article}
    </div>`

  return pageShell({ title: `${p.title} — ${opts.businessName}`, brand, body })
}

/** A styled 404 for an unknown / unpublished post — still self-contained. */
export function renderBlogNotFound(): string {
  return notFoundPage('This post is not available.')
}
