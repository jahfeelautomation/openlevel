import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { TriggerLinkClicksRepo } from '../repos/trigger-link-clicks-repo'
import { type TriggerLinkWithStats, TriggerLinksRepo } from '../repos/trigger-links-repo'

// Where the public short link is served (see index.ts: app.route('/api/public/l', ...)).
// The operator UI shows a link's hosted URL for the copy-to-clipboard affordance.
const PUBLIC_LINK_BASE = '/api/public/l'

// A destination must be an absolute http(s) URL so the 302 target can never be a
// javascript:/data: scheme (which would let a link run script on open).
const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'must be an http(s) URL')

const createLinkSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  destinationUrl: httpUrl,
})

const patchLinkSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  destinationUrl: httpUrl.optional(),
})

/** A URL-safe slug from a name: lowercased, non-alphanumerics collapsed to a
 *  single dash, trimmed, capped. Falls back to 'link' for an all-symbol name. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'link'
}

/**
 * Trackable short links for the current location. Mounted behind operatorAuth +
 * locationAccess. The list each row carries — clicks, distinct contacts, last
 * clicked — is DERIVED by the repo from the real click rows (never a stored
 * counter), so the figures can't be inflated; a brand-new link is an honest zero.
 *
 *   GET  /        list links with their derived stats + hosted link
 *   POST /        create a link (slug derived from the name + made unique)
 *   GET  /:id     one link with stats + the recent-click activity feed
 *   PATCH /:id    edit the name / slug / destination
 *   DELETE /:id   remove a link (its clicks cascade in the DB)
 */
export function triggerLinksRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** Attach the hosted public URL to a stats row. */
  function decorate(loc: string, link: TriggerLinkWithStats) {
    return { ...link, link: `${PUBLIC_LINK_BASE}/${loc}/${link.slug}` }
  }

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const links = await new TriggerLinksRepo(deps.db, loc).listWithStats()
    return c.json({ links: links.map((l) => decorate(loc, l)) })
  })

  app.post('/', zValidator('json', createLinkSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const repo = new TriggerLinksRepo(deps.db, loc)
    // Derive a slug from the name when none is given, and keep it unique within the
    // location so the public short URL never collides with an existing link.
    let slug = input.slug?.trim() || slugify(input.name)
    if (await repo.getBySlug(slug)) slug = `${slug}-${nanoid(4).toLowerCase()}`
    const created = await repo.create({
      name: input.name,
      slug,
      destinationUrl: input.destinationUrl,
    })
    // Re-read through the stats view so the response shape matches the list (an
    // honest 0 clicks for a brand-new link).
    const link = await repo.getWithStats(created.id)
    return c.json({ ok: true, link: decorate(loc, link!) }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const link = await new TriggerLinksRepo(deps.db, loc).getWithStats(id)
    if (!link) return c.json({ error: 'not found' }, 404)
    const clicks = await new TriggerLinkClicksRepo(deps.db, loc).recentForLink(id, 20)
    return c.json({ link: decorate(loc, link), clicks })
  })

  app.patch('/:id', zValidator('json', patchLinkSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const repo = new TriggerLinksRepo(deps.db, loc)
    const updated = await repo.update(id, {
      name: body.name,
      slug: body.slug,
      destinationUrl: body.destinationUrl,
    })
    if (!updated) return c.json({ error: 'not found' }, 404)
    const link = await repo.getWithStats(id)
    return c.json({ ok: true, link: decorate(loc, link!) })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const repo = new TriggerLinksRepo(deps.db, loc)
    const link = await repo.get(c.req.param('id'))
    if (!link) return c.json({ error: 'not found' }, 404)
    await repo.remove(link.id)
    return c.json({ ok: true })
  })

  return app
}
