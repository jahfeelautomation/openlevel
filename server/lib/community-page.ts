import { escAttr, escText, eyebrow, notFoundPage, pageShell, safeColor } from './page-html'

/**
 * Server-side renderer for the public, unauthenticated community space — the same
 * self-contained document language (inline CSS via the `--brand` variable, no
 * external requests, `noindex`) the funnel, form, blog and course pages use, so a
 * location's community looks like the rest of its hosted pages. Two views: a feed
 * (the community with its channel rail and a list of posts) and a single post with
 * its comment thread.
 *
 * Every figure shown here — "128 members · 42 posts", a channel's post count, a
 * post's "12 likes · 5 comments" — is DERIVED in the route from real rows and
 * passed in; this view never invents a number. Only a published community ever
 * reaches these renderers (the route filters), and all member-authored text
 * (names, titles, bodies, comments) is escaped, so a post can't inject HTML.
 */

const PUBLIC_BASE = '/api/public/communities'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** A readable, timezone-stable date ("June 3, 2026") from an ISO timestamp.
 *  Empty/invalid dates render as '' so a meta line just omits them. UTC keeps the
 *  output deterministic across machines (and in tests). */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** A short, escaped preview of a post body for the feed card — first paragraph,
 *  trimmed to ~180 chars on a word boundary with an ellipsis. */
function excerptOf(body: string | null | undefined, max = 180): string {
  const firstPara = (body ?? '').split(/\n{2,}/)[0]?.replace(/\s+/g, ' ').trim() ?? ''
  if (firstPara.length <= max) return firstPara
  const cut = firstPara.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** Split a body into escaped paragraphs (blank-line separated); single newlines
 *  inside a paragraph survive via `white-space:pre-line`. */
function renderBody(body: string): string {
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paras.length === 0) return ''
  return paras.map((p) => `<p class="ol-c-p">${escText(p)}</p>`).join('')
}

/** "12 likes" / "1 like" / '' for zero — pluralized, honest, never shows a 0. */
function countLabel(n: number, one: string, many: string): string {
  if (n <= 0) return ''
  return `${n} ${n === 1 ? one : many}`
}

/** Join the non-empty parts of a meta line with a middot. Parts are already-built
 *  display strings (some pre-escaped via escText), so they're inserted as-is. */
function metaLine(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(' · ')
}

const HEART_SVG =
  '<svg class="ol-c-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"></path></svg>'

const CHAT_SVG =
  '<svg class="ol-c-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9L3 20l1.4-4.2A8.4 8.4 0 1 1 21 11.5z"></path></svg>'

const COMMUNITY_STYLE = `<style>
.ol-c{text-align:left}
.ol-c-h1{margin:0 0 8px;font-size:28px;font-weight:800;letter-spacing:-.02em;color:#0f172a}
.ol-c-desc{margin:0 0 14px;font-size:15px;color:#475569;line-height:1.55;white-space:pre-line}
.ol-c-stats{display:flex;gap:8px;align-items:center;font-size:13px;color:#94a3b8;font-weight:600;margin:0 0 20px}
.ol-c-rail{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px;padding:0 0 20px;border-bottom:1px solid #eef1f5}
.ol-c-chip{display:inline-flex;align-items:center;gap:7px;text-decoration:none;font-size:13px;font-weight:600;color:#475569;background:#f4f6f9;border:1px solid #e7ebf0;padding:7px 13px;border-radius:999px;transition:background .15s,color .15s,border-color .15s}
.ol-c-chip:hover{border-color:var(--brand);color:var(--brand)}
.ol-c-chip.ol-c-on{background:var(--brand);border-color:var(--brand);color:#fff}
.ol-c-chip-n{font-size:11px;opacity:.7;font-variant-numeric:tabular-nums}
.ol-c-feed{display:flex;flex-direction:column;gap:2px}
.ol-c-post{display:block;text-decoration:none;color:inherit;padding:20px 0;border-top:1px solid #eef1f5}
.ol-c-post:first-child{border-top:0}
.ol-c-tags{display:flex;align-items:center;gap:8px;margin:0 0 9px}
.ol-c-tag{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--brand);background:color-mix(in srgb,var(--brand) 12%,#fff);padding:3px 9px;border-radius:6px}
.ol-c-pin{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#b45309;background:#fef3c7;padding:3px 9px;border-radius:6px}
.ol-c-author{font-size:13px;color:#64748b;font-weight:600}
.ol-c-title{margin:0 0 6px;font-size:19px;font-weight:700;letter-spacing:-.01em;color:#0f172a;transition:color .15s}
.ol-c-post:hover .ol-c-title{color:var(--brand)}
.ol-c-excerpt{margin:0 0 12px;font-size:15px;color:#475569;line-height:1.55}
.ol-c-foot{display:flex;align-items:center;gap:16px;font-size:13px;color:#94a3b8;font-weight:600}
.ol-c-stat{display:inline-flex;align-items:center;gap:6px}
.ol-c-ico{color:#94a3b8;flex:0 0 auto}
.ol-c-when{margin-left:auto;font-weight:500}
.ol-c-empty{padding:30px 20px;text-align:center;color:#64748b;font-size:15px;border:1px dashed #d7dde5;border-radius:16px}
.ol-c-backlink{display:inline-flex;align-items:center;gap:6px;margin-bottom:22px;font-size:14px;font-weight:600;color:var(--brand);text-decoration:none}
.ol-c-backlink:hover{text-decoration:underline}
.ol-c-article-title{margin:0 0 10px;font-size:28px;line-height:1.18;font-weight:800;letter-spacing:-.02em;color:#0f172a}
.ol-c-article-meta{display:flex;align-items:center;gap:14px;margin:0 0 22px;padding:0 0 22px;border-bottom:1px solid #eef1f5;font-size:13px;color:#94a3b8;font-weight:600}
.ol-c-p{margin:0 0 18px;font-size:17px;line-height:1.7;color:#1e293b;white-space:pre-line}
.ol-c-comments-h{font-size:14px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:#94a3b8;margin:26px 0 16px}
.ol-c-comment{padding:16px 0;border-top:1px solid #f1f5f9}
.ol-c-comment:first-of-type{border-top:0}
.ol-c-comment-head{display:flex;align-items:center;gap:10px;margin:0 0 6px}
.ol-c-avatar{width:30px;height:30px;border-radius:999px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--brand) 14%,#fff);color:var(--brand);font-size:13px;font-weight:700}
.ol-c-comment-author{font-size:14px;font-weight:700;color:#0f172a}
.ol-c-comment-when{font-size:12px;color:#94a3b8;font-weight:500;margin-left:auto}
.ol-c-comment-body{margin:0;font-size:15px;color:#334155;line-height:1.6;white-space:pre-line}
.ol-c-none{padding:18px 0;color:#94a3b8;font-size:14px}
</style>`

// --- feed (index) ---------------------------------------------------------

export interface CommunityFeedChannel {
  slug: string
  name: string
  /** Derived real post count for this channel. */
  postCount: number
}

export interface CommunityFeedPost {
  id: string
  /** The channel this post belongs to, shown as a tag. */
  channelName: string
  authorName: string | null
  title: string | null
  body: string | null
  pinned: boolean
  createdAt: string | null
  /** Derived real like count. */
  likes: number
  /** Derived real comment count. */
  comments: number
}

export interface CommunityFeedOpts {
  businessName: string
  brandColor?: string
  loc: string
  slug: string
  communityName: string
  description: string | null
  /** Derived real member count. */
  members: number
  /** Derived real total post count. */
  posts: number
  channels: CommunityFeedChannel[]
  /** Slug of the channel currently filtered to, or null for "All". */
  activeChannelSlug: string | null
  feed: CommunityFeedPost[]
}

/** First-initial avatar glyph for a name (escaped). '·' when unknown. */
function initial(name: string | null): string {
  const ch = (name ?? '').trim().charAt(0)
  return ch ? escText(ch.toUpperCase()) : '·'
}

function channelChip(loc: string, slug: string, ch: CommunityFeedChannel, active: boolean): string {
  const href = `${PUBLIC_BASE}/${escAttr(loc)}/${escAttr(slug)}/c/${escAttr(ch.slug)}`
  const n = ch.postCount > 0 ? `<span class="ol-c-chip-n">${ch.postCount}</span>` : ''
  return `<a class="ol-c-chip${active ? ' ol-c-on' : ''}" href="${href}">${escText(ch.name)}${n}</a>`
}

function postFooter(post: CommunityFeedPost): string {
  const likes = countLabel(post.likes, 'like', 'likes')
  const comments = countLabel(post.comments, 'comment', 'comments')
  const likeStat = likes ? `<span class="ol-c-stat">${HEART_SVG}${likes}</span>` : ''
  const commentStat = comments ? `<span class="ol-c-stat">${CHAT_SVG}${comments}</span>` : ''
  const when = formatDate(post.createdAt)
  const whenEl = when ? `<span class="ol-c-when">${escText(when)}</span>` : ''
  return `<div class="ol-c-foot">${likeStat}${commentStat}${whenEl}</div>`
}

function postCard(loc: string, slug: string, post: CommunityFeedPost): string {
  const href = `${PUBLIC_BASE}/${escAttr(loc)}/${escAttr(slug)}/p/${escAttr(post.id)}`
  const pin = post.pinned ? '<span class="ol-c-pin">Pinned</span>' : ''
  const author = post.authorName?.trim()
    ? `<span class="ol-c-author">${escText(post.authorName)}</span>`
    : ''
  const tags = `<div class="ol-c-tags">${pin}<span class="ol-c-tag">${escText(post.channelName)}</span>${author}</div>`
  const title = post.title?.trim() ? `<h2 class="ol-c-title">${escText(post.title)}</h2>` : ''
  const ex = excerptOf(post.body)
  const excerpt = ex ? `<p class="ol-c-excerpt">${escText(ex)}</p>` : ''
  return `<a class="ol-c-post" href="${href}">
        ${tags}
        ${title}
        ${excerpt}
        ${postFooter(post)}
      </a>`
}

/** The public community feed: branded header, channel rail, and the post list
 *  (already ordered pinned-first then newest by the route). */
export function renderCommunityFeed(opts: CommunityFeedOpts): string {
  const brand = safeColor(opts.brandColor)
  const stats = metaLine([
    countLabel(opts.members, 'member', 'members') || '0 members',
    countLabel(opts.posts, 'post', 'posts') || '0 posts',
  ])
  const desc = opts.description?.trim()
    ? `<p class="ol-c-desc">${escText(opts.description)}</p>`
    : ''

  const allHref = `${PUBLIC_BASE}/${escAttr(opts.loc)}/${escAttr(opts.slug)}`
  const allChip = `<a class="ol-c-chip${opts.activeChannelSlug === null ? ' ol-c-on' : ''}" href="${allHref}">All</a>`
  const chips = opts.channels
    .map((ch) => channelChip(opts.loc, opts.slug, ch, ch.slug === opts.activeChannelSlug))
    .join('')
  const rail = `<div class="ol-c-rail">${allChip}${chips}</div>`

  const feed = opts.feed.length
    ? `<div class="ol-c-feed">${opts.feed.map((p) => postCard(opts.loc, opts.slug, p)).join('')}</div>`
    : '<div class="ol-c-empty">No posts here yet. Check back soon.</div>'

  const body = `<div class="ol-card ol-wide ol-c">
      ${COMMUNITY_STYLE}
      ${eyebrow(opts.businessName)}
      <h1 class="ol-c-h1">${escText(opts.communityName)}</h1>
      ${desc}
      <div class="ol-c-stats">${escText(stats)}</div>
      ${rail}
      ${feed}
    </div>`

  return pageShell({ title: `${opts.communityName} — ${opts.businessName}`, brand, body })
}

// --- single post ----------------------------------------------------------

export interface CommunityPostComment {
  authorName: string | null
  body: string
  createdAt: string | null
}

export interface CommunitySinglePostOpts {
  businessName: string
  brandColor?: string
  loc: string
  slug: string
  communityName: string
  post: {
    channelName: string
    authorName: string | null
    title: string | null
    body: string
    pinned: boolean
    createdAt: string | null
    likes: number
    comments: number
  }
  comments: CommunityPostComment[]
}

function commentRow(comment: CommunityPostComment): string {
  const when = formatDate(comment.createdAt)
  const whenEl = when ? `<span class="ol-c-comment-when">${escText(when)}</span>` : ''
  const author = comment.authorName?.trim() || 'Member'
  return `<div class="ol-c-comment">
        <div class="ol-c-comment-head">
          <span class="ol-c-avatar">${initial(comment.authorName)}</span>
          <span class="ol-c-comment-author">${escText(author)}</span>
          ${whenEl}
        </div>
        <p class="ol-c-comment-body">${escText(comment.body)}</p>
      </div>`
}

/** A single post with its comment thread. Likes/comments counts are derived and
 *  passed in; comments render oldest-first as the route supplies them. */
export function renderCommunityPost(opts: CommunitySinglePostOpts): string {
  const brand = safeColor(opts.brandColor)
  const p = opts.post
  const feedHref = `${PUBLIC_BASE}/${escAttr(opts.loc)}/${escAttr(opts.slug)}`

  const pin = p.pinned ? '<span class="ol-c-pin">Pinned</span>' : ''
  const author = p.authorName?.trim() ? `<span class="ol-c-author">${escText(p.authorName)}</span>` : ''
  const tags = `<div class="ol-c-tags">${pin}<span class="ol-c-tag">${escText(p.channelName)}</span>${author}</div>`
  const title = p.title?.trim() ? `<h1 class="ol-c-article-title">${escText(p.title)}</h1>` : ''
  const article = p.body?.trim() ? renderBody(p.body) : ''

  const likes = countLabel(p.likes, 'like', 'likes')
  const comments = countLabel(p.comments, 'comment', 'comments')
  const likeStat = likes ? `<span class="ol-c-stat">${HEART_SVG}${likes}</span>` : ''
  const commentStat = comments ? `<span class="ol-c-stat">${CHAT_SVG}${comments}</span>` : ''
  const when = formatDate(p.createdAt)
  const whenEl = when ? `<span class="ol-c-when">${escText(when)}</span>` : ''
  const meta = `<div class="ol-c-article-meta">${likeStat}${commentStat}${whenEl}</div>`

  const commentsHead = `<div class="ol-c-comments-h">${
    opts.comments.length ? escText(`${opts.comments.length} comment${opts.comments.length === 1 ? '' : 's'}`) : 'Comments'
  }</div>`
  const commentsList = opts.comments.length
    ? opts.comments.map(commentRow).join('')
    : '<div class="ol-c-none">No comments yet.</div>'

  const body = `<div class="ol-card ol-wide ol-c">
      ${COMMUNITY_STYLE}
      <a class="ol-c-backlink" href="${feedHref}">← ${escText(opts.communityName)}</a>
      ${tags}
      ${title}
      ${meta}
      ${article}
      ${commentsHead}
      ${commentsList}
    </div>`

  return pageShell({ title: `${p.title?.trim() || 'Post'} — ${opts.communityName}`, brand, body })
}

/** A styled 404 for an unknown / unpublished community or post — self-contained. */
export function renderCommunityNotFound(): string {
  return notFoundPage('This community is not available.')
}
