import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { readingTimeMinutes } from '../lib/blog-math'
import { renderBlogIndex, renderBlogNotFound, renderBlogPost } from '../lib/blog-page'
import { BlogPostsRepo } from '../repos/blog-posts-repo'
import { LocationsRepo } from '../repos/locations-repo'

/**
 * Public, UNAUTHENTICATED blog — mounted at `/api/public/blog` BEFORE the
 * operatorAuth boundary, reading the location from the URL (`:loc`):
 *
 *   GET /:loc          → the blog index (published posts only, newest first)
 *   GET /:loc/:slug    → one published post (styled 404 for a draft or unknown slug)
 *
 * Only `listPublished()` / a published `getBySlug` feed these pages, so a draft is
 * never visible. The "X min read" shown on every entry is DERIVED here from the
 * post's real word count (blog-math.ts), never stored — so it can't drift from the
 * body or be inflated. An empty blog renders an honest empty state.
 */
export function publicBlogRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  async function locationMeta(loc: string): Promise<{ name: string; brandColor?: string }> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return {
      name: location?.name ?? 'us',
      brandColor: typeof color === 'string' ? color : undefined,
    }
  }

  app.get('/:loc', async (c) => {
    const loc = c.req.param('loc')
    const posts = await new BlogPostsRepo(deps.db, loc).listPublished()
    const meta = await locationMeta(loc)
    return c.html(
      renderBlogIndex({
        businessName: meta.name,
        brandColor: meta.brandColor,
        loc,
        posts: posts.map((p) => ({
          slug: p.slug,
          title: p.title,
          excerpt: p.excerpt,
          publishedAt: p.published_at,
          readingMinutes: readingTimeMinutes(p.body),
        })),
      }),
    )
  })

  app.get('/:loc/:slug', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const post = await new BlogPostsRepo(deps.db, loc).getBySlug(slug)
    // A draft (or unknown slug) is not public — same styled 404 either way, so a
    // draft's existence never leaks.
    if (!post || post.status !== 'published') return c.html(renderBlogNotFound(), 404)

    const meta = await locationMeta(loc)
    return c.html(
      renderBlogPost({
        businessName: meta.name,
        brandColor: meta.brandColor,
        loc,
        post: {
          title: post.title,
          body: post.body,
          author: post.author,
          coverImageUrl: post.cover_image_url,
          publishedAt: post.published_at,
          readingMinutes: readingTimeMinutes(post.body),
        },
      }),
    )
  })

  return app
}
