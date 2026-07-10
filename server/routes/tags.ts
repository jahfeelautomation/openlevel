import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { TagsRepo } from '../repos/tags-repo'

const renameSchema = z.object({ name: z.string().trim().min(1) })

/**
 * Location-wide tag management — the GHL "Tags" settings area. Tags live inside
 * contacts.tags (a text[]); this exposes the distinct set with contact counts,
 * plus rename and delete across every contact in the location. Mounted behind
 * operatorAuth + locationAccess, so `locationId` is set and verified. Nothing
 * here sends a message or moves money — it only edits labels on contacts.
 *
 * The tag travels URL-encoded in the path on rename/delete (the client
 * encodeURIComponent's it), so spaces and punctuation in a tag survive.
 */
export function tagsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const tags = await new TagsRepo(deps.db, loc).list()
    return c.json({ tags })
  })

  // Rename a tag everywhere it appears. A no-op when the new name equals the old
  // (we skip the write and report 0 touched). `renamed` is the contact count.
  app.patch('/:tag', zValidator('json', renameSchema), async (c) => {
    const loc = c.get('locationId')
    const from = c.req.param('tag')
    const to = c.req.valid('json').name
    if (to === from) return c.json({ ok: true, renamed: 0 })
    const renamed = await new TagsRepo(deps.db, loc).rename(from, to)
    return c.json({ ok: true, renamed })
  })

  // Delete a tag from every contact in the location. `removed` is the contact
  // count; deleting a tag nobody has returns 0 (still ok).
  app.delete('/:tag', async (c) => {
    const loc = c.get('locationId')
    const removed = await new TagsRepo(deps.db, loc).remove(c.req.param('tag'))
    return c.json({ ok: true, removed })
  })

  return app
}
