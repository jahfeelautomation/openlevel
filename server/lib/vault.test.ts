import { resolveSecret } from './vault'

test('resolveSecret reads an env var derived from the item name', () => {
  process.env.JAMAL_CHATWOOT_API_TOKEN = 'shh'
  expect(resolveSecret('jamal:chatwoot:api_token')).toBe('shh')
  delete process.env.JAMAL_CHATWOOT_API_TOKEN
})

test('resolveSecret returns undefined when the secret is absent', () => {
  expect(resolveSecret('nope:does:not:exist')).toBeUndefined()
})
