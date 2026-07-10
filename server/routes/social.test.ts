import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import type { ResolvedSocialPublisher } from '../lib/social/resolve'
import { socialRoute } from './social'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

type ResolveFn = (db: unknown, locationId: string, platform: string) => Promise<ResolvedSocialPublisher>

// A real location behind a middleware that sets the operator context the way
// operatorAuth + locationAccess do in production. Every assertion runs against
// real Postgres (pglite) so the derived rollups, the upcoming-queue filter, the
// target fan-out and the cascade are exercised, not mocked. Publishing is
// exercised through the REAL engine; only the per-platform resolver (settings +
// vault + network adapter) is injectable.
async function setup(opts?: { resolvePublisher?: ResolveFn }) {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query('INSERT INTO locations (id, name, slug, branding) VALUES ($1,$2,$3,$4)', [
    loc,
    'Alex — Cash Offers',
    'Alex',
    { color: '#4f46e5' },
  ])

  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', loc)
    await next()
  })
  app.route('/', socialRoute({ db, resolvePublisher: opts?.resolvePublisher, throttleMs: 0 }))
  return { db, loc, app }
}

/** A working fake channel: records what it was asked to post and returns a live id. */
function workingChannel(platform: string, externalId: string, calls?: Array<{ text: string; mediaUrl?: string }>) {
  return {
    ok: true as const,
    publisher: {
      platform,
      publish: async (msg: { text: string; mediaUrl?: string }) => {
        calls?.push(msg)
        return { externalId, platform }
      },
    },
  }
}

function resolverFor(byPlatform: Record<string, ResolvedSocialPublisher>): ResolveFn {
  return async (_db, _loc, platform) =>
    byPlatform[platform] ?? { ok: false, reason: `publishing to ${platform} is not supported yet` }
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function createAccount(app: Hono<AppEnv>, body: Record<string, unknown>) {
  const res = await jsonReq(app, '/accounts', 'POST', body)
  return (await res.json()) as { account: { id: string; platform: string; handle: string; connected: boolean } }
}

async function createPost(app: Hono<AppEnv>, body: Record<string, unknown>) {
  const res = await jsonReq(app, '/posts', 'POST', body)
  return (await res.json()) as {
    post: { id: string; status: string; media_url: string | null; scheduled_at: string | null; published_at: string | null }
  }
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

test('POST /accounts adds an account that is honestly NOT connected', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/accounts', 'POST', { platform: 'facebook', handle: 'Acme Home Buyers' })
  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({
    ok: true,
    account: { platform: 'facebook', handle: 'Acme Home Buyers', connected: false },
  })
})

test('POST /accounts/:id/connect verifies for real — an unconfigured channel stays honestly unconnected', async () => {
  const { app } = await setup() // the REAL resolver: nothing configured for this location
  const { account } = await createAccount(app, { platform: 'instagram', handle: '@acmehomebuyers' })

  const res = await jsonReq(app, `/accounts/${account.id}/connect`, 'POST')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; reason: string; account: { connected: boolean } }
  expect(body.ok).toBe(false)
  expect(body.reason).toBe('instagram account id is not configured')
  expect(body.account.connected).toBe(false) // still not connected — no fabricated link

  // and the connected KPI stays an honest zero
  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as { rollup: { connected: number } }
  expect(planner.rollup.connected).toBe(0)
})

test('POST /accounts/:id/connect flips connected when the channel resolves, and back off when it stops', async () => {
  let resolution: ResolvedSocialPublisher = workingChannel('facebook', 'fb_live')
  const { app } = await setup({ resolvePublisher: async () => resolution })
  const { account } = await createAccount(app, { platform: 'facebook', handle: 'Acme Home Buyers' })

  const connect = await jsonReq(app, `/accounts/${account.id}/connect`, 'POST')
  expect(await connect.json()).toMatchObject({ ok: true, account: { connected: true } })
  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as { rollup: { connected: number } }
  expect(planner.rollup.connected).toBe(1)

  // The page token was removed from the vault — re-verifying must not leave a
  // stale green "connected".
  resolution = { ok: false, reason: 'facebook page token is not configured' }
  const again = await jsonReq(app, `/accounts/${account.id}/connect`, 'POST')
  expect(await again.json()).toMatchObject({
    ok: false,
    reason: 'facebook page token is not configured',
    account: { connected: false },
  })
  const after = (await (await jsonReq(app, '/', 'GET')).json()) as { rollup: { connected: number } }
  expect(after.rollup.connected).toBe(0)
})

test('POST /accounts/:id/connect is 404 for an unknown account', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/accounts/nope/connect', 'POST')).status).toBe(404)
})

test('POST /posts with no datetime is an honest draft; with a datetime it is scheduled', async () => {
  const { app } = await setup()
  const draft = await createPost(app, { body: 'Neighborhood spotlight — need photos' })
  expect(draft.post.status).toBe('draft')
  expect(draft.post.scheduled_at).toBeNull()

  const scheduled = await createPost(app, { body: 'Free home-value check this week', scheduledAt: inDays(7) })
  expect(scheduled.post.status).toBe('scheduled')
  expect(scheduled.post.scheduled_at).not.toBeNull()
})

test('GET / resolves each post to the accounts it targets', async () => {
  const { app } = await setup()
  const fb = await createAccount(app, { platform: 'facebook', handle: 'Acme Home Buyers' })
  const ig = await createAccount(app, { platform: 'instagram', handle: '@acmehomebuyers' })
  await createPost(app, { body: 'Closed in 9 days', accountIds: [fb.account.id, ig.account.id] })

  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as {
    posts: { body: string; targets: { platform: string | null; handle: string | null }[] }[]
  }
  const post = planner.posts.find((p) => p.body === 'Closed in 9 days')
  expect(post?.targets.map((t) => t.platform).sort()).toEqual(['facebook', 'instagram'])
  expect(post?.targets.map((t) => t.handle)).toContain('@acmehomebuyers')
})

test('GET / never fans a post out to another location account (foreign target dropped)', async () => {
  const { app, db } = await setup()
  // A second tenant with its own connected account. Its id satisfies the
  // social_post_targets FK, so nothing but a location-scoped ownership check
  // stops a post here from fanning out to it.
  await db.query('INSERT INTO locations (id, name, slug, branding) VALUES ($1,$2,$3,$4)', [
    'loc_other',
    'Other Co',
    'other',
    { color: '#000000' },
  ])
  await db.query(
    'INSERT INTO social_accounts (id, location_id, platform, handle, connected) VALUES ($1,$2,$3,$4,$5)',
    ['sa_foreign', 'loc_other', 'facebook', 'Not Yours', false],
  )

  // Compose a post in loc_test that tries to target the foreign account.
  await createPost(app, { body: 'cross-tenant attempt', accountIds: ['sa_foreign'] })

  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as {
    posts: { body: string; targets: { platform: string | null }[] }[]
  }
  const post = planner.posts.find((p) => p.body === 'cross-tenant attempt')
  expect(post).toBeDefined()
  expect(post?.targets).toEqual([]) // foreign account filtered out — zero fan-out, not a phantom target
})

test('GET / rollup is DERIVED from real rows (honest status counts + zero connected)', async () => {
  const { app } = await setup({ resolvePublisher: resolverFor({ facebook: workingChannel('facebook', 'fb_1') }) })
  const fb = await createAccount(app, { platform: 'facebook', handle: 'Acme Home Buyers' })
  await createPost(app, { body: 'a draft' })
  await createPost(app, { body: 'a scheduled', scheduledAt: inDays(5) })
  const pub = await createPost(app, { body: 'to publish', accountIds: [fb.account.id] })
  await jsonReq(app, `/posts/${pub.post.id}/publish`, 'POST')

  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as {
    rollup: { draft: number; scheduled: number; published: number; total: number; accounts: number; connected: number }
  }
  expect(planner.rollup).toEqual({
    draft: 1,
    scheduled: 1,
    published: 1,
    total: 3,
    accounts: 1,
    connected: 0,
  })
})

test('GET / queue holds only future scheduled posts, soonest first (drafts/published/past excluded)', async () => {
  const { app } = await setup()
  await createPost(app, { body: 'just a draft' })
  await createPost(app, { body: 'far', scheduledAt: inDays(14) })
  await createPost(app, { body: 'soon', scheduledAt: inDays(3) })
  const past = await createPost(app, { body: 'past slot', scheduledAt: inDays(-3) })
  expect(past.post.status).toBe('scheduled') // scheduled, but in the past

  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as { queue: { body: string }[] }
  expect(planner.queue.map((p) => p.body)).toEqual(['soon', 'far'])
})

test('POST /posts/:id/schedule moves a draft into the queue at a datetime', async () => {
  const { app } = await setup()
  const draft = await createPost(app, { body: 'plan me' })
  const res = await jsonReq(app, `/posts/${draft.post.id}/schedule`, 'POST', { scheduledAt: inDays(10) })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, post: { status: 'scheduled' } })
})

test('POST /posts/:id/publish with no channels 409s and the post stays a draft', async () => {
  const { app } = await setup()
  const post = await createPost(app, { body: 'ship it' })

  const res = await jsonReq(app, `/posts/${post.post.id}/publish`, 'POST')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({
    error: 'no channels selected — add at least one channel to this post',
  })
  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as { rollup: { draft: number; published: number } }
  expect(planner.rollup).toMatchObject({ draft: 1, published: 0 })
})

test('POST /posts/:id/publish refuses when no channel is configured — honest reason, status unchanged', async () => {
  const { app } = await setup() // real resolver, nothing configured
  const fb = await createAccount(app, { platform: 'facebook', handle: 'Acme Home Buyers' })
  const post = await createPost(app, { body: 'ship it', accountIds: [fb.account.id] })

  const res = await jsonReq(app, `/posts/${post.post.id}/publish`, 'POST')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'facebook page id is not configured' })
})

test('POST /posts/:id/publish REALLY publishes through the channels and records per-target outcomes', async () => {
  const fbCalls: Array<{ text: string; mediaUrl?: string }> = []
  const igFailure = {
    ok: true as const,
    publisher: {
      platform: 'instagram',
      publish: async () => {
        throw new Error('instagram needs an image — add an image URL to this post')
      },
    },
  }
  const { app } = await setup({
    resolvePublisher: resolverFor({
      facebook: workingChannel('facebook', 'fb_live_1', fbCalls),
      instagram: igFailure,
    }),
  })
  const fb = await createAccount(app, { platform: 'facebook', handle: 'Acme Home Buyers' })
  const ig = await createAccount(app, { platform: 'instagram', handle: '@acmehomebuyers' })
  const post = await createPost(app, { body: 'ship it', accountIds: [fb.account.id, ig.account.id] })

  const res = await jsonReq(app, `/posts/${post.post.id}/publish`, 'POST')
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    ok: boolean
    post: { status: string; published_at: string | null }
    delivery: { published: number; failed: number }
  }
  expect(body.ok).toBe(true)
  expect(body.post.status).toBe('published')
  expect(body.post.published_at).not.toBeNull()
  expect(body.delivery).toEqual({ published: 1, failed: 1 })
  expect(fbCalls).toEqual([{ text: 'ship it', mediaUrl: undefined }])

  // The per-channel truth is persisted and readable on the planner.
  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as {
    posts: {
      body: string
      targets: { accountId: string; status: string | null; detail: string | null; externalId: string | null }[]
    }[]
  }
  const published = planner.posts.find((p) => p.body === 'ship it')
  const byAccount = new Map(published?.targets.map((t) => [t.accountId, t]))
  expect(byAccount.get(fb.account.id)).toMatchObject({ status: 'published', detail: null, externalId: 'fb_live_1' })
  expect(byAccount.get(ig.account.id)).toMatchObject({
    status: 'failed',
    detail: 'instagram needs an image — add an image URL to this post',
    externalId: null,
  })

  // idempotent guard — you can't publish the same post twice
  expect((await jsonReq(app, `/posts/${post.post.id}/publish`, 'POST')).status).toBe(409)
})

test('the attached image rides along to the channel adapters', async () => {
  const fbCalls: Array<{ text: string; mediaUrl?: string }> = []
  const { app } = await setup({
    resolvePublisher: resolverFor({ facebook: workingChannel('facebook', 'fb_pic', fbCalls) }),
  })
  const fb = await createAccount(app, { platform: 'facebook', handle: 'Acme Home Buyers' })
  const post = await createPost(app, {
    body: 'Open house Saturday',
    mediaUrl: 'https://img.example/open-house.jpg',
    accountIds: [fb.account.id],
  })

  expect((await jsonReq(app, `/posts/${post.post.id}/publish`, 'POST')).status).toBe(200)
  expect(fbCalls).toEqual([{ text: 'Open house Saturday', mediaUrl: 'https://img.example/open-house.jpg' }])
})

test('POST /posts stores an attached image url, PATCH can clear it, junk urls are rejected', async () => {
  const { app } = await setup()
  const created = await createPost(app, { body: 'pic day', mediaUrl: 'https://img.example/a.jpg' })
  expect(created.post.media_url).toBe('https://img.example/a.jpg')

  const cleared = await jsonReq(app, `/posts/${created.post.id}`, 'PATCH', { mediaUrl: null })
  expect(((await cleared.json()) as { post: { media_url: string | null } }).post.media_url).toBeNull()

  expect((await jsonReq(app, '/posts', 'POST', { body: 'x', mediaUrl: 'not-a-url' })).status).toBe(400)
})

test('PATCH /posts/:id edits the body and replaces the target accounts', async () => {
  const { app } = await setup()
  const fb = await createAccount(app, { platform: 'facebook', handle: 'Acme Home Buyers' })
  const ig = await createAccount(app, { platform: 'instagram', handle: '@acmehomebuyers' })
  const post = await createPost(app, { body: 'first cut', accountIds: [fb.account.id] })

  const res = await jsonReq(app, `/posts/${post.post.id}`, 'PATCH', {
    body: 'final cut',
    accountIds: [ig.account.id],
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, post: { body: 'final cut' } })

  const planner = (await (await jsonReq(app, '/', 'GET')).json()) as {
    posts: { body: string; targets: { platform: string | null }[] }[]
  }
  const edited = planner.posts.find((p) => p.body === 'final cut')
  expect(edited?.targets.map((t) => t.platform)).toEqual(['instagram']) // wholesale replace
})

test('DELETE /posts/:id removes the post and cascades its targets', async () => {
  const { app, db, loc } = await setup()
  const fb = await createAccount(app, { platform: 'facebook', handle: 'Acme Home Buyers' })
  const post = await createPost(app, { body: 'temp', accountIds: [fb.account.id] })

  expect((await jsonReq(app, `/posts/${post.post.id}`, 'DELETE')).status).toBe(200)
  const targets = await db.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM social_post_targets WHERE post_id=$1',
    [post.post.id],
  )
  expect(targets[0]?.n).toBe(0)
})

test('unknown post and account ids 404 on their actions', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/posts/nope/schedule', 'POST', { scheduledAt: inDays(2) })).status).toBe(404)
  expect((await jsonReq(app, '/posts/nope/publish', 'POST')).status).toBe(404)
  expect((await jsonReq(app, '/posts/nope', 'DELETE')).status).toBe(404)
  expect((await jsonReq(app, '/accounts/nope', 'PATCH', { handle: 'x' })).status).toBe(404)
})

