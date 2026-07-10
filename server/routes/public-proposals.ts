import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { renderProposalNotFound, renderProposalPage } from '../lib/proposal-page'
import { LocationsRepo } from '../repos/locations-repo'
import { ProposalsRepo } from '../repos/proposals-repo'
import { TimelineRepo } from '../repos/timeline-repo'

const signSchema = z.object({
  signer_name: z.string().trim().min(1).max(120),
})

/**
 * Public, UNAUTHENTICATED proposals — mounted at `/api/public/proposals` BEFORE
 * the operatorAuth boundary, so it reads the location from the URL (`:loc`).
 *
 *   GET  /:loc/:slug          → a sent proposal (visitor render); marks it viewed
 *   POST /:loc/:slug/sign     → record the typed signature, fire proposal_signed
 *   POST /:loc/:slug/decline  → record a decline
 *
 * A draft is never reachable (the operator hasn't sent it) → 404. Visiting a
 * `sent` proposal honestly advances it to `viewed`. Signing records exactly the
 * name the recipient typed plus a server timestamp — nothing is pre-filled or
 * forged — and dispatches the `proposal_signed` trigger so an accepted proposal
 * can start an automation. Sign/decline are idempotent-friendly: re-signing a
 * signed proposal echoes the stored signature; the opposite terminal state is a
 * 409 so we never silently overwrite a decision.
 */
export function publicProposalsRoute(deps: {
  db: Database
  /** Fired after a signature so live workflows enroll the contact. */
  dispatch?: WorkflowDispatch
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  async function brandColor(loc: string): Promise<string | undefined> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return typeof color === 'string' ? color : undefined
  }

  // A sent/viewed/signed/declined proposal renders as a real hostable page.
  // A draft or unknown slug → a styled 404 page.
  app.get('/:loc/:slug', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const repo = new ProposalsRepo(deps.db, loc)
    const proposal = await repo.getBySlug(slug)
    if (!proposal || proposal.status === 'draft') return c.html(renderProposalNotFound(), 404)

    // Honestly record that the recipient opened it (sent -> viewed only).
    if (proposal.status === 'sent') await repo.markViewed(proposal.id)
    return c.html(renderProposalPage(proposal, { brandColor: await brandColor(loc) }))
  })

  app.post('/:loc/:slug/sign', zValidator('json', signSchema), async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const { signer_name } = c.req.valid('json')

    const repo = new ProposalsRepo(deps.db, loc)
    const proposal = await repo.getBySlug(slug)
    if (!proposal || proposal.status === 'draft') return c.json({ error: 'not found' }, 404)

    // Already signed → echo the stored signature (idempotent, friendly on a
    // double-submit). Declined → refuse, so we never overwrite a "no".
    if (proposal.status === 'signed') {
      return c.json({ ok: true, signer_name: proposal.signer_name, signed_at: proposal.signed_at })
    }
    if (proposal.status === 'declined') return c.json({ error: 'declined' }, 409)

    const signed = await repo.sign(proposal.id, signer_name)
    if (!signed) return c.json({ error: 'not found' }, 404)

    // Log it on the contact's timeline (if the proposal is tied to one).
    if (signed.contact_id) {
      await new TimelineRepo(deps.db, loc).add({
        contactId: signed.contact_id,
        type: 'proposal_signed',
        refTable: 'proposals',
        refId: signed.id,
        payload: { proposal: slug, signer_name: signed.signer_name },
      })
    }

    // An accepted proposal can start its own workflow.
    await deps.dispatch?.({
      locationId: loc,
      triggerType: 'proposal_signed',
      contactId: signed.contact_id,
    })

    return c.json({ ok: true, signer_name: signed.signer_name, signed_at: signed.signed_at })
  })

  app.post('/:loc/:slug/decline', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')

    const repo = new ProposalsRepo(deps.db, loc)
    const proposal = await repo.getBySlug(slug)
    if (!proposal || proposal.status === 'draft') return c.json({ error: 'not found' }, 404)

    if (proposal.status === 'declined') return c.json({ ok: true })
    if (proposal.status === 'signed') return c.json({ error: 'signed' }, 409)

    const declined = await repo.decline(proposal.id)
    if (declined?.contact_id) {
      await new TimelineRepo(deps.db, loc).add({
        contactId: declined.contact_id,
        type: 'proposal_declined',
        refTable: 'proposals',
        refId: declined.id,
        payload: { proposal: slug },
      })
    }
    return c.json({ ok: true })
  })

  return app
}
