import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { CommunitiesRepo } from '../repos/communities-repo'
import { CommunityChannelsRepo } from '../repos/community-channels-repo'
import { CommunityCommentsRepo } from '../repos/community-comments-repo'
import { CommunityMembersRepo } from '../repos/community-members-repo'
import { CommunityPostLikesRepo } from '../repos/community-post-likes-repo'
import { CommunityPostsRepo } from '../repos/community-posts-repo'
import { publicCommunitiesRoute } from './public-communities'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A published community with two channels, two members, two posts (one pinned),
// real comments and real likes — so a single GET proves the read-only public feed
// derives every count from rows that actually exist.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Alex Fitness','Alex')", [loc])

  const community = await new CommunitiesRepo(db, loc).create({
    name: 'Inner Circle',
    slug: 'inner-circle',
    description: 'A members-only space.',
    status: 'published',
  })

  const channelsRepo = new CommunityChannelsRepo(db, loc)
  const general = await channelsRepo.create({ communityId: community.id, name: 'General', slug: 'general', position: 0 })
  const wins = await channelsRepo.create({ communityId: community.id, name: 'Wins', slug: 'wins', position: 1 })

  const membersRepo = new CommunityMembersRepo(db, loc)
  const Alex = await membersRepo.create({ communityId: community.id, name: 'Coach Alex', role: 'admin' })
  const dana = await membersRepo.create({ communityId: community.id, name: 'Dana Reed' })

  const postsRepo = new CommunityPostsRepo(db, loc)
  const pinned = await postsRepo.create({
    communityId: community.id,
    channelId: wins.id,
    memberId: dana.id,
    title: 'Hit my goal!',
    body: 'Down 10 pounds this month.\n\nThanks coach.',
    pinned: true,
  })
  const general1 = await postsRepo.create({
    communityId: community.id,
    channelId: general.id,
    memberId: Alex.id,
    title: 'Welcome',
    body: 'Glad you are all here.',
  })

  // Real engagement on the pinned post: two likes, one comment.
  const likesRepo = new CommunityPostLikesRepo(db, loc)
  await likesRepo.add(pinned.id, Alex.id)
  await likesRepo.add(pinned.id, dana.id)
  await new CommunityCommentsRepo(db, loc).create({
    postId: pinned.id,
    memberId: Alex.id,
    body: 'Proud of you!',
  })

  const app = new Hono<AppEnv>()
  app.route('/', publicCommunitiesRoute({ db }))
  return { db, loc, app, community, general, wins, Alex, dana, pinned, general1 }
}

test('GET /:loc/:slug renders the published feed with derived counts and channels', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/inner-circle')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const html = await res.text()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('Inner Circle')
  expect(html).toContain('2 members') // derived from real member rows
  expect(html).toContain('2 posts') // derived from real post rows
  expect(html).toContain('General')
  expect(html).toContain('Wins')
  // pinned post leads with its real engagement counts
  expect(html).toContain('Hit my goal!')
  expect(html).toContain('Pinned')
  expect(html).toContain('2 likes')
  expect(html).toContain('1 comment')
})

test('GET /:loc/:slug orders pinned post before the newer unpinned post', async () => {
  const { app } = await setup()
  const html = await (await app.request('/loc_test/inner-circle')).text()
  expect(html.indexOf('Hit my goal!')).toBeLessThan(html.indexOf('Welcome'))
})

test('GET /:loc/:slug is a styled html 404 for an unknown slug', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/nope')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('text/html')
  expect((await res.text()).toLowerCase()).toContain('not available')
})

test('GET /:loc/:slug is 404 for a draft community (never published)', async () => {
  const { app, db } = await setup()
  await db.query("UPDATE communities SET status='draft' WHERE slug='inner-circle'")
  const res = await app.request('/loc_test/inner-circle')
  expect(res.status).toBe(404)
})

test('GET /:loc/:slug/c/:channelSlug filters the feed to one channel', async () => {
  const { app } = await setup()
  const html = await (await app.request('/loc_test/inner-circle/c/wins')).text()
  // Wins-only feed shows the pinned post but not the General post
  expect(html).toContain('Hit my goal!')
  expect(html).not.toContain('Glad you are all here')
})

test('GET /:loc/:slug/c/:channelSlug is 404 for a channel not in the community', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/inner-circle/c/does-not-exist')
  expect(res.status).toBe(404)
})

test('GET /:loc/:slug/p/:postId renders the post with its comment thread', async () => {
  const { app, pinned } = await setup()
  const res = await app.request(`/loc_test/inner-circle/p/${pinned.id}`)

  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain('Hit my goal!')
  expect(html).toContain('Down 10 pounds this month.')
  expect(html).toContain('Thanks coach.') // second paragraph
  expect(html).toContain('Coach Alex') // comment author
  expect(html).toContain('Proud of you!') // comment body
  expect(html).toContain('1 comment')
  expect(html).toContain('2 likes')
})

test('GET /:loc/:slug/p/:postId is 404 for a post in another community', async () => {
  const { app, db, loc, pinned } = await setup()
  // A second published community must not expose the first community's post.
  const other = await new CommunitiesRepo(db, loc).create({
    name: 'Other',
    slug: 'other',
    status: 'published',
  })
  const res = await app.request(`/loc_test/other/p/${pinned.id}`)
  expect(res.status).toBe(404)
  expect(other.id).not.toBe('')
})

test('GET /:loc/:slug/p/:postId is 404 for an unknown post id', async () => {
  const { app } = await setup()
  const res = await app.request('/loc_test/inner-circle/p/nope')
  expect(res.status).toBe(404)
})

