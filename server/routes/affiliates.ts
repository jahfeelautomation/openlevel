import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import {
  type AffiliateStatRow,
  commissionCents,
  conversionRate,
  rollupAffiliates,
  summarizeReferrals,
} from '../lib/affiliate-math'
import { AffiliateClicksRepo } from '../repos/affiliate-clicks-repo'
import { AffiliateProgramsRepo } from '../repos/affiliate-programs-repo'
import { AffiliateReferralsRepo } from '../repos/affiliate-referrals-repo'
import { type AffiliateWithStats, AffiliatesRepo } from '../repos/affiliates-repo'

// Where the public referral link is served (see index.ts: app.route('/api/public/ref', ...)).
// The operator UI shows each affiliate's hosted referral URL for copy-to-clipboard.
const PUBLIC_REF_BASE = '/api/public/ref'

// A landing URL must be an absolute http(s) URL so the 302 target can never be a
// javascript:/data: scheme (which would let a referral link run script on visit).
const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'must be an http(s) URL')

const COMMISSION_TYPES = ['percent', 'flat'] as const
// The lifecycle an operator drives a referral through — the GHL shape: pending
// (awaiting review) → approved (owed, payable) → paid. A payout settles ONLY
// approved rows; pending commission is reported separately and never silently
// vanishes (summarizeReferrals buckets every row's commission).
const REFERRAL_STATUSES = ['pending', 'approved', 'paid'] as const

const createProgramSchema = z.object({
  name: z.string().min(1),
  // commission_value MEANS a percentage when type is 'percent' (10 = 10%) and a
  // flat amount in CENTS when type is 'flat' (5000 = $50.00); the UI sends the
  // right units for the chosen type.
  commissionType: z.enum(COMMISSION_TYPES).optional(),
  commissionValue: z.number().min(0).optional(),
  landingUrl: httpUrl,
  status: z.string().min(1).optional(),
})

const patchProgramSchema = z.object({
  name: z.string().min(1).optional(),
  commissionType: z.enum(COMMISSION_TYPES).optional(),
  commissionValue: z.number().min(0).optional(),
  landingUrl: httpUrl.optional(),
  status: z.string().min(1).optional(),
})

const createAffiliateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullish(),
  code: z.string().min(1).optional(),
  contactId: z.string().min(1).nullish(),
})

const patchAffiliateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullish(),
  code: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  contactId: z.string().min(1).nullish(),
})

const createReferralSchema = z.object({
  // The sale this referral drove, in integer cents (the UI converts dollars).
  amountCents: z.number().int().min(0),
  description: z.string().min(1).nullish(),
  contactId: z.string().min(1).nullish(),
  occurredAt: z.string().min(1).nullish(),
})

const setReferralStatusSchema = z.object({
  status: z.enum(REFERRAL_STATUSES),
})

/** A URL-safe referral code from a name: uppercased, non-alphanumerics dropped,
 *  capped. Falls back to 'REF' for an all-symbol name. */
function codeify(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 20)
  return base || 'REF'
}

/**
 * Affiliate Manager for the current location. Mounted behind operatorAuth +
 * locationAccess. GET / returns the whole manager in one read: the program (or
 * null when none is set up), every affiliate decorated with its hosted referral
 * link and DERIVED stats, and a program rollup — all computed in affiliate-math.ts
 * from real click + referral rows, so the KPI band can never overstate what
 * exists. A brand-new affiliate is an honest zero.
 *
 *   POST   /program                       create the location's referral program
 *   PATCH  /program/:programId            edit name / rate / landing / status
 *   POST   /                              add an affiliate (code derived + made unique)
 *   GET    /:id                           one affiliate: stats, referral + click feeds, summary
 *   PATCH  /:id                           edit name / email / code / status / linked contact
 *   DELETE /:id                           remove an affiliate (clicks + referrals cascade)
 *   POST   /:id/referrals                 record a sale; commission is LOCKED from the program rate
 *   PATCH  /:id/referrals/:refId          move a referral through pending → approved → paid
 *   POST   /:id/payout                    mark every APPROVED referral paid — BOOKKEEPING, moves no money
 *
 * Two honesty rules govern this surface. (1) A referral's commission is computed
 * once, at record time, from the program rate and stored on the row, so editing
 * the rate later never rewrites what an affiliate was already owed. (2) "Record
 * payout" only flips APPROVED referrals to paid and stamps paid_at in OpenLevel's
 * ledger — pending rows await the operator's review and are never settled
 * unreviewed (the GHL lifecycle). It moves no money, exactly like an invoice's
 * "record payment": owed is the approved sum, so a payout can only shift money
 * from owed to paid, never invent or lose any.
 */
export function affiliatesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** Attach the hosted public referral URL to an affiliate row. */
  function decorate<T extends { code: string }>(loc: string, affiliate: T) {
    return { ...affiliate, ref_url: `${PUBLIC_REF_BASE}/${loc}/${affiliate.code}` }
  }

  // The whole manager in one read.
  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const program = await new AffiliateProgramsRepo(deps.db, loc).getPrimary()
    const affiliates = await new AffiliatesRepo(deps.db, loc).listWithStats(program?.id)
    return c.json({
      program: program ?? null,
      affiliates: affiliates.map((a) => decorate(loc, a)),
      rollup: rollupAffiliates(affiliates as AffiliateStatRow[]),
    })
  })

  // --- program -------------------------------------------------------------

  app.post('/program', zValidator('json', createProgramSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const program = await new AffiliateProgramsRepo(deps.db, loc).create({
      name: input.name,
      commissionType: input.commissionType,
      commissionValue: input.commissionValue,
      landingUrl: input.landingUrl,
      status: input.status,
    })
    return c.json({ ok: true, program }, 201)
  })

  app.patch('/program/:programId', zValidator('json', patchProgramSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new AffiliateProgramsRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('programId'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    const program = await repo.update(existing.id, c.req.valid('json'))
    return c.json({ ok: true, program: program ?? existing })
  })

  // --- affiliates ----------------------------------------------------------

  app.post('/', zValidator('json', createAffiliateSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    // An affiliate belongs to the location's program; you can't enroll one before
    // the program exists, so this is an honest 409 rather than a silent default.
    const program = await new AffiliateProgramsRepo(deps.db, loc).getPrimary()
    if (!program) {
      return c.json({ error: 'set up your referral program before adding affiliates' }, 409)
    }
    const repo = new AffiliatesRepo(deps.db, loc)
    // Derive a code from the name when none is given, and keep it unique within the
    // location so the public referral URL never resolves to the wrong affiliate.
    let code = input.code?.trim().toUpperCase() || codeify(input.name)
    if (await repo.getByCode(code)) code = `${code}-${nanoid(4).toUpperCase()}`
    const created = await repo.create({
      programId: program.id,
      name: input.name,
      email: input.email ?? null,
      code,
      contactId: input.contactId ?? null,
    })
    const affiliate = await repo.getWithStats(created.id)
    return c.json({ ok: true, affiliate: decorate(loc, affiliate!) }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const affiliate = await new AffiliatesRepo(deps.db, loc).getWithStats(id)
    if (!affiliate) return c.json({ error: 'not found' }, 404)
    const referrals = await new AffiliateReferralsRepo(deps.db, loc).listForAffiliate(id, 100)
    const clicks = await new AffiliateClicksRepo(deps.db, loc).recentForAffiliate(id, 20)
    return c.json({
      affiliate: decorate(loc, affiliate),
      referrals,
      clicks,
      summary: {
        ...summarizeReferrals(referrals),
        clicks: affiliate.clicks,
        conversionRate: conversionRate(affiliate.clicks, affiliate.referrals),
      },
    })
  })

  app.patch('/:id', zValidator('json', patchAffiliateSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new AffiliatesRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('id'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    const input = c.req.valid('json')
    // A code edit must stay unique, just like at creation.
    let code = input.code?.trim().toUpperCase()
    if (code && code !== existing.code && (await repo.getByCode(code))) {
      code = `${code}-${nanoid(4).toUpperCase()}`
    }
    await repo.update(existing.id, {
      name: input.name,
      email: input.email,
      code,
      status: input.status,
      contactId: input.contactId,
    })
    const affiliate = await repo.getWithStats(existing.id)
    return c.json({ ok: true, affiliate: decorate(loc, affiliate!) })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const repo = new AffiliatesRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('id'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    await repo.remove(existing.id)
    return c.json({ ok: true })
  })

  // --- referrals -----------------------------------------------------------

  // Record a sale an affiliate drove. The commission is computed ONCE here from the
  // program rate and stored on the row, so it is locked against later rate changes.
  app.post('/:id/referrals', zValidator('json', createReferralSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const affRepo = new AffiliatesRepo(deps.db, loc)
    const affiliate = await affRepo.get(id)
    if (!affiliate) return c.json({ error: 'not found' }, 404)
    const program = await new AffiliateProgramsRepo(deps.db, loc).get(affiliate.program_id)
    if (!program) return c.json({ error: 'program not found' }, 404)

    const input = c.req.valid('json')
    const commission = commissionCents(program, input.amountCents)
    const referral = await new AffiliateReferralsRepo(deps.db, loc).create({
      affiliateId: id,
      amountCents: input.amountCents,
      commissionCents: commission,
      description: input.description ?? null,
      contactId: input.contactId ?? null,
      occurredAt: input.occurredAt ?? undefined,
    })
    return c.json({ ok: true, referral }, 201)
  })

  app.patch('/:id/referrals/:refId', zValidator('json', setReferralStatusSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new AffiliateReferralsRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('refId'))
    if (!existing || existing.affiliate_id !== c.req.param('id')) {
      return c.json({ error: 'not found' }, 404)
    }
    const referral = await repo.setStatus(existing.id, c.req.valid('json').status)
    return c.json({ ok: true, referral: referral ?? existing })
  })

  // Record a payout: mark every APPROVED referral for this affiliate as paid and
  // stamp paid_at; pending rows stay pending until reviewed (GHL behavior).
  // BOOKKEEPING ONLY — moves no money. Reports how much was settled.
  app.post('/:id/payout', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const affiliate = await new AffiliatesRepo(deps.db, loc).get(id)
    if (!affiliate) return c.json({ error: 'not found' }, 404)
    const settled = await new AffiliateReferralsRepo(deps.db, loc).markApprovedPaid(id)
    const paidCents = settled.reduce((sum, r) => sum + Number(r.commission_cents), 0)
    return c.json({ ok: true, settledCount: settled.length, paidCents })
  })

  return app
}
