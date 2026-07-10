import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { ContactsRepo } from '../repos/contacts-repo'
import { TimelineRepo } from '../repos/timeline-repo'
import { TriggerLinkClicksRepo } from '../repos/trigger-link-clicks-repo'
import { TriggerLinksRepo } from '../repos/trigger-links-repo'

/** A minimal, dependency-free 404 for an unknown short link. */
function renderLinkNotFound(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Link not found</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0}
.card{text-align:center;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#94a3b8;margin:0}</style>
</head><body><div class="card"><h1>This link isn't available</h1>
<p>It may have been removed or the address is mistyped.</p></div></body></html>`
}

/**
 * Public, UNAUTHENTICATED trigger links — mounted at `/api/public/l` BEFORE the
 * operatorAuth boundary, reading the location from the URL (`:loc`):
 *
 *   GET /:loc/:slug[?c=<contactId>]  → record the open, then 302 → destination_url
 *
 * The redirect is a 302 (not a cached 301) so every real open is counted. The
 * click is stored as its own row — the link's stats are aggregated from these
 * rows, never a stored counter, so a count can't be inflated. When `?c=` names a
 * contact that genuinely belongs to this location, the open is attributed to them,
 * logged on their timeline, and fires the `trigger_link_clicked` workflow trigger
 * so a real click can start an automation. An unknown `?c=` is treated as an
 * anonymous open (the click still counts) and never reveals whether that id
 * exists. An unknown slug renders a plain 404 and records nothing.
 */
export function publicTriggerLinksRoute(deps: {
  db: Database
  /** Fired on an attributed click so live trigger-link workflows enroll the contact. */
  dispatch?: WorkflowDispatch
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/:loc/:slug', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')

    const link = await new TriggerLinksRepo(deps.db, loc).getBySlug(slug)
    if (!link) return c.html(renderLinkNotFound(), 404)

    // Attribute the open to a contact only when ?c= names one that really belongs
    // to this location; otherwise it's an honest anonymous open (we don't leak
    // whether the supplied id exists by behaving any differently).
    const wanted = c.req.query('c')
    let contactId: string | null = null
    if (wanted) {
      const contact = await new ContactsRepo(deps.db, loc).get(wanted)
      if (contact) contactId = contact.id
    }

    // Record the open (the only fact we store) before redirecting.
    await new TriggerLinkClicksRepo(deps.db, loc).record({ linkId: link.id, contactId })

    // An identified click drives the automation loop + the contact's timeline.
    if (contactId) {
      await new TimelineRepo(deps.db, loc).add({
        contactId,
        type: 'trigger_link_click',
        refTable: 'trigger_links',
        refId: link.id,
        payload: { link: slug, name: link.name },
      })
      await deps.dispatch?.({
        locationId: loc,
        triggerType: 'trigger_link_clicked',
        contactId,
      })
    }

    return c.redirect(link.destination_url, 302)
  })

  return app
}
