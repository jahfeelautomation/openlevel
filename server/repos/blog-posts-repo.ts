import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type BlogStatus = 'draft' | 'published'

export interface BlogPost {
  id: string
  location_id: string
  title: string
  slug: string
  excerpt: string | null
  body: string | null
  cover_image_url: string | null
  author: string | null
  status: string
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface BlogPostInput {
  title: string
  slug: string
  excerpt?: string | null
  body?: string | null
  coverImageUrl?: string | null
  author?: string | null
  status?: BlogStatus
}

export interface BlogPostPatch {
  title?: string
  slug?: string
  excerpt?: string | null
  body?: string | null
  coverImageUrl?: string | null
  author?: string | null
  status?: BlogStatus
}

/**
 * Blog posts for one location. A post is a draft until published; `listPublished`
 * is the only feed the public blog reads, so a draft is never served. The "5 min
 * read" badge lives nowhere on this row — it is derived from the body's word count
 * in blog-math.ts — so this repo owns only the post's own facts. `published_at` is
 * stamped on the FIRST publish (COALESCE on re-publish, untouched on unpublish) so
 * a post's public date never lies about when it went live. `getBySlug` powers a
 * stable, human-readable public URL, bound to the location so it stays tenancy-safe.
 */
export class BlogPostsRepo extends LocationScopedRepo {
  /** Operator feed — every post, newest first. */
  list(): Promise<BlogPost[]> {
    return this.scopedSelect<BlogPost>('SELECT * FROM blog_posts ORDER BY created_at DESC')
  }

  /** Public feed — published posts only, most-recently-published first. */
  listPublished(): Promise<BlogPost[]> {
    return this.scopedSelect<BlogPost>(
      "SELECT * FROM blog_posts WHERE status='published' ORDER BY published_at DESC",
    )
  }

  async get(id: string): Promise<BlogPost | undefined> {
    const rows = await this.scopedSelect<BlogPost>('SELECT * FROM blog_posts WHERE id=$2', [id])
    return rows[0]
  }

  async getBySlug(slug: string): Promise<BlogPost | undefined> {
    const rows = await this.scopedSelect<BlogPost>('SELECT * FROM blog_posts WHERE slug=$2', [slug])
    return rows[0]
  }

  /** Insert a post. A post created already-published is stamped published_at now;
   *  a draft has a null date until it first goes live. */
  async create(input: BlogPostInput): Promise<BlogPost> {
    const id = nanoid()
    const rows = await this.scopedWrite<BlogPost>(
      `INSERT INTO blog_posts (id, location_id, title, slug, excerpt, body, cover_image_url, author, status, published_at)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $9='published' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        id,
        input.title,
        input.slug,
        input.excerpt ?? null,
        input.body ?? null,
        input.coverImageUrl ?? null,
        input.author ?? null,
        input.status ?? 'draft',
      ],
    )
    return rows[0]!
  }

  /** Patch the supplied fields only; always refresh updated_at. Publishing stamps
   *  published_at the first time only (COALESCE), so re-publishing keeps the
   *  original date and unpublishing leaves it intact. `scopedWrite` prepends
   *  locationId as $1, so the dynamic params number from $2. */
  async update(id: string, patch: BlogPostPatch): Promise<BlogPost | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.title !== undefined) bind('title', patch.title)
    if (patch.slug !== undefined) bind('slug', patch.slug)
    if (patch.excerpt !== undefined) bind('excerpt', patch.excerpt)
    if (patch.body !== undefined) bind('body', patch.body)
    if (patch.coverImageUrl !== undefined) bind('cover_image_url', patch.coverImageUrl)
    if (patch.author !== undefined) bind('author', patch.author)
    if (patch.status !== undefined) {
      bind('status', patch.status)
      // First publish stamps the live date; re-publish keeps it (COALESCE).
      if (patch.status === 'published') sets.push('published_at=COALESCE(published_at, now())')
    }
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<BlogPost>(
      `UPDATE blog_posts SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM blog_posts WHERE location_id=$1 AND id=$2', [id])
  }
}
