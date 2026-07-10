import { afterEach, describe, expect, it } from 'vitest'
import { FakeDatabase } from '../../db/fake-database'
import { resolveReviewSource } from './resolve'

// Secrets resolve by NAME via the env-backed vault layer, same as social
// publishing: <slug>:google_business:access_token -> ACME_GOOGLE_BUSINESS_ACCESS_TOKEN.
// Facebook review sync REUSES the page id + page token the location already
// configured for publishing — one connection, both directions.
const ENV_KEYS = ['ACME_GOOGLE_BUSINESS_ACCESS_TOKEN', 'ACME_FACEBOOK_PAGE_TOKEN']

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

function dbWithLocation(settings: Record<string, unknown>, clientSlug: string | null = 'acme') {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', name: 'Acme', slug: 'acme-loc', client_slug: clientSlug, branding: {}, settings }])
  return db
}

describe('resolveReviewSource: google', () => {
  it('builds a google source when both ids are configured and the token resolves', async () => {
    process.env.ACME_GOOGLE_BUSINESS_ACCESS_TOKEN = 'ya29_x'
    const resolved = await resolveReviewSource(
      dbWithLocation({ social: { googleAccountId: 'acc1', googleLocationId: 'gloc9' } }),
      'locA',
      'google',
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.reviewSource.source).toBe('google')
  })

  it('reports each missing piece honestly instead of throwing', async () => {
    process.env.ACME_GOOGLE_BUSINESS_ACCESS_TOKEN = 'ya29_x'
    expect(await resolveReviewSource(dbWithLocation({}), 'locA', 'google')).toEqual({
      ok: false,
      reason: 'google business account id is not configured',
    })
    expect(
      await resolveReviewSource(dbWithLocation({ social: { googleAccountId: 'acc1' } }), 'locA', 'google'),
    ).toEqual({ ok: false, reason: 'google business location id is not configured' })
    delete process.env.ACME_GOOGLE_BUSINESS_ACCESS_TOKEN
    expect(
      await resolveReviewSource(
        dbWithLocation({ social: { googleAccountId: 'acc1', googleLocationId: 'gloc9' } }),
        'locA',
        'google',
      ),
    ).toEqual({ ok: false, reason: 'google business access token is not configured' })
  })
})

describe('resolveReviewSource: facebook', () => {
  it('reuses the social facebook page id + page token the location already connected', async () => {
    process.env.ACME_FACEBOOK_PAGE_TOKEN = 'EAA_x'
    const resolved = await resolveReviewSource(
      dbWithLocation({ social: { facebookPageId: '1234' } }),
      'locA',
      'facebook',
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.reviewSource.source).toBe('facebook')
  })

  it('reports missing config with the same reason strings publishing uses', async () => {
    process.env.ACME_FACEBOOK_PAGE_TOKEN = 'EAA_x'
    expect(await resolveReviewSource(dbWithLocation({}), 'locA', 'facebook')).toEqual({
      ok: false,
      reason: 'facebook page id is not configured',
    })
    delete process.env.ACME_FACEBOOK_PAGE_TOKEN
    expect(
      await resolveReviewSource(dbWithLocation({ social: { facebookPageId: '1234' } }), 'locA', 'facebook'),
    ).toEqual({ ok: false, reason: 'facebook page token is not configured' })
  })
})

describe('resolveReviewSource: edges', () => {
  it('reports a source without an adapter honestly', async () => {
    const resolved = await resolveReviewSource(dbWithLocation({}), 'locA', 'yelp')
    expect(resolved).toEqual({ ok: false, reason: 'syncing reviews from yelp is not supported yet' })
  })

  it('falls back to the location slug when there is no client_slug', async () => {
    process.env.ACME_LOC_FACEBOOK_PAGE_TOKEN = 'EAA_x'
    try {
      const resolved = await resolveReviewSource(
        dbWithLocation({ social: { facebookPageId: '1234' } }, null),
        'locA',
        'facebook',
      )
      expect(resolved.ok).toBe(true)
    } finally {
      delete process.env.ACME_LOC_FACEBOOK_PAGE_TOKEN
    }
  })

  it('reports a missing location', async () => {
    const db = new FakeDatabase()
    db.enqueue([])
    expect(await resolveReviewSource(db, 'nope', 'google')).toEqual({
      ok: false,
      reason: 'location not found',
    })
  })
})
