import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { communityRollup, postCounts, topChannel } from '../lib/community-math'
import { CommunitiesRepo } from '../repos/communities-repo'
import { CommunityChannelsRepo } from '../repos/community-channels-repo'
import { CommunityCommentsRepo } from '../repos/community-comments-repo'
import { CommunityMembersRepo } from '../repos/community-members-repo'
import { CommunityPostLikesRepo } from '../repos/community-post-likes-repo'
import { CommunityPostsRepo } from '../repos/community-posts-repo'

// Where the public community space is served (see index.ts:
// app.route('/api/public/communities', ...)). The operator UI shows this as the
// "View live" link for a published community.
const PUBLIC_COMMUNITY_BASE = '/api/public/communities'

const createCommunitySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().nullish(),
  status: z.enum(['draft', 'published']).optional(),
})

const patchCommunitySchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().nullish(),
  status: z.enum(['draft', 'published']).optional(),
})

const createChannelSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
})

const patchChannelSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
})

const memberRole = z.enum(['member', 'moderator', 'admin'])

const createMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().nullish(),
  contactId: z.string().nullish(),
  role: memberRole.optional(),
})

const patchMemberSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().nullish(),
  role: memberRole.optional(),
})

const createPostSchema = z.object({
  channelId: z.string().min(1),
  title: z.string().nullish(),
  body: z.string().min(1),
  memberId: z.string().nullish(),
  pinned: z.boolean().optional(),
})

const patchPostSchema = z.object({
  title: z.string().nullish(),
  body: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
})

const pinSchema = z.object({ pinned: z.boolean() })

const createCommentSchema = z.object({
  body: z.string().min(1),
  memberId: z.string().nullish(),
})

/** A URL-safe slug from a name: lowercased, non-alphanumerics collapsed to a
 *  single dash, trimmed, capped. Falls back to a default for an all-symbol name. */
function slugify(name: string, fallback: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || fallback
}

/**
 * Communities for the current location — a Skool-style group space. Mounted
 * behind operatorAuth + locationAccess. The Communities UI reads GET / for the
 * list: each row carries a `rollup` (member count, post count, most-active
 * channel) DERIVED in community-math.ts from real rows, never stored — an empty
 * community is an honest zero. GET /:id opens the builder: the community, its
 * ordered channels (each with a real post count), its member roster, and its post
 * feed (pinned-first), every post carrying its real like/comment counts and its
 * comment thread.
 *
 *   POST   /                                     create a community (draft unless told otherwise)
 *   PATCH  /:id                                  edit name / slug / description / status (publish)
 *   DELETE /:id                                  remove a community (cascades everything under it)
 *   POST   /:id/channels                         add a channel (appended unless positioned)
 *   PATCH  /:id/channels/:channelId              rename / reorder a channel
 *   DELETE /:id/channels/:channelId              remove a channel (cascades its posts)
 *   POST   /:id/members                          add a member (optionally tied to a CRM contact)
 *   PATCH  /:id/members/:memberId                edit a member's name / email / role
 *   DELETE /:id/members/:memberId                remove a member
 *   POST   /:id/posts                            write a post under a channel
 *   PATCH  /:id/posts/:postId                    edit a post's title / body / pinned
 *   POST   /:id/posts/:postId/pin               pin or unpin a post
 *   DELETE /:id/posts/:postId                    remove a post (cascades its likes + comments)
 *   POST   /:id/posts/:postId/comments           add a comment to a post
 *   DELETE /:id/posts/:postId/comments/:commentId   remove a comment
 *
 * Every count an operator sees here is the real, current count over the rows they
 * curated — publishing a community is the one thing that makes the public feed go
 * live, and nothing on this surface can inflate a member, post, like or comment
 * tally beyond the rows that exist.
 */
export function communitiesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** Roll a community up to its list-card shape: its own row plus the derived
   *  member/post counts and most-active channel name. */
  async function rollupOf(loc: string, communityId: string) {
    const members = await new CommunityMembersRepo(deps.db, loc).countByCommunity(communityId)
    const postsRepo = new CommunityPostsRepo(deps.db, loc)
    const posts = await postsRepo.countByCommunity(communityId)
    const channels = await new CommunityChannelsRepo(deps.db, loc).listByCommunity(communityId)
    const channelActivity = []
    for (const ch of channels) {
      channelActivity.push({ name: ch.name, postCount: await postsRepo.countByChannel(ch.id) })
    }
    return {
      ...communityRollup(members, posts),
      channelCount: channels.length,
      topChannel: topChannel(channelActivity),
    }
  }

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const communities = await new CommunitiesRepo(deps.db, loc).list()
    const rows = []
    for (const community of communities) {
      rows.push({ ...community, rollup: await rollupOf(loc, community.id) })
    }
    return c.json({ communities: rows })
  })

  app.post('/', zValidator('json', createCommunitySchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const repo = new CommunitiesRepo(deps.db, loc)
    // Derive a slug from the name when none is given, unique within the location
    // so the public URL never collides with an existing community.
    let slug = input.slug?.trim() || slugify(input.name, 'community')
    if (await repo.getBySlug(slug)) slug = `${slug}-${nanoid(4).toLowerCase()}`
    const community = await repo.create({
      name: input.name,
      slug,
      description: input.description ?? null,
      status: input.status,
    })
    return c.json(
      {
        ok: true,
        community: {
          ...community,
          rollup: { members: 0, posts: 0, channelCount: 0, topChannel: null },
        },
      },
      201,
    )
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const community = await new CommunitiesRepo(deps.db, loc).get(id)
    if (!community) return c.json({ error: 'not found' }, 404)

    const postsRepo = new CommunityPostsRepo(deps.db, loc)
    const channelRows = await new CommunityChannelsRepo(deps.db, loc).listByCommunity(id)
    const channelName = new Map(channelRows.map((ch) => [ch.id, ch.name]))
    const channels = []
    for (const ch of channelRows) {
      channels.push({ ...ch, postCount: await postsRepo.countByChannel(ch.id) })
    }

    const members = await new CommunityMembersRepo(deps.db, loc).listByCommunity(id)
    const memberName = new Map(members.map((m) => [m.id, m.name]))

    const likesRepo = new CommunityPostLikesRepo(deps.db, loc)
    const commentsRepo = new CommunityCommentsRepo(deps.db, loc)
    const postRows = await postsRepo.listByCommunity(id)
    const posts = []
    for (const post of postRows) {
      const commentRows = await commentsRepo.listByPost(post.id)
      const counts = postCounts(await likesRepo.countByPost(post.id), commentRows.length)
      posts.push({
        ...post,
        channelName: channelName.get(post.channel_id) ?? null,
        authorName: post.member_id ? (memberName.get(post.member_id) ?? null) : null,
        likes: counts.likes,
        comments: counts.comments,
        commentThread: commentRows.map((cm) => ({
          ...cm,
          authorName: cm.member_id ? (memberName.get(cm.member_id) ?? null) : null,
        })),
      })
    }

    return c.json({
      community,
      channels,
      members,
      posts,
      rollup: await rollupOf(loc, id),
      publicUrl: `${PUBLIC_COMMUNITY_BASE}/${loc}/${community.slug}`,
    })
  })

  app.patch('/:id', zValidator('json', patchCommunitySchema), async (c) => {
    const loc = c.get('locationId')
    const body = c.req.valid('json')
    const community = await new CommunitiesRepo(deps.db, loc).update(c.req.param('id'), {
      name: body.name,
      slug: body.slug,
      description: body.description,
      status: body.status,
    })
    if (!community) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, community })
  })

  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const repo = new CommunitiesRepo(deps.db, loc)
    const community = await repo.get(c.req.param('id'))
    if (!community) return c.json({ error: 'not found' }, 404)
    await repo.remove(community.id)
    return c.json({ ok: true })
  })

  // --- channels ------------------------------------------------------------

  /** Load a community or signal 404 — the guard every nested write runs first. */
  async function requireCommunity(loc: string, id: string) {
    return new CommunitiesRepo(deps.db, loc).get(id)
  }

  app.post('/:id/channels', zValidator('json', createChannelSchema), async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    if (!(await requireCommunity(loc, communityId))) return c.json({ error: 'not found' }, 404)

    const input = c.req.valid('json')
    const repo = new CommunityChannelsRepo(deps.db, loc)
    let slug = input.slug?.trim() || slugify(input.name, 'channel')
    if (await repo.getBySlug(communityId, slug)) slug = `${slug}-${nanoid(4).toLowerCase()}`
    // Default the new channel to the end of the rail — its position is the current
    // channel count, preserving the operator's order without re-indexing.
    const position = input.position ?? (await repo.countByCommunity(communityId))
    const channel = await repo.create({ communityId, name: input.name, slug, position })
    return c.json({ ok: true, channel: { ...channel, postCount: 0 } }, 201)
  })

  app.patch('/:id/channels/:channelId', zValidator('json', patchChannelSchema), async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const channelId = c.req.param('channelId')
    const repo = new CommunityChannelsRepo(deps.db, loc)
    const existing = await repo.get(channelId)
    if (!existing || existing.community_id !== communityId) return c.json({ error: 'not found' }, 404)

    const body = c.req.valid('json')
    const channel = await repo.update(channelId, {
      name: body.name,
      slug: body.slug,
      position: body.position,
    })
    return c.json({ ok: true, channel: channel ?? existing })
  })

  app.delete('/:id/channels/:channelId', async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const channelId = c.req.param('channelId')
    const repo = new CommunityChannelsRepo(deps.db, loc)
    const existing = await repo.get(channelId)
    if (!existing || existing.community_id !== communityId) return c.json({ error: 'not found' }, 404)
    await repo.remove(channelId)
    return c.json({ ok: true })
  })

  // --- members -------------------------------------------------------------

  app.post('/:id/members', zValidator('json', createMemberSchema), async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    if (!(await requireCommunity(loc, communityId))) return c.json({ error: 'not found' }, 404)

    const input = c.req.valid('json')
    const member = await new CommunityMembersRepo(deps.db, loc).create({
      communityId,
      name: input.name,
      email: input.email ?? null,
      contactId: input.contactId ?? null,
      role: input.role,
    })
    return c.json({ ok: true, member }, 201)
  })

  app.patch('/:id/members/:memberId', zValidator('json', patchMemberSchema), async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const memberId = c.req.param('memberId')
    const repo = new CommunityMembersRepo(deps.db, loc)
    const existing = await repo.get(memberId)
    if (!existing || existing.community_id !== communityId) return c.json({ error: 'not found' }, 404)

    const body = c.req.valid('json')
    const member = await repo.update(memberId, {
      name: body.name,
      email: body.email,
      role: body.role,
    })
    return c.json({ ok: true, member: member ?? existing })
  })

  app.delete('/:id/members/:memberId', async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const memberId = c.req.param('memberId')
    const repo = new CommunityMembersRepo(deps.db, loc)
    const existing = await repo.get(memberId)
    if (!existing || existing.community_id !== communityId) return c.json({ error: 'not found' }, 404)
    await repo.remove(memberId)
    return c.json({ ok: true })
  })

  // --- posts ---------------------------------------------------------------

  app.post('/:id/posts', zValidator('json', createPostSchema), async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    if (!(await requireCommunity(loc, communityId))) return c.json({ error: 'not found' }, 404)

    const input = c.req.valid('json')
    // The post's channel must belong to this community — no cross-community posts.
    const channel = await new CommunityChannelsRepo(deps.db, loc).get(input.channelId)
    if (!channel || channel.community_id !== communityId) return c.json({ error: 'not found' }, 404)

    const post = await new CommunityPostsRepo(deps.db, loc).create({
      communityId,
      channelId: input.channelId,
      memberId: input.memberId ?? null,
      title: input.title ?? null,
      body: input.body,
      pinned: input.pinned,
    })
    return c.json({ ok: true, post }, 201)
  })

  /** Load a post and confirm it belongs to the community in the URL, or 404. */
  async function requirePost(loc: string, communityId: string, postId: string) {
    const post = await new CommunityPostsRepo(deps.db, loc).get(postId)
    if (!post || post.community_id !== communityId) return undefined
    return post
  }

  app.patch('/:id/posts/:postId', zValidator('json', patchPostSchema), async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const postId = c.req.param('postId')
    const existing = await requirePost(loc, communityId, postId)
    if (!existing) return c.json({ error: 'not found' }, 404)

    const body = c.req.valid('json')
    const post = await new CommunityPostsRepo(deps.db, loc).update(postId, {
      title: body.title,
      body: body.body,
      pinned: body.pinned,
    })
    return c.json({ ok: true, post: post ?? existing })
  })

  app.post('/:id/posts/:postId/pin', zValidator('json', pinSchema), async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const postId = c.req.param('postId')
    const existing = await requirePost(loc, communityId, postId)
    if (!existing) return c.json({ error: 'not found' }, 404)

    const post = await new CommunityPostsRepo(deps.db, loc).setPinned(postId, c.req.valid('json').pinned)
    return c.json({ ok: true, post: post ?? existing })
  })

  app.delete('/:id/posts/:postId', async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const postId = c.req.param('postId')
    const existing = await requirePost(loc, communityId, postId)
    if (!existing) return c.json({ error: 'not found' }, 404)
    await new CommunityPostsRepo(deps.db, loc).remove(postId)
    return c.json({ ok: true })
  })

  // --- comments ------------------------------------------------------------

  app.post('/:id/posts/:postId/comments', zValidator('json', createCommentSchema), async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const postId = c.req.param('postId')
    if (!(await requirePost(loc, communityId, postId))) return c.json({ error: 'not found' }, 404)

    const input = c.req.valid('json')
    const comment = await new CommunityCommentsRepo(deps.db, loc).create({
      postId,
      memberId: input.memberId ?? null,
      body: input.body,
    })
    return c.json({ ok: true, comment }, 201)
  })

  app.delete('/:id/posts/:postId/comments/:commentId', async (c) => {
    const loc = c.get('locationId')
    const communityId = c.req.param('id')
    const postId = c.req.param('postId')
    const commentId = c.req.param('commentId')
    if (!(await requirePost(loc, communityId, postId))) return c.json({ error: 'not found' }, 404)

    const commentsRepo = new CommunityCommentsRepo(deps.db, loc)
    // The comment must belong to the post in the URL — no cross-post deletes.
    const thread = await commentsRepo.listByPost(postId)
    if (!thread.some((cm) => cm.id === commentId)) return c.json({ error: 'not found' }, 404)
    await commentsRepo.remove(commentId)
    return c.json({ ok: true })
  })

  return app
}
