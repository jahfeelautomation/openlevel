import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { type SubscriptionSummary, nextRenewal, summarize } from '../lib/subscription-math'
import { ProductsRepo } from '../repos/products-repo'
import { type Subscription, SubscriptionsRepo } from '../repos/subscriptions-repo'

const statusSchema = z.enum(['active', 'paused', 'canceled'])

// Start a subscription FROM a recurring product: the operator picks a product
// (and optionally who it is for and when it began); the route snapshots the
// product's name, price, currency and cadence so the commitment is fixed even if
// the product later changes. There is no amount field here on purpose — the price
// always comes from the catalog, never typed free-hand.
const createSchema = z.object({
  productId: z.string().trim().min(1),
  contactId: z.string().trim().min(1).optional(),
  startedAt: z.string().trim().min(1).optional(),
})

// Lifecycle plus light corrections. status drives pause/resume/cancel (the repo
// couples the cancel stamp); contactId can be reassigned or cleared; startedAt
// can be corrected. Name, amount and cadence are deliberately NOT editable — they
// are a snapshot, so changing them would quietly rewrite history.
const patchSchema = z.object({
  status: statusSchema.optional(),
  contactId: z.string().trim().min(1).nullable().optional(),
  startedAt: z.string().trim().min(1).optional(),
})

/** Attach the derived next renewal date: a real date for an active subscription,
 *  null for a paused or canceled one (nothing is scheduled to renew). */
function withSchedule(
  s: Subscription,
  nowISO: string,
): Subscription & { next_renewal: string | null } {
  const next_renewal =
    s.status === 'active' ? nextRenewal(s.started_at, s.billing_interval, nowISO) : null
  return { ...s, next_renewal }
}

/**
 * The recurring-commitment ledger for the current location (GHL "Payments ->
 * Subscriptions"). Mounted behind operatorAuth + locationAccess. This module is
 * bookkeeping only: it records that a contact is on a recurring arrangement and
 * derives the schedule and MRR from those rows — it never charges a card, sends
 * an invoice, or moves money. A subscription can only be started from a recurring
 * catalog product, so its price is always one the operator actually set.
 */
export function subscriptionsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const subs = await new SubscriptionsRepo(deps.db, loc).list()
    const nowISO = new Date().toISOString()
    const subscriptions = subs.map((s) => withSchedule(s, nowISO))
    const summary: SubscriptionSummary = summarize(subs)
    return c.json({ subscriptions, summary })
  })

  app.post('/', zValidator('json', createSchema), async (c) => {
    const loc = c.get('locationId')
    const body = c.req.valid('json')

    // Snapshot off the catalog product. A subscription must come from a recurring
    // product — a one_time product has no cadence to bill on, so we refuse it
    // rather than invent one.
    const product = await new ProductsRepo(deps.db, loc).get(body.productId)
    if (!product) return c.json({ error: 'product not found' }, 404)
    if (product.type !== 'recurring' || !product.recurring_interval) {
      return c.json({ error: 'product is not recurring' }, 400)
    }

    const subscription = await new SubscriptionsRepo(deps.db, loc).create({
      productId: product.id,
      contactId: body.contactId ?? null,
      name: product.name,
      amountCents: product.price_cents,
      currency: product.currency,
      interval: product.recurring_interval,
      startedAt: body.startedAt ?? null,
    })
    return c.json({ ok: true, subscription }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const sub = await new SubscriptionsRepo(deps.db, loc).get(c.req.param('id'))
    if (!sub) return c.json({ error: 'not found' }, 404)
    return c.json({ subscription: withSchedule(sub, new Date().toISOString()) })
  })

  app.patch('/:id', zValidator('json', patchSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new SubscriptionsRepo(deps.db, loc)
    const id = c.req.param('id')
    const existing = await repo.get(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    const subscription = await repo.update(id, c.req.valid('json'))
    return c.json({ ok: true, subscription: subscription ?? existing })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const ok = await new SubscriptionsRepo(deps.db, loc).remove(c.req.param('id'))
    if (!ok) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  return app
}
