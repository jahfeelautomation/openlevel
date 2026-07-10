import { afterEach, describe, expect, it } from 'vitest'
import { FakeDatabase } from '../../db/fake-database'
import { resolveSocialPublisher } from './resolve'

// Secrets resolve by NAME via the env-backed vault layer, same as payments and
// sending: <slug>:facebook:page_token -> ACME_FACEBOOK_PAGE_TOKEN. The ids that
// are not secrets (page id, IG account id, LinkedIn author) live in
// settings.social, operator-editable.
const ENV_KEYS = [
  'ACME_FACEBOOK_PAGE_TOKEN',
  'ACME_INSTAGRAM_ACCESS_TOKEN',
  'ACME_LINKEDIN_ACCESS_TOKEN',
  'ACME_X_ACCESS_TOKEN',
]

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

function dbWithLocation(settings: Record<string, unknown>, clientSlug: string | null = 'acme') {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', name: 'Acme', slug: 'acme-loc', client_slug: clientSlug, branding: {}, settings }])
  return db
}

describe('resolveSocialPublisher: facebook', () => {
  it('builds a facebook publisher when the page id is configured and the token resolves', async () => {
    process.env.ACME_FACEBOOK_PAGE_TOKEN = 'EAA_x'
    const resolved = await resolveSocialPublisher(
      dbWithLocation({ social: { facebookPageId: '1234' } }),
      'locA',
      'facebook',
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.publisher.platform).toBe('facebook')
  })

  it('reports a missing page id instead of throwing', async () => {
    process.env.ACME_FACEBOOK_PAGE_TOKEN = 'EAA_x'
    const resolved = await resolveSocialPublisher(dbWithLocation({}), 'locA', 'facebook')
    expect(resolved).toEqual({ ok: false, reason: 'facebook page id is not configured' })
  })

  it('reports an unconfigured page token instead of throwing', async () => {
    const resolved = await resolveSocialPublisher(
      dbWithLocation({ social: { facebookPageId: '1234' } }),
      'locA',
      'facebook',
    )
    expect(resolved).toEqual({ ok: false, reason: 'facebook page token is not configured' })
  })
})

describe('resolveSocialPublisher: instagram', () => {
  it('builds an instagram publisher when the account id is configured and the token resolves', async () => {
    process.env.ACME_INSTAGRAM_ACCESS_TOKEN = 'IG_x'
    const resolved = await resolveSocialPublisher(
      dbWithLocation({ social: { instagramUserId: '178414' } }),
      'locA',
      'instagram',
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.publisher.platform).toBe('instagram')
  })

  it('reports a missing account id and a missing token honestly', async () => {
    process.env.ACME_INSTAGRAM_ACCESS_TOKEN = 'IG_x'
    expect(await resolveSocialPublisher(dbWithLocation({}), 'locA', 'instagram')).toEqual({
      ok: false,
      reason: 'instagram account id is not configured',
    })
    delete process.env.ACME_INSTAGRAM_ACCESS_TOKEN
    expect(
      await resolveSocialPublisher(dbWithLocation({ social: { instagramUserId: '178414' } }), 'locA', 'instagram'),
    ).toEqual({ ok: false, reason: 'instagram access token is not configured' })
  })
})

describe('resolveSocialPublisher: linkedin', () => {
  it('builds a linkedin publisher when the author urn is configured and the token resolves', async () => {
    process.env.ACME_LINKEDIN_ACCESS_TOKEN = 'LI_x'
    const resolved = await resolveSocialPublisher(
      dbWithLocation({ social: { linkedinAuthorUrn: 'urn:li:organization:5515715' } }),
      'locA',
      'linkedin',
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.publisher.platform).toBe('linkedin')
  })

  it('reports a missing author urn and a missing token honestly', async () => {
    process.env.ACME_LINKEDIN_ACCESS_TOKEN = 'LI_x'
    expect(await resolveSocialPublisher(dbWithLocation({}), 'locA', 'linkedin')).toEqual({
      ok: false,
      reason: 'linkedin author urn is not configured',
    })
    delete process.env.ACME_LINKEDIN_ACCESS_TOKEN
    expect(
      await resolveSocialPublisher(
        dbWithLocation({ social: { linkedinAuthorUrn: 'urn:li:organization:5515715' } }),
        'locA',
        'linkedin',
      ),
    ).toEqual({ ok: false, reason: 'linkedin access token is not configured' })
  })
})

describe('resolveSocialPublisher: x', () => {
  it('builds an x publisher from the vault token alone (no non-secret config needed)', async () => {
    process.env.ACME_X_ACCESS_TOKEN = 'X_x'
    const resolved = await resolveSocialPublisher(dbWithLocation({}), 'locA', 'x')
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.publisher.platform).toBe('x')
  })

  it('reports an unconfigured token instead of throwing', async () => {
    const resolved = await resolveSocialPublisher(dbWithLocation({}), 'locA', 'x')
    expect(resolved).toEqual({ ok: false, reason: 'x access token is not configured' })
  })
})

describe('resolveSocialPublisher: edges', () => {
  it('reports a platform without an adapter honestly', async () => {
    const resolved = await resolveSocialPublisher(dbWithLocation({}), 'locA', 'tiktok')
    expect(resolved).toEqual({ ok: false, reason: 'publishing to tiktok is not supported yet' })
  })

  it('falls back to the location slug when there is no client_slug', async () => {
    process.env.ACME_LOC_X_ACCESS_TOKEN = 'X_x'
    try {
      const resolved = await resolveSocialPublisher(dbWithLocation({}, null), 'locA', 'x')
      expect(resolved.ok).toBe(true)
    } finally {
      delete process.env.ACME_LOC_X_ACCESS_TOKEN
    }
  })

  it('reports a missing location', async () => {
    const db = new FakeDatabase()
    db.enqueue([])
    expect(await resolveSocialPublisher(db, 'nope', 'facebook')).toEqual({
      ok: false,
      reason: 'location not found',
    })
  })
})
