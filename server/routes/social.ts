import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { publishSocialPost } from '../lib/social/post-publish'
import { resolveSocialPublisher } from '../lib/social/resolve'
import {
  accountsByPlatform,
  connectedCount,
  statusCounts,
  upcomingQueue,
} from '../lib/social-math'
import { type SocialAccount, SocialAccountsRepo } from '../repos/social-accounts-repo'
import { type SocialPost, SocialPostsRepo } from '../repos/social-posts-repo'

// The platforms a post can target. A closed set so a typo can't create a bogus
// channel; extend it as real publishing adapters land.
const PLATFORMS = [
  'facebook',
  'instagram',
  'google_business',
  'linkedin',
  'tiktok',
  'x',
  'youtube',
] as const

const createAccountSchema = z.object({
  platform: z.enum(PLATFORMS),
  handle: z.string().min(1),
})

const patchAccountSchema = z.object({
  handle: z.string().min(1).optional(),
})

const createPostSchema = z.object({
  body: z.string().min(1),
  mediaUrl: z.string().trim().url().max(2000).nullish(),
  accountIds: z.array(z.string().min(1)).optional(),
  scheduledAt: z.string().min(1).nullish(),
})

const patchPostSchema = z.object({
  body: z.string().min(1).optional(),
  mediaUrl: z.string().trim().url().max(2000).nullish(),
  accountIds: z.array(z.string().min(1)).optional(),
  scheduledAt: z.string().min(1).nullish(),
})

const scheduleSchema = z.object({
  scheduledAt: z.string().min(1),
  accountIds: z.array(z.string().min(1)).optional(),
})

/**
 * Social Planner for the current location. Mounted behind operatorAuth +
 * locationAccess. GET / returns the whole planner in one read: the accounts, a
 * per-platform summary, every post (each resolved to the accounts it targets,
 * with each target's real publish outcome), the upcoming scheduled queue, and a
 * rollup — all DERIVED in social-math.ts from real rows, so the KPI band can
 * never overstate what exists.
 *
 *   POST   /accounts                      add an account (honestly NOT connected)
 *   PATCH  /accounts/:accountId           rename the handle
 *   POST   /accounts/:accountId/connect   verify the channel really resolves (settings + vault key)
 *   DELETE /accounts/:accountId           remove an account
 *   POST   /posts                         compose a post (draft, or scheduled if given a datetime)
 *   PATCH  /posts/:postId                 edit body / image / datetime / target accounts
 *   POST   /posts/:postId/schedule        move a post into the queue at a datetime
 *   POST   /posts/:postId/publish         REALLY publish through the location's own channels
 *   DELETE /posts/:postId                 remove a post
 *
 * Two honesty rules govern this surface. (1) `connected` is never claimed:
 * connect re-verifies that the channel's settings + vault key actually build a
 * working publisher, flips the flag accordingly, and downgrades a stale green.
 * (2) Publish goes through the LOCATION's own adapters (publishSocialPost) and
 * the post is marked published only when at least one channel REALLY accepted
 * it; zero deliveries answer 409 with the reasons and the post stays put. Each
 * target records its true outcome, and NO reach or engagement is ever invented.
 */
export function socialRoute(deps: {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolver. */
  resolvePublisher?: typeof resolveSocialPublisher
  throttleMs?: number
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const resolvePublisher = deps.resolvePublisher ?? resolveSocialPublisher

  /** Attach each post's target accounts (resolved to platform + handle) so the UI
   *  can show which channels a post fans out to. */
  async function withTargets(loc: string, posts: SocialPost[], accountsById: Map<string, SocialAccount>) {
    const postsRepo = new SocialPostsRepo(deps.db, loc)
    const out = []
    for (const post of posts) {
      const targets = await postsRepo.listTargets(post.id)
      out.push({
        ...post,
        targets: targets.map((t) => {
          const acc = accountsById.get(t.account_id)
          return {
            accountId: t.account_id,
            platform: acc?.platform ?? null,
            handle: acc?.handle ?? null,
            status: t.status,
            detail: t.detail,
            externalId: t.external_id,
          }
        }),
      })
    }
    return out
  }

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const accounts = await new SocialAccountsRepo(deps.db, loc).list()
    const accountsById = new Map(accounts.map((a) => [a.id, a]))
    const postRows = await new SocialPostsRepo(deps.db, loc).list()
    const posts = await withTargets(loc, postRows, accountsById)
    const now = new Date().toISOString()
    return c.json({
      accounts,
      platforms: accountsByPlatform(accounts),
      posts,
      queue: upcomingQueue(posts, now),
      rollup: {
        ...statusCounts(postRows),
        accounts: accounts.length,
        connected: connectedCount(accounts),
      },
    })
  })

  // --- accounts ------------------------------------------------------------

  app.post('/accounts', zValidator('json', createAccountSchema), async (c) => {
    const loc = c.get('locationId')
    const account = await new SocialAccountsRepo(deps.db, loc).create(c.req.valid('json'))
    return c.json({ ok: true, account }, 201)
  })

  app.patch('/accounts/:accountId', zValidator('json', patchAccountSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new SocialAccountsRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('accountId'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    const account = await repo.update(existing.id, c.req.valid('json'))
    return c.json({ ok: true, account: account ?? existing })
  })

  // Honest connect: verify the channel REALLY resolves — its non-secret ids in
  // Settings > Social plus the location's own token in the vault must build a
  // working publisher. The flag follows the truth in both directions: a passing
  // check flips it on, a failing re-check downgrades a stale green.
  app.post('/accounts/:accountId/connect', async (c) => {
    const loc = c.get('locationId')
    const repo = new SocialAccountsRepo(deps.db, loc)
    const account = await repo.get(c.req.param('accountId'))
    if (!account) return c.json({ error: 'not found' }, 404)

    const resolved = await resolvePublisher(deps.db, loc, account.platform)
    if (resolved.ok) {
      const updated = await repo.setConnected(account.id, true)
      return c.json({ ok: true, account: updated ?? { ...account, connected: true } })
    }
    if (account.connected) await repo.setConnected(account.id, false)
    return c.json({
      ok: false,
      reason: resolved.reason,
      message: `Not connected yet: ${resolved.reason}. Add the channel ids under Settings > Social and the access key in the vault, then connect again.`,
      account: { ...account, connected: false },
    })
  })

  app.delete('/accounts/:accountId', async (c) => {
    const loc = c.get('locationId')
    const repo = new SocialAccountsRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('accountId'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    await repo.remove(existing.id)
    return c.json({ ok: true })
  })

  // --- posts ---------------------------------------------------------------

  app.post('/posts', zValidator('json', createPostSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    // A datetime at compose time drops the post straight into the scheduled
    // queue; otherwise it's an honest draft until the operator schedules it.
    const status = input.scheduledAt ? 'scheduled' : 'draft'
    const post = await new SocialPostsRepo(deps.db, loc).create({
      body: input.body,
      mediaUrl: input.mediaUrl ?? null,
      status,
      scheduledAt: input.scheduledAt ?? null,
      accountIds: input.accountIds,
    })
    return c.json({ ok: true, post }, 201)
  })

  app.patch('/posts/:postId', zValidator('json', patchPostSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new SocialPostsRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('postId'))
    if (!existing) return c.json({ error: 'not found' }, 404)

    const input = c.req.valid('json')
    if (input.accountIds !== undefined) await repo.replaceTargets(existing.id, input.accountIds)
    let post = existing
    if (input.body !== undefined || input.mediaUrl !== undefined || input.scheduledAt !== undefined) {
      post =
        (await repo.update(existing.id, {
          body: input.body,
          mediaUrl: input.mediaUrl,
          scheduledAt: input.scheduledAt,
        })) ?? existing
    }
    return c.json({ ok: true, post })
  })

  app.post('/posts/:postId/schedule', zValidator('json', scheduleSchema), async (c) => {
    const loc = c.get('locationId')
    const repo = new SocialPostsRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('postId'))
    if (!existing) return c.json({ error: 'not found' }, 404)

    const input = c.req.valid('json')
    if (input.accountIds !== undefined) await repo.replaceTargets(existing.id, input.accountIds)
    const post = await repo.schedule(existing.id, input.scheduledAt)
    return c.json({ ok: true, post: post ?? existing })
  })

  // Honest publish: the post REALLY goes out through the location's own channel
  // adapters. Only when at least one channel accepted it does the post flip to
  // published — zero deliveries answer 409 with the reasons and the post stays
  // in its prior status. Each target records its true per-channel outcome.
  app.post('/posts/:postId/publish', async (c) => {
    const loc = c.get('locationId')
    const repo = new SocialPostsRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('postId'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    if (existing.status === 'published') return c.json({ error: 'post already published' }, 409)

    const targets = await repo.listTargets(existing.id)
    const accounts = await new SocialAccountsRepo(deps.db, loc).list()
    const accountsById = new Map(accounts.map((a) => [a.id, a]))
    const result = await publishSocialPost(
      { db: deps.db, resolvePublisher: deps.resolvePublisher, throttleMs: deps.throttleMs },
      {
        locationId: loc,
        post: { body: existing.body, mediaUrl: existing.media_url ?? undefined },
        // Targets are location-scoped and FK-cascade with accounts, so every
        // account resolves; the fallback only keeps the engine's honest-failure
        // path total instead of crashing on an impossible miss.
        targets: targets.map((t) => ({
          accountId: t.account_id,
          platform: accountsById.get(t.account_id)?.platform ?? 'unknown',
        })),
      },
    )
    if (!result.ok) return c.json({ error: result.reason }, 409)

    await repo.recordTargetOutcomes(existing.id, result.outcomes)
    const post = await repo.publish(existing.id, new Date().toISOString())
    return c.json({
      ok: true,
      post: post ?? existing,
      delivery: {
        published: result.publishedCount,
        failed: result.outcomes.length - result.publishedCount,
      },
      outcomes: result.outcomes,
    })
  })

  app.delete('/posts/:postId', async (c) => {
    const loc = c.get('locationId')
    const repo = new SocialPostsRepo(deps.db, loc)
    const existing = await repo.get(c.req.param('postId'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    await repo.remove(existing.id)
    return c.json({ ok: true })
  })

  return app
}
