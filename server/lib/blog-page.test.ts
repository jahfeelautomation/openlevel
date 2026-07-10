import { renderBlogIndex, renderBlogNotFound, renderBlogPost } from './blog-page'

const idxPost = (over: Partial<Parameters<typeof renderBlogIndex>[0]['posts'][number]> = {}) => ({
  slug: 'cash-offers-101',
  title: 'Cash Offers 101',
  excerpt: 'How a cash offer actually works.',
  publishedAt: '2026-06-03T15:00:00.000Z',
  readingMinutes: 4,
  ...over,
})

describe('renderBlogIndex', () => {
  test('is a self-contained, noindex document branded to the location', () => {
    const html = renderBlogIndex({
      businessName: 'Jamal — Cash Offers',
      brandColor: '#0ea5e9',
      loc: 'loc_jamal',
      posts: [idxPost()],
    })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('name="robots" content="noindex"')
    expect(html).toContain('--brand:#0ea5e9')
    expect(html).toContain('Jamal — Cash Offers')
    expect(html).toContain('>Blog<')
  })

  test('renders each post as a link to its own public URL with date and derived read time', () => {
    const html = renderBlogIndex({
      businessName: 'Acme',
      loc: 'loc_jamal',
      posts: [idxPost()],
    })
    expect(html).toContain('href="/api/public/blog/loc_jamal/cash-offers-101"')
    expect(html).toContain('Cash Offers 101')
    expect(html).toContain('How a cash offer actually works.')
    expect(html).toContain('June 3, 2026')
    expect(html).toContain('4 min read')
  })

  test('omits the read-time badge for a 0-minute (empty) post rather than printing "0 min read"', () => {
    const html = renderBlogIndex({
      businessName: 'Acme',
      loc: 'loc_jamal',
      posts: [idxPost({ readingMinutes: 0 })],
    })
    expect(html).not.toContain('0 min read')
    // The date still shows.
    expect(html).toContain('June 3, 2026')
  })

  test('an empty blog is an honest empty state, not a fabricated post', () => {
    const html = renderBlogIndex({ businessName: 'Acme', loc: 'loc_jamal', posts: [] })
    expect(html).toContain('No posts published yet')
    // No rendered post link (the bare class name still appears in the <style> block).
    expect(html).not.toContain('<a class="ol-postcard"')
  })

  test('escapes post titles and excerpts — no HTML injection from content', () => {
    const html = renderBlogIndex({
      businessName: 'Acme',
      loc: 'loc_jamal',
      posts: [idxPost({ title: '<script>alert(1)</script>', excerpt: '<b>hi</b>' })],
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<b>hi</b>')
  })

  test('falls back to the default brand for an unsafe color', () => {
    const html = renderBlogIndex({
      businessName: 'Acme',
      brandColor: 'red;}</style><script>',
      loc: 'loc_jamal',
      posts: [],
    })
    expect(html).toContain('--brand:#4f46e5')
    expect(html).not.toContain('<script>')
  })
})

describe('renderBlogPost', () => {
  const base = {
    businessName: 'Jamal — Cash Offers',
    brandColor: '#0ea5e9',
    loc: 'loc_jamal',
    post: {
      title: 'How We Buy Houses For Cash',
      body: 'First paragraph here.\n\nSecond paragraph here.',
      author: 'Jamal',
      coverImageUrl: 'https://cdn.example.com/cover.jpg',
      publishedAt: '2026-06-03T15:00:00.000Z',
      readingMinutes: 5,
    },
  }

  test('renders the title, author, date and derived read time', () => {
    const html = renderBlogPost(base)
    expect(html).toContain('How We Buy Houses For Cash')
    expect(html).toContain('Jamal')
    expect(html).toContain('June 3, 2026')
    expect(html).toContain('5 min read')
  })

  test('splits the body on blank lines into separate escaped paragraphs', () => {
    const html = renderBlogPost(base)
    expect(html).toContain('<p class="ol-article-p">First paragraph here.</p>')
    expect(html).toContain('<p class="ol-article-p">Second paragraph here.</p>')
  })

  test('shows a cover image only from a safe http(s) URL', () => {
    const html = renderBlogPost(base)
    expect(html).toContain('src="https://cdn.example.com/cover.jpg"')
  })

  test('drops an unsafe cover image URL (no javascript: src)', () => {
    const html = renderBlogPost({
      ...base,
      post: { ...base.post, coverImageUrl: 'javascript:alert(1)' },
    })
    expect(html).not.toContain('javascript:alert(1)')
    expect(html).not.toContain('<img')
  })

  test('escapes the body — no HTML injection from post content', () => {
    const html = renderBlogPost({
      ...base,
      post: { ...base.post, body: '<script>alert(1)</script>' },
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('handles a null body and a null author without inventing content', () => {
    const html = renderBlogPost({
      ...base,
      post: { ...base.post, body: null, author: null, coverImageUrl: null },
    })
    expect(html).toContain('How We Buy Houses For Cash')
    // No rendered paragraph or image (the bare class still appears in the <style> block).
    expect(html).not.toContain('<p class="ol-article-p">')
    expect(html).not.toContain('<img')
  })

  test('links back to the location blog index', () => {
    const html = renderBlogPost(base)
    expect(html).toContain('href="/api/public/blog/loc_jamal"')
  })
})

describe('renderBlogNotFound', () => {
  test('is a styled, self-contained 404', () => {
    const html = renderBlogNotFound()
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Page not found')
    expect(html).toContain('This post is not available.')
  })
})
