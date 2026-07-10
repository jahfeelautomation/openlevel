import { describe, expect, it, vi } from 'vitest'
import { createFacebookReviewsSource } from './facebook-reviews-adapter'

const TOKEN = 'EAA-fake-page-token-not-real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
}

describe('facebook reviews source: fetchReviews', () => {
  it('GETs the page ratings with a bearer header and maps a starred review', async () => {
    const fetchImpl = okFetch({
      data: [
        {
          review_text: 'They handled everything start to finish.',
          rating: 5,
          recommendation_type: 'positive',
          created_time: '2026-05-12T16:20:00+0000',
          reviewer: { name: 'Dana Cole', id: '88001' },
          open_graph_story: { id: 'og_551' },
        },
      ],
    })
    const source = createFacebookReviewsSource({ pageId: 'p123', accessToken: TOKEN, fetchImpl })

    const reviews = await source.fetchReviews()

    expect(source.source).toBe('facebook')
    expect(reviews).toEqual([
      {
        externalId: 'og_551',
        rating: 5,
        body: 'They handled everything start to finish.',
        reviewerName: 'Dana Cole',
        createdAt: '2026-05-12T16:20:00+0000',
      },
    ])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://graph.facebook.com/v21.0/p123/ratings?')
    expect(url).toContain('fields=review_text,rating,recommendation_type,created_time,reviewer,open_graph_story')
    expect(url).not.toContain(TOKEN) // the token rides in a header, never a URL
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('maps a star-less recommendation honestly (positive=5, negative=1) and skips unmappable rows', async () => {
    const source = createFacebookReviewsSource({
      pageId: 'p123',
      accessToken: TOKEN,
      fetchImpl: okFetch({
        data: [
          { recommendation_type: 'positive', open_graph_story: { id: 'og_pos' } },
          { recommendation_type: 'negative', open_graph_story: { id: 'og_neg' } },
          { open_graph_story: { id: 'og_blank' } }, // no stars, no recommendation -> skip
        ],
      }),
    })
    const reviews = await source.fetchReviews()
    expect(reviews.map((r) => [r.externalId, r.rating])).toEqual([
      ['og_pos', 5],
      ['og_neg', 1],
    ])
  })

  it('falls back to reviewer id + created time for identity and skips rows with neither', async () => {
    const source = createFacebookReviewsSource({
      pageId: 'p123',
      accessToken: TOKEN,
      fetchImpl: okFetch({
        data: [
          { rating: 4, reviewer: { id: '88001' }, created_time: '2026-05-12T16:20:00+0000' },
          { rating: 3 }, // no story id, no reviewer id -> nothing to dedup on
        ],
      }),
    })
    const reviews = await source.fetchReviews()
    expect(reviews).toEqual([
      {
        externalId: '88001:2026-05-12T16:20:00+0000',
        rating: 4,
        body: null,
        reviewerName: null,
        createdAt: '2026-05-12T16:20:00+0000',
      },
    ])
  })

  it('walks the paging cursor and caps instead of looping forever', async () => {
    const pageWithNext = {
      data: [{ rating: 5, open_graph_story: { id: 'og_loop' } }],
      paging: { cursors: { after: 'cur2' }, next: 'https://graph.facebook.com/next' },
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(pageWithNext), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ rating: 2, open_graph_story: { id: 'og_last' } }] }), {
          status: 200,
        }),
      )
    const source = createFacebookReviewsSource({ pageId: 'p123', accessToken: TOKEN, fetchImpl })

    const reviews = await source.fetchReviews()

    expect(reviews.map((r) => r.externalId)).toEqual(['og_loop', 'og_last'])
    const [secondUrl] = fetchImpl.mock.calls[1] as unknown as [string]
    expect(secondUrl).toContain('after=cur2')
    expect(secondUrl).not.toContain(TOKEN)

    // a stuck cursor stops at the cap rather than spinning
    const stuck = vi.fn(async () => new Response(JSON.stringify(pageWithNext), { status: 200 }))
    await createFacebookReviewsSource({ pageId: 'p123', accessToken: TOKEN, fetchImpl: stuck }).fetchReviews()
    expect(stuck.mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('throws with only the status when Facebook refuses, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{"code":190}}', { status: 401 }))
    const source = createFacebookReviewsSource({ pageId: 'p123', accessToken: TOKEN, fetchImpl })
    await expect(source.fetchReviews()).rejects.toThrow(/401/)
    await expect(source.fetchReviews()).rejects.not.toThrow(new RegExp(TOKEN))
  })
})
