import { loadConfig } from './config'

test('applies dev defaults and coerces PORT from a string', () => {
  const c = loadConfig({ PORT: '9001' })
  expect(c.PORT).toBe(9001)
  expect(c.SESSION_SECRET).toBe('dev-only-change-me')
  expect(c.CHATWOOT_WEBHOOK_SECRET).toBe('dev-secret')
  expect(c.NODE_ENV).toBe('development')
  expect(c.DATABASE_URL).toBeUndefined()
})

const STRONG = 'x'.repeat(32)

test('reads provided values over defaults', () => {
  const c = loadConfig({
    SESSION_SECRET: STRONG,
    CHATWOOT_WEBHOOK_SECRET: STRONG,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://x',
  })
  expect(c.SESSION_SECRET).toBe(STRONG)
  expect(c.NODE_ENV).toBe('production')
  expect(c.DATABASE_URL).toBe('postgres://x')
  expect(c.PORT).toBe(8790)
})

test('rejects the dev-default SESSION_SECRET in production', () => {
  expect(() =>
    loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'dev-only-change-me', CHATWOOT_WEBHOOK_SECRET: STRONG }),
  ).toThrow(/SESSION_SECRET/)
})

test('rejects the dev-default CHATWOOT_WEBHOOK_SECRET in production', () => {
  expect(() =>
    loadConfig({ NODE_ENV: 'production', SESSION_SECRET: STRONG, CHATWOOT_WEBHOOK_SECRET: 'dev-secret' }),
  ).toThrow(/CHATWOOT_WEBHOOK_SECRET/)
})

test('rejects a too-short secret in production', () => {
  expect(() =>
    loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short', CHATWOOT_WEBHOOK_SECRET: STRONG }),
  ).toThrow(/32 characters/)
})

test('allows a short non-default secret outside production', () => {
  const c = loadConfig({ NODE_ENV: 'development', SESSION_SECRET: 'short-dev' })
  expect(c.SESSION_SECRET).toBe('short-dev')
})

test('FEDERATION_SERVICE_TOKEN is undefined when unset (federation stays inert)', () => {
  const cfg = loadConfig({ NODE_ENV: 'development' })
  expect(cfg.FEDERATION_SERVICE_TOKEN).toBeUndefined()
})

test('FEDERATION_SERVICE_TOKEN passes through when set', () => {
  const cfg = loadConfig({ NODE_ENV: 'development', FEDERATION_SERVICE_TOKEN: 'tok-123' })
  expect(cfg.FEDERATION_SERVICE_TOKEN).toBe('tok-123')
})

test('a too-short FEDERATION_SERVICE_TOKEN is rejected in production', () => {
  expect(() =>
    loadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'x'.repeat(32),
      CHATWOOT_WEBHOOK_SECRET: 'y'.repeat(32),
      FEDERATION_SERVICE_TOKEN: 'short',
    }),
  ).toThrow(/FEDERATION_SERVICE_TOKEN/)
})
