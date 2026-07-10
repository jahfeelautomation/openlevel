import { describe, expect, it, vi } from 'vitest'
import { createGoogleReviewsSource } from './google-reviews-adapter'

const TOKEN = 'ya29-fake-gbp-oauth-token-not-real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
}

describe('google reviews source: fetchReviews', () => {
  it('GETs the account/location reviews with a bearer header, mapping star words to numbers', async () => {
    const fetchImpl = okFetch({
      reviews: [
        {
          reviewId: 'gr_1',
          starRating: 'FIVE',
          comment: 'Fast closing, fair price.',
          reviewer: { displayName: 'Sam Smith' },
          createTime: '2026-05-30T18:04:00Z',
        },
      ],
    })
    const source = createGoogleReviewsSource({
      accountId: 'acc1',
      locationId: 'gloc9',
      accessToken: TOKEN,
      fetchImpl,
    })

    const reviews = await source.fetchReviews()

    expect(source.source).toBe('google')
    expect(reviews).toEqual([
      {
        externalId: 'gr_1',
        rating: 5,
        body: 'Fast closing, fair price.',
        reviewerName: 'Sam Smith',
        createdAt: '2026-05-30T18:04:00Z',
      },
    ])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://mybusiness.googleapis.com/v4/accounts/acc1/locations/gloc9/reviews')
    expect(url).not.toContain(TOKEN) // the token rides in a header, never a URL
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('skips rows it cannot map honestly (unknown star words, no stable id)', async () => {
    const source = createGoogleReviewsSource({
      accountId: 'acc1',
      locationId: 'gloc9',
      accessToken: TOKEN,
      fetchImpl: okFetch({
        reviews: [
          { reviewId: 'gr_ok', starRating: 'THREE' },
          { reviewId: 'gr_unrated', starRating: 'STAR_RATING_UNSPECIFIED' },
          { starRating: 'FIVE' }, // no reviewId -> nothing to dedup on
        ],
      }),
    })
    const reviews = await source.fetchReviews()
    expect(reviews).toEqual([
      { externalId: 'gr_ok', rating: 3, body: null, reviewerName: null, createdAt: null },
    ])
  })

  it('walks nextPageToken pages and carries the token as a query param, not the secret', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ reviews: [{ reviewId: 'p1', starRating: 'FOUR' }], nextPageToken: 'page2' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reviews: [{ reviewId: 'p2', starRating: 'ONE' }] }), { status: 200 }),
      )
    const source = createGoogleReviewsSource({ accountId: 'a', locationId: 'l', accessToken: TOKEN, fetchImpl })

    const reviews = await source.fetchReviews()

    expect(reviews.map((r) => r.externalId)).toEqual(['p1', 'p2'])
    const [secondUrl] = fetchImpl.mock.calls[1] as unknown as [string]
    expect(secondUrl).toContain('pageToken=page2')
    expect(secondUrl).not.toContain(TOKEN)
  })

  it('caps pagination instead of looping forever on a stuck page token', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ reviews: [{ reviewId: 'r', starRating: 'FIVE' }], nextPageToken: 'again' }),
          { status: 200 },
        ),
    )
    const source = createGoogleReviewsSource({ accountId: 'a', locationId: 'l', accessToken: TOKEN, fetchImpl })
    await source.fetchReviews()
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('throws with only the status when Google refuses, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 }))
    const source = createGoogleReviewsSource({ accountId: 'a', locationId: 'l', accessToken: TOKEN, fetchImpl })
    await expect(source.fetchReviews()).rejects.toThrow(/403/)
    await expect(source.fetchReviews()).rejects.not.toThrow(new RegExp(TOKEN))
  })
})

