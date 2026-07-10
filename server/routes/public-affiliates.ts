import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { AffiliateClicksRepo } from '../repos/affiliate-clicks-repo'
import { AffiliateProgramsRepo } from '../repos/affiliate-programs-repo'
import { AffiliatesRepo } from '../repos/affiliates-repo'
import { ContactsRepo } from '../repos/contacts-repo'

/** A minimal, dependency-free 404 for an unknown referral code. */
function renderRefNotFound(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Referral link not found</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0}
.card{text-align:center;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#94a3b8;margin:0}</style>
</head><body><div class="card"><h1>This referral link isn't available</h1>
<p>It may have been removed or the address is mistyped.</p></div></body></html>`
}

/**
 * Public, UNAUTHENTICATED affiliate referral links — mounted at `/api/public/ref`
 * BEFORE the operatorAuth boundary, reading the location from the URL (`:loc`):
 *
 *   GET /:loc/:code[?c=<contactId>]  → record the visit, then 302 → program landing_url
 *
 * The redirect is a 302 (not a cached 301) so every real visit is counted. The
 * visit is stored as its own click row — an affiliate's click stats are aggregated
 * from these rows, never a stored counter, so a count can't be inflated. When `?c=`
 * names a contact that genuinely belongs to this location, the visit is attributed
 * to them; an unknown `?c=` is an honest anonymous visit (the click still counts)
 * and never reveals whether that id exists. This route is deliberately
 * self-contained: no timeline write, no workflow dispatch — a referral visit is
 * just a tracked redirect to where the program sends its traffic.
 *
 * An unknown code, an affiliate whose program is missing, or a program with no
 * landing URL renders a plain 404 and records nothing.
 */
export function publicAffiliatesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/:loc/:code', async (c) => {
    const loc = c.req.param('loc')
    const code = c.req.param('code')

    const affiliate = await new AffiliatesRepo(deps.db, loc).getByCode(code)
    // A paused (deactivated) affiliate's link stops working: no redirect, no
    // recorded click, so it can't keep earning attribution after the operator
    // turned it off. Rendered as not-found so the code's existence isn't revealed.
    if (!affiliate || affiliate.status !== 'active') return c.html(renderRefNotFound(), 404)

    // The program must be live too — a paused program pauses every link under it.
    const program = await new AffiliateProgramsRepo(deps.db, loc).get(affiliate.program_id)
    if (!program || program.status !== 'active' || !program.landing_url) {
      return c.html(renderRefNotFound(), 404)
    }

    // Attribute the visit to a contact only when ?c= names one that really belongs
    // to this location; otherwise it's an honest anonymous visit (we don't leak
    // whether the supplied id exists by behaving any differently).
    const wanted = c.req.query('c')
    let contactId: string | null = null
    if (wanted) {
      const contact = await new ContactsRepo(deps.db, loc).get(wanted)
      if (contact) contactId = contact.id
    }

    // Record the visit (the only fact we store) before redirecting.
    await new AffiliateClicksRepo(deps.db, loc).record({ affiliateId: affiliate.id, contactId })

    return c.redirect(program.landing_url, 302)
  })

  return app
}
