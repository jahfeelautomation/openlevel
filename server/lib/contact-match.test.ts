import { normalizePhone, normalizeEmail, matchKey } from './contact-match'

test('phone normalizes to E.164-ish digits', () => {
  expect(normalizePhone('(503) 555-0199')).toBe('+15035550199')
  expect(normalizePhone('+1 503 555 0199')).toBe('+15035550199')
  expect(normalizePhone('5035550199')).toBe('+15035550199')
  expect(normalizePhone('15035550199')).toBe('+15035550199')
})

test('email lowercases + trims', () => {
  expect(normalizeEmail('  Bob@Email.COM ')).toBe('bob@email.com')
})

test('matchKey prefers phone then email, scoped to location', () => {
  expect(matchKey('locA', { phone: '(503) 555-0199' })).toBe('locA|phone|+15035550199')
  expect(matchKey('locA', { email: 'Bob@x.com' })).toBe('locA|email|bob@x.com')
  expect(matchKey('locA', { phone: '5035550199', email: 'bob@x.com' })).toBe('locA|phone|+15035550199')
  expect(matchKey('locA', {})).toBeNull()
})

test('a digit-free phone does not become a key — it falls through to email then null', () => {
  // junk phones all normalize to a bare "+"; keying on that would merge every
  // such contact into one record. They must not produce a phone key.
  expect(matchKey('locA', { phone: '   ' })).toBeNull()
  expect(matchKey('locA', { phone: '()-' })).toBeNull()
  expect(matchKey('locA', { phone: 'call me' })).toBeNull()
  // a junk phone with a real email keys on the email instead of colliding on "+"
  expect(matchKey('locA', { phone: ' ', email: 'bob@x.com' })).toBe('locA|email|bob@x.com')
})

test('an empty/whitespace email is not a key either', () => {
  expect(matchKey('locA', { email: '   ' })).toBeNull()
  expect(matchKey('locA', { phone: 'xx', email: '' })).toBeNull()
})
