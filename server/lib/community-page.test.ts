import {
  renderCommunityFeed,
  renderCommunityNotFound,
  renderCommunityPost,
  type CommunityFeedOpts,
  type CommunitySinglePostOpts,
} from './community-page'

function feedOpts(over: Partial<CommunityFeedOpts> = {}): CommunityFeedOpts {
  return {
    businessName: 'Alex Fitness',
    brandColor: '#16a34a',
    loc: 'loc_alex',
    slug: 'inner-circle',
    communityName: 'Inner Circle',
    description: 'A space for members.',
    members: 128,
    posts: 42,
    channels: [
      { slug: 'general', name: 'General', postCount: 30 },
      { slug: 'wins', name: 'Wins', postCount: 12 },
    ],
    activeChannelSlug: null,
    feed: [
      {
        id: 'p1',
        channelName: 'Wins',
        authorName: 'Dana Reed',
        title: 'Hit my goal!',
        body: 'Down 10 pounds this month.\n\nThanks coach.',
        pinned: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        likes: 12,
        comments: 3,
      },
    ],
    ...over,
  }
}

test('feed renders the derived member + post counts honestly', () => {
  const html = renderCommunityFeed(feedOpts())
  expect(html).toContain('128 members')
  expect(html).toContain('42 posts')
})

test('feed shows an honest 0 in the stat line for an empty community', () => {
  const html = renderCommunityFeed(feedOpts({ members: 0, posts: 0, feed: [] }))
  expect(html).toContain('0 members')
  expect(html).toContain('0 posts')
  expect(html).toContain('No posts here yet')
})

test('feed renders an All chip plus each channel with its post count', () => {
  const html = renderCommunityFeed(feedOpts())
  expect(html).toContain('>All<')
  expect(html).toContain('General')
  expect(html).toContain('Wins')
  // channel chips link to the per-channel feed
  expect(html).toContain('/api/public/communities/loc_alex/inner-circle/c/general')
  expect(html).toContain('/api/public/communities/loc_alex/inner-circle/c/wins')
})

test('feed marks the active channel chip as on', () => {
  const html = renderCommunityFeed(feedOpts({ activeChannelSlug: 'wins' }))
  // the Wins chip carries the active class
  expect(html).toMatch(/ol-c-chip ol-c-on"[^>]*\/c\/wins/)
})

test('feed shows a Pinned badge and links each post to its permalink', () => {
  const html = renderCommunityFeed(feedOpts())
  expect(html).toContain('Pinned')
  expect(html).toContain('/api/public/communities/loc_alex/inner-circle/p/p1')
  expect(html).toContain('Hit my goal!')
})

test('feed shows derived like + comment counts and never shows a zero count', () => {
  const html = renderCommunityFeed(feedOpts())
  expect(html).toContain('12 likes')
  expect(html).toContain('3 comments')

  const zero = renderCommunityFeed(
    feedOpts({
      feed: [
        {
          id: 'p2',
          channelName: 'General',
          authorName: null,
          title: 'Quiet post',
          body: 'No engagement yet.',
          pinned: false,
          createdAt: '2026-06-02T00:00:00.000Z',
          likes: 0,
          comments: 0,
        },
      ],
    }),
  )
  expect(zero).not.toContain('0 likes')
  expect(zero).not.toContain('0 comments')
})

test('feed singularizes a count of one', () => {
  const html = renderCommunityFeed(
    feedOpts({
      members: 1,
      posts: 1,
      feed: [
        {
          id: 'p3',
          channelName: 'General',
          authorName: 'Sole Member',
          title: 'First',
          body: 'Hello.',
          pinned: false,
          createdAt: '2026-06-02T00:00:00.000Z',
          likes: 1,
          comments: 1,
        },
      ],
    }),
  )
  expect(html).toContain('1 member')
  expect(html).toContain('1 post')
  expect(html).toContain('1 like')
  expect(html).toContain('1 comment')
  expect(html).not.toContain('1 members')
  expect(html).not.toContain('1 likes')
})

test('feed escapes member-authored title + body (no HTML injection)', () => {
  const html = renderCommunityFeed(
    feedOpts({
      feed: [
        {
          id: 'p4',
          channelName: 'General',
          authorName: '<b>x</b>',
          title: '<script>alert(1)</script>',
          body: '<img src=x onerror=alert(1)>',
          pinned: false,
          createdAt: null,
          likes: 0,
          comments: 0,
        },
      ],
    }),
  )
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<img src=x onerror=alert(1)>')
})

test('feed truncates a long post body with an ellipsis in the excerpt', () => {
  const long = 'word '.repeat(80).trim()
  const html = renderCommunityFeed(
    feedOpts({
      feed: [
        {
          id: 'p5',
          channelName: 'General',
          authorName: 'Verbose',
          title: 'Long one',
          body: long,
          pinned: false,
          createdAt: null,
          likes: 0,
          comments: 0,
        },
      ],
    }),
  )
  expect(html).toContain('…')
})

function postOpts(over: Partial<CommunitySinglePostOpts> = {}): CommunitySinglePostOpts {
  return {
    businessName: 'Alex Fitness',
    brandColor: '#16a34a',
    loc: 'loc_alex',
    slug: 'inner-circle',
    communityName: 'Inner Circle',
    post: {
      channelName: 'Wins',
      authorName: 'Dana Reed',
      title: 'Hit my goal!',
      body: 'Down 10 pounds this month.\n\nThanks coach.',
      pinned: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      likes: 12,
      comments: 2,
    },
    comments: [
      { authorName: 'Coach Alex', body: 'Proud of you!', createdAt: '2026-06-01T01:00:00.000Z' },
      { authorName: 'Sam', body: 'Inspiring.', createdAt: '2026-06-01T02:00:00.000Z' },
    ],
    ...over,
  }
}

test('single post renders the full body as paragraphs and a back link to the feed', () => {
  const html = renderCommunityPost(postOpts())
  expect(html).toContain('Down 10 pounds this month.')
  expect(html).toContain('Thanks coach.')
  expect(html).toContain('/api/public/communities/loc_alex/inner-circle"')
  expect(html).toContain('Inner Circle')
})

test('single post lists comments with their authors in the given (oldest-first) order', () => {
  const html = renderCommunityPost(postOpts())
  expect(html).toContain('2 comments')
  expect(html).toContain('Coach Alex')
  expect(html).toContain('Proud of you!')
  expect(html).toContain('Sam')
  expect(html.indexOf('Proud of you!')).toBeLessThan(html.indexOf('Inspiring.'))
})

test('single post shows an honest empty state when there are no comments', () => {
  const html = renderCommunityPost(postOpts({ comments: [], post: { ...postOpts().post, comments: 0 } }))
  expect(html).toContain('No comments yet.')
})

test('single post escapes comment bodies (no HTML injection)', () => {
  const html = renderCommunityPost(
    postOpts({
      comments: [{ authorName: 'x', body: '<script>alert(1)</script>', createdAt: null }],
    }),
  )
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('&lt;script&gt;')
})

test('not-found page is a self-contained document', () => {
  const html = renderCommunityNotFound()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('not available')
})

