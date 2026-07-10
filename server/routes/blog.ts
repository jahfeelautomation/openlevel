import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { readingTimeMinutes } from '../lib/blog-math'
import { type BlogPost, BlogPostsRepo } from '../repos/blog-posts-repo'

// Where the public blog is served (see index.ts: app.route('/api/public/blog', ...)).
// The operator UI shows a post's own link for the "View live" affordance — gated on
// the post being published, since a draft's link honestly 404s.
const PUBLIC_BLOG_BASE = '/api/public/blog'

const createPostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).optional(),
  excerpt: z.string().nullish(),
  body: z.string().nullish(),
  coverImageUrl: z.string().nullish(),
  author: z.string().nullish(),
  status: z.enum(['draft', 'published']).optional(),
})

const patchPostSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  excerpt: z.string().nullish(),
  body: z.string().nullish(),
  coverImageUrl: z.string().nullish(),
  author: z.string().nullish(),
  status: z.enum(['draft', 'published']).optional(),
})

/** A URL-safe slug from a title: lowercased, non-alphanumerics collapsed to a
 *  single dash, trimmed, capped. Falls back to 'post' for an all-symbol title. */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'post'
}

/**
 * Blog posts for the current location. Mounted behind operatorAuth + locationAccess.
 * The Blogs UI reads GET / for the post list — each row carries a `readingMinutes`
 * DERIVED from the body's real word count (blog-math.ts), never stored, so it can't
 * drift from the post it describes. A post is a draft until published; only a
 * published post is ever served on the public blog, and `published_at` is stamped
 * on the FIRST publish (the repo's COALESCE) so the public date never lies.
 *
 *   POST /        create a post (draft unless told otherwise; slug derived + made unique)
 *   GET  /:id     open one post for editing
 *   PATCH /:id    edit fields / flip status (publishing stamps the live date once)
 *   DELETE /:id   remove a post
 */
export function blogRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** Decorate a stored row with the derived read time and its public link. The
   *  read time is computed here from the live body — the row never stores it. */
  function decorate(loc: string, post: BlogPost) {
    return {
      ...post,
      readingMinutes: readingTimeMinutes(post.body),
      link: `${PUBLIC_BLOG_BASE}/${loc}/${post.slug}`,
    }
  }

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const posts = await new BlogPostsRepo(deps.db, loc).list()
    return c.json({ posts: posts.map((p) => decorate(loc, p)) })
  })

  app.post('/', zValidator('json', createPostSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const repo = new BlogPostsRepo(deps.db, loc)
    // Derive a slug from the title when none is given, and keep it unique within
    // the location so the public URL never collides with an existing post.
    let slug = input.slug?.trim() || slugify(input.title)
    if (await repo.getBySlug(slug)) slug = `${slug}-${nanoid(4).toLowerCase()}`
    const post = await repo.create({
      title: input.title,
      slug,
      excerpt: input.excerpt ?? null,
      body: input.body ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      author: input.author ?? null,
      status: input.status,
    })
    return c.json({ ok: true, post: decorate(loc, post) }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const post = await new BlogPostsRepo(deps.db, loc).get(c.req.param('id'))
    if (!post) return c.json({ error: 'not found' }, 404)
    return c.json({ post: decorate(loc, post) })
  })

  app.patch('/:id', zValidator('json', patchPostSchema), async (c) => {
    const loc = c.get('locationId')
    const body = c.req.valid('json')
    const post = await new BlogPostsRepo(deps.db, loc).update(c.req.param('id'), {
      title: body.title,
      slug: body.slug,
      excerpt: body.excerpt,
      body: body.body,
      coverImageUrl: body.coverImageUrl,
      author: body.author,
      status: body.status,
    })
    if (!post) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, post: decorate(loc, post) })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const repo = new BlogPostsRepo(deps.db, loc)
    const post = await repo.get(c.req.param('id'))
    if (!post) return c.json({ error: 'not found' }, 404)
    await repo.remove(post.id)
    return c.json({ ok: true })
  })

  return app
}
