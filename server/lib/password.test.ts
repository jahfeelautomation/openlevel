import { hashPassword, verifyPassword } from './password'

test('hash is not the plaintext and verifies for the right password', async () => {
  const h = await hashPassword('s3cret!')
  expect(h).not.toBe('s3cret!')
  expect(h.startsWith('$argon2')).toBe(true)
  expect(await verifyPassword(h, 's3cret!')).toBe(true)
})

test('verify returns false for the wrong password', async () => {
  const h = await hashPassword('s3cret!')
  expect(await verifyPassword(h, 'wrong')).toBe(false)
})

test('verify returns false for a malformed hash instead of throwing', async () => {
  expect(await verifyPassword('not-a-hash', 'x')).toBe(false)
})
