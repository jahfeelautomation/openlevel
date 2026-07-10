import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { proposalTotalCents, readLineItems } from '../lib/proposal-math'
import { ProposalsRepo } from '../repos/proposals-repo'
import { TimelineRepo } from '../repos/timeline-repo'

// One billable line on a proposal. unit_amount is in cents, like every money
// value here. quantity allows 0 so an "included at no charge" line is honest.
const lineItemSchema = z.object({
  description: z.string().default(''),
  quantity: z.number().int().min(0).default(1),
  unit_amount: z.number().int().min(0).default(0),
})

// The proposal body. Edited wholesale (survey-style) on PATCH; `.passthrough()`
// keeps any forward-compatible keys the builder adds without losing them.
const contentSchema = z
  .object({
    intro: z.string().optional(),
    line_items: z.array(lineItemSchema).optional(),
    terms: z.string().optional(),
    signer_role: z.string().optional(),
  })
  .passthrough()

const createProposalSchema = z.object({
  title: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and dashes'),
  contactId: z.string().min(1).nullish(),
})

const patchProposalSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  contactId: z.string().min(1).nullish(),
  currency: z.string().min(1).optional(),
  content: contentSchema.optional(),
})

// A real, sendable starter so a new proposal opens as a complete document the
// operator edits down — not an empty shell. Amounts are in cents and match the
// SIAS Growth shape; the dollar total is always derived from these lines.
const STARTER_CONTENT = {
  intro: "Thanks for considering us — here's exactly what we recommend and what it costs.",
  line_items: [
    { description: 'Strategy & setup (one-time)', quantity: 1, unit_amount: 150000 },
    { description: 'Monthly management', quantity: 1, unit_amount: 125000 },
  ],
  terms:
    'This proposal is valid for 30 days. Month-to-month after setup; cancel anytime with 30 days notice.',
}

/**
 * Proposals & estimates for the current location. Mounted behind operatorAuth +
 * locationAccess. The Proposals UI reads GET / (list — each row carries its line
 * items so the dollar total is derived the same way on client and server, never
 * stored) and GET /:id. Creating a proposal seeds a real starter document and
 * starts it as a draft.
 *
 * The operator can edit a proposal's body (PATCH /:id) and send it
 * (POST /:id/send → draft becomes sent, the public link goes live). That's the
 * full operator side. Signing and declining live exclusively on the public route
 * (public-proposals.ts): the operator can never fake a signature here, which is
 * the whole honesty point — a signed proposal records exactly what the recipient
 * typed on their own.
 */
export function proposalsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const proposals = await new ProposalsRepo(deps.db, loc).list()
    return c.json({ proposals })
  })

  app.post('/', zValidator('json', createProposalSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const proposal = await new ProposalsRepo(deps.db, loc).create({
      title: input.title,
      slug: input.slug,
      contactId: input.contactId ?? null,
      content: STARTER_CONTENT,
    })
    return c.json({ ok: true, proposal }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const proposal = await new ProposalsRepo(deps.db, loc).get(c.req.param('id'))
    if (!proposal) return c.json({ error: 'not found' }, 404)
    return c.json({ proposal })
  })

  app.patch('/:id', zValidator('json', patchProposalSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const proposal = await new ProposalsRepo(deps.db, loc).update(id, {
      title: body.title,
      slug: body.slug,
      contactId: body.contactId,
      currency: body.currency,
      content: body.content,
    })
    if (!proposal) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, proposal })
  })

  app.post('/:id/send', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const repo = new ProposalsRepo(deps.db, loc)
    const proposal = await repo.markSent(id)
    if (!proposal) return c.json({ error: 'not found' }, 404)
    if (proposal.contact_id) {
      await new TimelineRepo(deps.db, loc).add({
        contactId: proposal.contact_id,
        type: 'proposal_sent',
        refTable: 'proposals',
        refId: proposal.id,
        payload: {
          title: proposal.title,
          total_cents: proposalTotalCents(readLineItems(proposal.content)),
        },
      })
    }
    return c.json({ ok: true, proposal })
  })

  return app
}
