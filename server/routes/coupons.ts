import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { type CouponSummary, isRedeemable, summarize } from '../lib/coupon-math'
import { type Coupon, CouponsRepo } from '../repos/coupons-repo'

const discountTypeSchema = z.enum(['percent', 'fixed'])

// Define a coupon. `discountValue` is whole percent for a percent coupon or an
// integer cent amount for a fixed one; a percent is held to 1..100 so a typo
// can't define a >100%-off code (computeDiscount would clamp it anyway, but we
// refuse it at the door). `code` is normalised by the repo; uniqueness per
// location is checked here so a duplicate is an honest 409, not a silent collision.
const createSchema = z
  .object({
    code: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable().optional(),
    discountType: discountTypeSchema.default('percent'),
    discountValue: z.number().int().positive(),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    expiresAt: z.string().trim().min(1).nullable().optional(),
  })
  .refine((d) => d.discountType !== 'percent' || d.discountValue <= 100, {
    message: 'a percent discount must be between 1 and 100',
    path: ['discountValue'],
  })

// Edit any field, plus archive/restore via status. Patches are sparse: an absent
// key is left untouched, while an explicit null clears the expiry or the cap.
const patchSchema = z.object({
  code: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).nullable().optional(),
  discountType: discountTypeSchema.optional(),
  discountValue: z.number().int().positive().optional(),
  status: z.enum(['active', 'archived']).optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().trim().min(1).nullable().optional(),
})

/** Attach the DERIVED redeemable flag (active + not expired + under its cap) so
 *  the client never has to recompute the rule — the server is the one authority. */
function withRedeemable(coupon: Coupon, nowISO: string): Coupon & { redeemable: boolean } {
  return { ...coupon, redeemable: isRedeemable(coupon, nowISO) }
}

/**
 * The Coupons manager for the current location (GHL "Payments -> Coupons").
 * Mounted behind operatorAuth + locationAccess. This module is bookkeeping only:
 * a coupon is a reusable discount DEFINITION that a later module can apply to an
 * invoice's recorded total — nothing here charges a card or moves money.
 * `times_redeemed` is advanced only when a code is actually applied, so the usage
 * figures and the derived "redeemable" state can never overstate reality.
 *
 *   GET    /        every coupon (each with a derived `redeemable`) + KPI summary
 *   POST   /        define a coupon (409 if the code already exists here)
 *   GET    /:id     one coupon with its derived `redeemable`
 *   PATCH  /:id     edit fields / archive / restore
 *   DELETE /:id     remove a coupon
 */
export function couponsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const all = await new CouponsRepo(deps.db, loc).list()
    const nowISO = new Date().toISOString()
    const coupons = all.map((coupon) => withRedeemable(coupon, nowISO))
    const summary: CouponSummary = summarize(all, nowISO)
    return c.json({ coupons, summary })
  })

  app.post('/', zValidator('json', createSchema), async (c) => {
    const loc = c.get('locationId')
    const body = c.req.valid('json')
    const repo = new CouponsRepo(deps.db, loc)

    // A code is the customer-facing handle, so a collision is a real conflict the
    // operator must resolve, not something to auto-suffix away.
    const existing = await repo.getByCode(body.code)
    if (existing) return c.json({ error: 'a coupon with that code already exists' }, 409)

    const coupon = await repo.create({
      code: body.code,
      description: body.description ?? null,
      discountType: body.discountType,
      discountValue: body.discountValue,
      maxRedemptions: body.maxRedemptions ?? null,
      expiresAt: body.expiresAt ?? null,
    })
    return c.json({ ok: true, coupon }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const coupon = await new CouponsRepo(deps.db, loc).get(c.req.param('id'))
    if (!coupon) return c.json({ error: 'not found' }, 404)
    return c.json({ coupon: withRedeemable(coupon, new Date().toISOString()) })
  })

  app.patch('/:id', zValidator('json', patchSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new CouponsRepo(deps.db, loc)
    const id = c.req.param('id')
    const existing = await repo.get(id)
    if (!existing) return c.json({ error: 'not found' }, 404)

    // Cross-field guard. A sparse patch must not be able to leave the coupon
    // internally inconsistent. Flipping the type to percent (or raising the
    // value) while the OTHER field is left untouched could persist a percent
    // coupon whose value exceeds 100 — e.g. a $50.00 fixed code (value 5000)
    // re-typed to percent would read "5000% off". computeDiscount clamps it at
    // apply-time so it never overcharges, but the stored row and its label would
    // lie, and we never lie in copy. Re-apply the create-time rule against the
    // EFFECTIVE post-merge pair.
    const patch = c.req.valid('json')
    const effectiveType = patch.discountType ?? existing.discount_type
    const effectiveValue = patch.discountValue ?? existing.discount_value
    if (effectiveType === 'percent' && effectiveValue > 100) {
      return c.json({ error: 'a percent discount must be between 1 and 100' }, 400)
    }

    // A renamed code must stay unique within the location, just like on create.
    if (c.req.valid('json').code !== undefined) {
      const clash = await repo.getByCode(c.req.valid('json').code!)
      if (clash && clash.id !== id) {
        return c.json({ error: 'a coupon with that code already exists' }, 409)
      }
    }

    const coupon = await repo.update(id, c.req.valid('json'))
    return c.json({ ok: true, coupon: coupon ?? existing })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const ok = await new CouponsRepo(deps.db, loc).remove(c.req.param('id'))
    if (!ok) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  return app
}
