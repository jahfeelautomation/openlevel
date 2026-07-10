import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { PgliteDatabase } from '../db/pglite-database'
import { ContactsRepo } from '../repos/contacts-repo'
import { CommunityPostLikesRepo } from '../repos/community-post-likes-repo'
import { communitiesRoute } from './communities'

const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

// A real location + a real contact, behind a middleware that sets the operator
// context the way operatorAuth + locationAccess do in production. Every assertion
// runs against real Postgres (pglite) so the derived rollups, the unique-slug
// index, the cross-parent guards, and the cascade are all exercised, not mocked.
async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  await db.query('INSERT INTO locations (id, name, slug, branding) VALUES ($1,$2,$3,$4)', [
    loc,
    'Jamal — Cash Offers',
    'jamal',
    { color: '#4f46e5' },
  ])
  const contact = await new ContactsRepo(db, loc).upsertByMatch(
    { name: 'Marcus Webb', phone: '+16785550142' },
    'seed',
  )

  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', loc)
    await next()
  })
  app.route('/', communitiesRoute({ db }))
  return { db, loc, app, contactId: contact.id }
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function createCommunity(app: Hono<AppEnv>, body: Record<string, unknown>) {
  const res = await jsonReq(app, '/', 'POST', body)
  return (await res.json()) as {
    community: { id: string; slug: string; status: string; rollup: { members: number; posts: number; channelCount: number; topChannel: string | null } }
  }
}

async function addChannel(app: Hono<AppEnv>, communityId: string, body: Record<string, unknown>) {
  const res = await jsonReq(app, `/${communityId}/channels`, 'POST', body)
  return (await res.json()) as { channel: { id: string; slug: string; position: number; name: string; postCount: number } }
}

async function addMember(app: Hono<AppEnv>, communityId: string, body: Record<string, unknown>) {
  const res = await jsonReq(app, `/${communityId}/members`, 'POST', body)
  return (await res.json()) as { member: { id: string; name: string; role: string } }
}

async function addPost(app: Hono<AppEnv>, communityId: string, body: Record<string, unknown>) {
  const res = await jsonReq(app, `/${communityId}/posts`, 'POST', body)
  return (await res.json()) as { post: { id: string; title: string | null; pinned: boolean; channel_id: string } }
}

test('POST / creates a draft community and derives a slug from the name', async () => {
  const { app } = await setup()
  const res = await jsonReq(app, '/', 'POST', { name: 'Inner Circle' })

  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    ok: boolean
    community: { slug: string; status: string; rollup: { members: number; posts: number; channelCount: number; topChannel: string | null } }
  }
  expect(body.ok).toBe(true)
  expect(body.community.slug).toBe('inner-circle')
  expect(body.community.status).toBe('draft') // unpublished until the operator says so
  expect(body.community.rollup).toEqual({ members: 0, posts: 0, channelCount: 0, topChannel: null })
})

test('POST / keeps slugs unique within the location', async () => {
  const { app } = await setup()
  const a = await createCommunity(app, { name: 'Inner Circle' })
  const b = await createCommunity(app, { name: 'Inner Circle' })
  expect(a.community.slug).toBe('inner-circle')
  expect(b.community.slug).not.toBe(a.community.slug) // a suffix keeps the public URL collision-free
  expect(b.community.slug.startsWith('inner-circle-')).toBe(true)
})

test('GET / lists communities with a derived rollup and an honest zero', async () => {
  const { app } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle', status: 'published' })
  const general = await addChannel(app, community.id, { name: 'General' })
  await addMember(app, community.id, { name: 'Coach Jamal', role: 'admin' })
  await addPost(app, community.id, { channelId: general.channel.id, body: 'Welcome everyone.' })

  const res = await jsonReq(app, '/', 'GET')
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    communities: { id: string; rollup: { members: number; posts: number; channelCount: number; topChannel: string | null } }[]
  }
  const row = body.communities.find((x) => x.id === community.id)
  expect(row?.rollup.members).toBe(1) // one real member row
  expect(row?.rollup.posts).toBe(1) // one real post row
  expect(row?.rollup.channelCount).toBe(1)
  expect(row?.rollup.topChannel).toBe('General') // the only channel with a post
})

test('GET /:id returns the community, channels with post counts, members, posts with engagement, and a public link', async () => {
  const { app, db, loc } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle', status: 'published' })
  const general = await addChannel(app, community.id, { name: 'General', position: 0 })
  const wins = await addChannel(app, community.id, { name: 'Wins', position: 1 })
  const jamal = await addMember(app, community.id, { name: 'Coach Jamal', role: 'admin' })
  const dana = await addMember(app, community.id, { name: 'Dana Reed' })
  const pinned = await addPost(app, community.id, {
    channelId: wins.channel.id,
    memberId: dana.member.id,
    title: 'Hit my goal!',
    body: 'Down 10 pounds.',
    pinned: true,
  })
  await addPost(app, community.id, { channelId: general.channel.id, memberId: jamal.member.id, body: 'Welcome.' })
  // Real engagement on the pinned post: two likes, one comment.
  const likes = new CommunityPostLikesRepo(db, loc)
  await likes.add(pinned.post.id, jamal.member.id)
  await likes.add(pinned.post.id, dana.member.id)
  await jsonReq(app, `/${community.id}/posts/${pinned.post.id}/comments`, 'POST', {
    memberId: jamal.member.id,
    body: 'Proud of you!',
  })

  const res = await jsonReq(app, `/${community.id}`, 'GET')
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    community: { id: string; slug: string }
    channels: { name: string; postCount: number }[]
    members: { name: string }[]
    posts: {
      id: string
      title: string | null
      pinned: boolean
      channelName: string | null
      authorName: string | null
      likes: number
      comments: number
      commentThread: { body: string; authorName: string | null }[]
    }[]
    rollup: { members: number; posts: number; channelCount: number; topChannel: string | null }
    publicUrl: string
  }
  expect(body.community.id).toBe(community.id)
  expect(body.channels.map((ch) => ch.name)).toEqual(['General', 'Wins'])
  expect(body.channels.find((ch) => ch.name === 'Wins')?.postCount).toBe(1)
  expect(body.members.map((m) => m.name)).toContain('Coach Jamal')
  // pinned post leads, carries its real engagement + the comment thread
  expect(body.posts[0]?.title).toBe('Hit my goal!')
  expect(body.posts[0]?.pinned).toBe(true)
  expect(body.posts[0]?.channelName).toBe('Wins')
  expect(body.posts[0]?.authorName).toBe('Dana Reed')
  expect(body.posts[0]?.likes).toBe(2)
  expect(body.posts[0]?.comments).toBe(1)
  expect(body.posts[0]?.commentThread[0]?.body).toBe('Proud of you!')
  expect(body.posts[0]?.commentThread[0]?.authorName).toBe('Coach Jamal')
  // General and Wins each hold one post, so the most-active channel ties — the
  // rollup honestly breaks the tie to the first by position (General).
  expect(body.rollup).toEqual({ members: 2, posts: 2, channelCount: 2, topChannel: 'General' })
  expect(body.publicUrl).toBe(`/api/public/communities/${loc}/${body.community.slug}`)
})

test('GET /:id is 404 for an unknown community', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/nope', 'GET')).status).toBe(404)
})

test('PATCH /:id publishes a community', async () => {
  const { app } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle' })
  const res = await jsonReq(app, `/${community.id}`, 'PATCH', { status: 'published' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, community: { status: 'published' } })
})

test('PATCH /:id is 404 for an unknown community', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/nope', 'PATCH', { name: 'x' })).status).toBe(404)
})

test('DELETE /:id removes the community and cascades channels, members, posts, comments, likes', async () => {
  const { app, db, loc } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle', status: 'published' })
  const general = await addChannel(app, community.id, { name: 'General' })
  const jamal = await addMember(app, community.id, { name: 'Coach Jamal' })
  const post = await addPost(app, community.id, { channelId: general.channel.id, memberId: jamal.member.id, body: 'Hi.' })
  await new CommunityPostLikesRepo(db, loc).add(post.post.id, jamal.member.id)
  await jsonReq(app, `/${community.id}/posts/${post.post.id}/comments`, 'POST', { body: 'Nice.' })

  const res = await jsonReq(app, `/${community.id}`, 'DELETE')
  expect(res.status).toBe(200)
  expect((await jsonReq(app, `/${community.id}`, 'GET')).status).toBe(404)

  // Deleting the community cascades through every table under it. Each carries a
  // location_id, so an honest zero for this location proves nothing was orphaned.
  for (const table of [
    'community_channels',
    'community_members',
    'community_posts',
    'community_comments',
    'community_post_likes',
  ]) {
    const byLoc = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE location_id=$1`, [loc])
    expect(byLoc[0]?.n).toBe(0)
  }
})

test('POST /:id/channels appends at the end (position = current channel count) and keeps channel slugs unique', async () => {
  const { app } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle' })
  const a = await addChannel(app, community.id, { name: 'General' })
  const b = await addChannel(app, community.id, { name: 'General' }) // same name → unique slug
  expect(a.channel.position).toBe(0)
  expect(b.channel.position).toBe(1)
  expect(b.channel.slug).not.toBe(a.channel.slug)
})

test('POST /:id/channels is 404 for an unknown community', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/nope/channels', 'POST', { name: 'General' })).status).toBe(404)
})

test('PATCH /:id/channels/:channelId reorders; a cross-community edit 404s', async () => {
  const { app } = await setup()
  const one = await createCommunity(app, { name: 'One' })
  const two = await createCommunity(app, { name: 'Two' })
  const ch = await addChannel(app, one.community.id, { name: 'General' })

  // wrong community → 404
  expect((await jsonReq(app, `/${two.community.id}/channels/${ch.channel.id}`, 'PATCH', { position: 3 })).status).toBe(404)
  // right community → reorders
  const res = await jsonReq(app, `/${one.community.id}/channels/${ch.channel.id}`, 'PATCH', { position: 3, name: 'Announcements' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, channel: { position: 3, name: 'Announcements' } })
})

test('DELETE /:id/channels/:channelId removes a channel; cross-community delete 404s', async () => {
  const { app } = await setup()
  const one = await createCommunity(app, { name: 'One' })
  const two = await createCommunity(app, { name: 'Two' })
  const ch = await addChannel(app, one.community.id, { name: 'General' })

  expect((await jsonReq(app, `/${two.community.id}/channels/${ch.channel.id}`, 'DELETE')).status).toBe(404)
  expect((await jsonReq(app, `/${one.community.id}/channels/${ch.channel.id}`, 'DELETE')).status).toBe(200)
})

test('POST /:id/members adds a member defaulting to the member role', async () => {
  const { app, contactId } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle' })
  const res = await jsonReq(app, `/${community.id}/members`, 'POST', { name: 'Dana Reed', contactId })
  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ ok: true, member: { name: 'Dana Reed', role: 'member', contact_id: contactId } })
})

test('PATCH /:id/members/:memberId edits a role; a cross-community edit 404s', async () => {
  const { app } = await setup()
  const one = await createCommunity(app, { name: 'One' })
  const two = await createCommunity(app, { name: 'Two' })
  const m = await addMember(app, one.community.id, { name: 'Dana Reed' })

  expect((await jsonReq(app, `/${two.community.id}/members/${m.member.id}`, 'PATCH', { role: 'admin' })).status).toBe(404)
  const res = await jsonReq(app, `/${one.community.id}/members/${m.member.id}`, 'PATCH', { role: 'moderator' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, member: { role: 'moderator' } })
})

test('DELETE /:id/members/:memberId removes a member; cross-community delete 404s', async () => {
  const { app } = await setup()
  const one = await createCommunity(app, { name: 'One' })
  const two = await createCommunity(app, { name: 'Two' })
  const m = await addMember(app, one.community.id, { name: 'Dana Reed' })

  expect((await jsonReq(app, `/${two.community.id}/members/${m.member.id}`, 'DELETE')).status).toBe(404)
  expect((await jsonReq(app, `/${one.community.id}/members/${m.member.id}`, 'DELETE')).status).toBe(200)
})

test('POST /:id/posts writes a post; a channel from another community is rejected (404)', async () => {
  const { app } = await setup()
  const one = await createCommunity(app, { name: 'One' })
  const two = await createCommunity(app, { name: 'Two' })
  const chOfTwo = await addChannel(app, two.community.id, { name: 'General' })

  // a channel that lives in `two` cannot be used to post into `one`
  expect((await jsonReq(app, `/${one.community.id}/posts`, 'POST', { channelId: chOfTwo.channel.id, body: 'x' })).status).toBe(404)
})

test('POST /:id/posts is 404 for an unknown community', async () => {
  const { app } = await setup()
  expect((await jsonReq(app, '/nope/posts', 'POST', { channelId: 'c', body: 'x' })).status).toBe(404)
})

test('POST /:id/posts/:postId/pin toggles pinned; PATCH edits a post; cross-community 404s', async () => {
  const { app } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle' })
  const ch = await addChannel(app, community.id, { name: 'General' })
  const post = await addPost(app, community.id, { channelId: ch.channel.id, body: 'Hello.', title: 'Hi' })
  expect(post.post.pinned).toBe(false)

  const pinned = await jsonReq(app, `/${community.id}/posts/${post.post.id}/pin`, 'POST', { pinned: true })
  expect(pinned.status).toBe(200)
  expect(await pinned.json()).toMatchObject({ ok: true, post: { pinned: true } })

  const edited = await jsonReq(app, `/${community.id}/posts/${post.post.id}`, 'PATCH', { title: 'Edited', body: 'New body.' })
  expect(edited.status).toBe(200)
  expect(await edited.json()).toMatchObject({ ok: true, post: { title: 'Edited', body: 'New body.' } })

  // a post in this community is not reachable through another community's URL
  const two = await createCommunity(app, { name: 'Two' })
  expect((await jsonReq(app, `/${two.community.id}/posts/${post.post.id}`, 'PATCH', { body: 'hijack' })).status).toBe(404)
})

test('DELETE /:id/posts/:postId removes a post and cascades its likes + comments', async () => {
  const { app, db, loc } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle' })
  const ch = await addChannel(app, community.id, { name: 'General' })
  const member = await addMember(app, community.id, { name: 'Coach Jamal' })
  const post = await addPost(app, community.id, { channelId: ch.channel.id, body: 'Hi.' })
  await new CommunityPostLikesRepo(db, loc).add(post.post.id, member.member.id)
  await jsonReq(app, `/${community.id}/posts/${post.post.id}/comments`, 'POST', { body: 'Nice.' })

  expect((await jsonReq(app, `/${community.id}/posts/${post.post.id}`, 'DELETE')).status).toBe(200)
  const likes = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM community_post_likes WHERE post_id=$1', [post.post.id])
  const comments = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM community_comments WHERE post_id=$1', [post.post.id])
  expect(likes[0]?.n).toBe(0)
  expect(comments[0]?.n).toBe(0)
})

test('POST /:id/posts/:postId/comments adds a comment; a cross-post comment 404s', async () => {
  const { app } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle' })
  const ch = await addChannel(app, community.id, { name: 'General' })
  const postA = await addPost(app, community.id, { channelId: ch.channel.id, body: 'A.' })
  const postB = await addPost(app, community.id, { channelId: ch.channel.id, body: 'B.' })

  const ok = await jsonReq(app, `/${community.id}/posts/${postA.post.id}/comments`, 'POST', { body: 'On A.' })
  expect(ok.status).toBe(201)
  const comment = (await ok.json()) as { comment: { id: string } }

  // the comment lives on post A — deleting it through post B's URL must 404
  expect((await jsonReq(app, `/${community.id}/posts/${postB.post.id}/comments/${comment.comment.id}`, 'DELETE')).status).toBe(404)
  // through post A's URL it removes
  expect((await jsonReq(app, `/${community.id}/posts/${postA.post.id}/comments/${comment.comment.id}`, 'DELETE')).status).toBe(200)
})

test('the rollup topChannel is DERIVED from real posts, shifting as posts move', async () => {
  const { app } = await setup()
  const { community } = await createCommunity(app, { name: 'Inner Circle' })
  const general = await addChannel(app, community.id, { name: 'General' })
  const wins = await addChannel(app, community.id, { name: 'Wins' })

  // no posts yet → no most-active channel
  let list = (await (await jsonReq(app, '/', 'GET')).json()) as { communities: { id: string; rollup: { topChannel: string | null } }[] }
  expect(list.communities.find((x) => x.id === community.id)?.rollup.topChannel).toBeNull()

  // two posts in General, one in Wins → General leads
  await addPost(app, community.id, { channelId: general.channel.id, body: '1' })
  await addPost(app, community.id, { channelId: general.channel.id, body: '2' })
  await addPost(app, community.id, { channelId: wins.channel.id, body: '3' })
  list = (await (await jsonReq(app, '/', 'GET')).json()) as typeof list
  expect(list.communities.find((x) => x.id === community.id)?.rollup.topChannel).toBe('General')
})
