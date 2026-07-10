import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import {
  renderCommunityFeed,
  renderCommunityNotFound,
  renderCommunityPost,
  type CommunityFeedPost,
} from '../lib/community-page'
import { CommunitiesRepo } from '../repos/communities-repo'
import { CommunityChannelsRepo } from '../repos/community-channels-repo'
import { CommunityCommentsRepo } from '../repos/community-comments-repo'
import { CommunityMembersRepo } from '../repos/community-members-repo'
import { CommunityPostLikesRepo } from '../repos/community-post-likes-repo'
import { CommunityPostsRepo } from '../repos/community-posts-repo'
import { LocationsRepo } from '../repos/locations-repo'

/**
 * Public, UNAUTHENTICATED community space — mounted at `/api/public/communities`
 * BEFORE the operatorAuth boundary, reading the location + community slug from the
 * URL:
 *
 *   GET /:loc/:slug                 → the community feed (all channels)
 *   GET /:loc/:slug/c/:channelSlug  → the feed filtered to one channel
 *   GET /:loc/:slug/p/:postId       → a single post with its comment thread
 *
 * Only a PUBLISHED community is ever served (a draft 404s), so the operator
 * controls when a space goes live. This leg is strictly read-only in v1: it
 * renders the real rows an operator curated — every count (members, posts,
 * per-channel posts, a post's likes/comments) is a live COUNT over those rows,
 * never a stored or invented number — and it has no write path of its own.
 */
export function publicCommunitiesRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  async function locationMeta(loc: string): Promise<{ name: string; brandColor?: string }> {
    const location = await new LocationsRepo(deps.db).getById(loc)
    const color = location?.branding.color
    return {
      name: location?.name ?? 'us',
      brandColor: typeof color === 'string' ? color : undefined,
    }
  }

  /** Resolve a published community by slug, or null. Drafts are treated as absent. */
  async function publishedCommunity(loc: string, slug: string) {
    const community = await new CommunitiesRepo(deps.db, loc).getBySlug(slug)
    if (!community || community.status !== 'published') return null
    return community
  }

  /** Build the shared feed view-model for a set of posts: resolve each post's
   *  channel name + author name, and derive its like/comment counts from real
   *  rows. Posts arrive already ordered (pinned-first, newest) from the repo. */
  async function toFeedPosts(
    loc: string,
    posts: Array<{
      id: string
      channel_id: string
      member_id: string | null
      title: string | null
      body: string
      pinned: boolean
      created_at: string
    }>,
    channelName: Map<string, string>,
    memberName: Map<string, string>,
  ): Promise<CommunityFeedPost[]> {
    const likesRepo = new CommunityPostLikesRepo(deps.db, loc)
    const commentsRepo = new CommunityCommentsRepo(deps.db, loc)
    const out: CommunityFeedPost[] = []
    for (const post of posts) {
      out.push({
        id: post.id,
        channelName: channelName.get(post.channel_id) ?? 'General',
        authorName: post.member_id ? (memberName.get(post.member_id) ?? null) : null,
        title: post.title,
        body: post.body,
        pinned: post.pinned,
        createdAt: post.created_at,
        likes: await likesRepo.countByPost(post.id),
        comments: await commentsRepo.countByPost(post.id),
      })
    }
    return out
  }

  /** GET /:loc/:slug and /:loc/:slug/c/:channelSlug share this body. */
  async function renderFeed(loc: string, slug: string, channelSlug: string | null) {
    const community = await publishedCommunity(loc, slug)
    if (!community) return null

    const channelsRepo = new CommunityChannelsRepo(deps.db, loc)
    const channels = await channelsRepo.listByCommunity(community.id)
    const postsRepo = new CommunityPostsRepo(deps.db, loc)

    // Channel rail with per-channel real post counts.
    const channelName = new Map(channels.map((ch) => [ch.id, ch.name]))
    const railChannels = []
    for (const ch of channels) {
      railChannels.push({
        slug: ch.slug,
        name: ch.name,
        postCount: await postsRepo.countByChannel(ch.id),
      })
    }

    // If a channel filter is requested, it must exist in this community.
    let activeChannelSlug: string | null = null
    let posts
    if (channelSlug !== null) {
      const channel = await channelsRepo.getBySlug(community.id, channelSlug)
      if (!channel) return null
      activeChannelSlug = channel.slug
      posts = await postsRepo.listByChannel(channel.id)
    } else {
      posts = await postsRepo.listByCommunity(community.id)
    }

    const members = await new CommunityMembersRepo(deps.db, loc).listByCommunity(community.id)
    const memberName = new Map(members.map((m) => [m.id, m.name]))

    const feed = await toFeedPosts(loc, posts, channelName, memberName)
    const meta = await locationMeta(loc)
    return renderCommunityFeed({
      businessName: meta.name,
      brandColor: meta.brandColor,
      loc,
      slug: community.slug,
      communityName: community.name,
      description: community.description,
      members: members.length,
      posts: await postsRepo.countByCommunity(community.id),
      channels: railChannels,
      activeChannelSlug,
      feed,
    })
  }

  app.get('/:loc/:slug', async (c) => {
    const html = await renderFeed(c.req.param('loc'), c.req.param('slug'), null)
    if (!html) return c.html(renderCommunityNotFound(), 404)
    return c.html(html)
  })

  app.get('/:loc/:slug/c/:channelSlug', async (c) => {
    const html = await renderFeed(
      c.req.param('loc'),
      c.req.param('slug'),
      c.req.param('channelSlug'),
    )
    if (!html) return c.html(renderCommunityNotFound(), 404)
    return c.html(html)
  })

  app.get('/:loc/:slug/p/:postId', async (c) => {
    const loc = c.req.param('loc')
    const slug = c.req.param('slug')
    const postId = c.req.param('postId')

    const community = await publishedCommunity(loc, slug)
    if (!community) return c.html(renderCommunityNotFound(), 404)

    const post = await new CommunityPostsRepo(deps.db, loc).get(postId)
    // The post must belong to this community — no cross-community permalinks.
    if (!post || post.community_id !== community.id) {
      return c.html(renderCommunityNotFound(), 404)
    }

    const channel = await new CommunityChannelsRepo(deps.db, loc).get(post.channel_id)
    const author = post.member_id
      ? await new CommunityMembersRepo(deps.db, loc).get(post.member_id)
      : undefined
    const likes = await new CommunityPostLikesRepo(deps.db, loc).countByPost(post.id)
    const commentsRepo = new CommunityCommentsRepo(deps.db, loc)
    const commentRows = await commentsRepo.listByPost(post.id)

    const members = await new CommunityMembersRepo(deps.db, loc).listByCommunity(community.id)
    const memberName = new Map(members.map((m) => [m.id, m.name]))
    const comments = commentRows.map((cm) => ({
      authorName: cm.member_id ? (memberName.get(cm.member_id) ?? null) : null,
      body: cm.body,
      createdAt: cm.created_at,
    }))

    const meta = await locationMeta(loc)
    return c.html(
      renderCommunityPost({
        businessName: meta.name,
        brandColor: meta.brandColor,
        loc,
        slug: community.slug,
        communityName: community.name,
        post: {
          channelName: channel?.name ?? 'General',
          authorName: author?.name ?? null,
          title: post.title,
          body: post.body,
          pinned: post.pinned,
          createdAt: post.created_at,
          likes,
          comments: commentRows.length,
        },
        comments,
      }),
    )
  })

  return app
}
