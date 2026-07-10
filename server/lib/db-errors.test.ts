import { isUniqueViolation } from './db-errors'

test('a Postgres unique-violation SQLSTATE (23505) is recognised', () => {
  expect(isUniqueViolation({ code: '23505' })).toBe(true)
})

test('a duplicate-key message is recognised even when the code is absent', () => {
  expect(
    isUniqueViolation(new Error('duplicate key value violates unique constraint "x"')),
  ).toBe(true)
})

test('a different SQLSTATE is not a unique violation (so the caller rethrows)', () => {
  expect(isUniqueViolation({ code: '23503' })).toBe(false) // foreign-key violation
  expect(isUniqueViolation({ code: '42P01' })).toBe(false) // undefined table
})

test('non-object errors are never unique violations', () => {
  expect(isUniqueViolation(null)).toBe(false)
  expect(isUniqueViolation(undefined)).toBe(false)
  expect(isUniqueViolation('boom')).toBe(false)
  expect(isUniqueViolation(23505)).toBe(false)
})
