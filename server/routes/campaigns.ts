import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { sendCampaign } from '../lib/sending/campaign-send'
import { CampaignRecipientsRepo } from '../repos/campaign-recipients-repo'
import { CampaignsRepo } from '../repos/campaigns-repo'
import { ContactsRepo } from '../repos/contacts-repo'
import { CustomValuesRepo } from '../repos/custom-values-repo'

const CHANNELS = ['sms', 'email'] as const

const createCampaignSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(CHANNELS).default('sms'),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
  audienceTag: z.string().nullable().optional(),
})

// Cap a single blast so an accidental "all contacts" send can't fan out unbounded.
const MAX_AUDIENCE = 5000

/**
 * Marketing campaigns for the current location. Mounted behind operatorAuth +
 * locationAccess. GET / lists; POST / drafts; GET /:id returns the campaign with
 * its recipients; POST /:id/send resolves the audience (all contacts or a tag
 * segment) and fans the blast out through the LOCATION's own provider (Brevo
 * email / Twilio SMS, Module 49). No provider connected = an honest 409, the
 * campaign stays draft, and nothing pretends to deliver. Each recipient row
 * records the real outcome (sent/skipped/failed); sent_count counts only
 * messages the provider actually accepted.
 */
export function campaignsRoute(deps: { db: Database; send?: typeof sendCampaign }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const campaigns = await new CampaignsRepo(deps.db, loc).list()
    return c.json({ campaigns })
  })

  app.post('/', zValidator('json', createCampaignSchema), async (c) => {
    const loc = c.get('locationId')
    const campaign = await new CampaignsRepo(deps.db, loc).create(c.req.valid('json'))
    return c.json({ ok: true, campaign }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const campaign = await new CampaignsRepo(deps.db, loc).get(id)
    if (!campaign) return c.json({ error: 'not found' }, 404)
    const recipients = await new CampaignRecipientsRepo(deps.db, loc).listByCampaign(id)
    return c.json({ campaign, recipients })
  })

  app.post('/:id/send', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const campaigns = new CampaignsRepo(deps.db, loc)

    const campaign = await campaigns.get(id)
    if (!campaign) return c.json({ error: 'not found' }, 404)
    if (campaign.status !== 'draft') return c.json({ error: 'campaign already sent' }, 409)

    const contactsRepo = new ContactsRepo(deps.db, loc)
    const audience = campaign.audience_tag
      ? await contactsRepo.listByTag(campaign.audience_tag)
      : await contactsRepo.list(MAX_AUDIENCE)
    if (audience.length === 0) return c.json({ error: 'no matching contacts' }, 400)

    const customValues = await new CustomValuesRepo(deps.db, loc).map()
    const result = await (deps.send ?? sendCampaign)(
      { db: deps.db },
      { locationId: loc, campaign, contacts: audience, customValues },
    )
    if (!result.ok) return c.json({ error: result.reason }, 409)

    await new CampaignRecipientsRepo(deps.db, loc).bulkInsertOutcomes(
      id,
      result.outcomes.map((o) => ({ contactId: o.contactId, status: o.status })),
    )
    const updated = await campaigns.markSent(id, audience.length, result.sentCount)
    const delivery = {
      sent: result.sentCount,
      skipped: result.outcomes.filter((o) => o.status === 'skipped').length,
      failed: result.outcomes.filter((o) => o.status === 'failed').length,
    }
    return c.json({ ok: true, campaign: updated, delivery })
  })

  return app
}
