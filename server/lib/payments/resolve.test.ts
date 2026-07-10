import { afterEach, describe, expect, it } from 'vitest'
import { FakeDatabase } from '../../db/fake-database'
import { resolvePaymentProvider } from './resolve'

// Secrets resolve by NAME via the env-backed vault layer: <slug>:stripe:secret_key
// -> ACME_STRIPE_SECRET_KEY. client_slug wins over slug, same as agent-reply.
const ENV_KEYS = [
  'ACME_STRIPE_SECRET_KEY',
  'ACME_STRIPE_WEBHOOK_SECRET',
  'ACME_SQUARE_ACCESS_TOKEN',
  'ACME_SQUARE_WEBHOOK_SIGNATURE_KEY',
]

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

function dbWithLocation(settings: Record<string, unknown>, clientSlug: string | null = 'acme') {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', name: 'Acme', slug: 'acme-loc', client_slug: clientSlug, branding: {}, settings }])
  return db
}

describe('resolvePaymentProvider', () => {
  it('builds a stripe adapter when the location chose stripe and both keys resolve', async () => {
    process.env.ACME_STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.ACME_STRIPE_WEBHOOK_SECRET = 'whsec_x'
    const resolved = await resolvePaymentProvider(dbWithLocation({ payments: { provider: 'stripe' } }), 'locA')

    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.provider.name).toBe('stripe')
  })

  it('reports unconfigured stripe keys instead of throwing', async () => {
    const resolved = await resolvePaymentProvider(dbWithLocation({ payments: { provider: 'stripe' } }), 'locA')
    expect(resolved).toEqual({ ok: false, reason: 'stripe keys are not configured' })
  })

  it('builds a square adapter when keys + square location id are present', async () => {
    process.env.ACME_SQUARE_ACCESS_TOKEN = 'sq_tok'
    process.env.ACME_SQUARE_WEBHOOK_SIGNATURE_KEY = 'sq_sig'
    const resolved = await resolvePaymentProvider(
      dbWithLocation({ payments: { provider: 'square', squareLocationId: 'SQ_LOC' } }),
      'locA',
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.provider.name).toBe('square')
  })

  it('requires the square location id even when the keys resolve', async () => {
    process.env.ACME_SQUARE_ACCESS_TOKEN = 'sq_tok'
    process.env.ACME_SQUARE_WEBHOOK_SIGNATURE_KEY = 'sq_sig'
    const resolved = await resolvePaymentProvider(dbWithLocation({ payments: { provider: 'square' } }), 'locA')
    expect(resolved).toEqual({ ok: false, reason: 'square location id is not configured' })
  })

  it('falls back to the location slug when there is no client_slug', async () => {
    process.env.ACME_LOC_STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.ACME_LOC_STRIPE_WEBHOOK_SECRET = 'whsec_x'
    try {
      const resolved = await resolvePaymentProvider(
        dbWithLocation({ payments: { provider: 'stripe' } }, null),
        'locA',
      )
      expect(resolved.ok).toBe(true)
    } finally {
      delete process.env.ACME_LOC_STRIPE_SECRET_KEY
      delete process.env.ACME_LOC_STRIPE_WEBHOOK_SECRET
    }
  })

  it('reports no provider connected for a fresh location', async () => {
    const resolved = await resolvePaymentProvider(dbWithLocation({}), 'locA')
    expect(resolved).toEqual({ ok: false, reason: 'no payment provider connected' })
  })

  it('reports a missing location', async () => {
    const db = new FakeDatabase()
    db.enqueue([])
    const resolved = await resolvePaymentProvider(db, 'nope')
    expect(resolved).toEqual({ ok: false, reason: 'location not found' })
  })
})
