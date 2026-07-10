import { SlidingWindowRateLimiter } from './rate-limit'

test('allows up to max hits inside the window, then blocks', () => {
  const rl = new SlidingWindowRateLimiter(3, 1000)
  expect(rl.check('ip', 0).allowed).toBe(true)
  expect(rl.check('ip', 100).allowed).toBe(true)
  expect(rl.check('ip', 200).allowed).toBe(true)
  const blocked = rl.check('ip', 300)
  expect(blocked.allowed).toBe(false)
  expect(blocked.retryAfterMs).toBe(700) // oldest hit (t=0) leaves the window at t=1000
})

test('lets requests through again once the window slides past old hits', () => {
  const rl = new SlidingWindowRateLimiter(2, 1000)
  expect(rl.check('ip', 0).allowed).toBe(true)
  expect(rl.check('ip', 500).allowed).toBe(true)
  expect(rl.check('ip', 600).allowed).toBe(false)
  // t=0 hit ages out at t=1001; only the t=500 hit remains, so this is allowed.
  expect(rl.check('ip', 1001).allowed).toBe(true)
})

test('tracks each key independently', () => {
  const rl = new SlidingWindowRateLimiter(1, 1000)
  expect(rl.check('a', 0).allowed).toBe(true)
  expect(rl.check('b', 0).allowed).toBe(true)
  expect(rl.check('a', 1).allowed).toBe(false)
})

test('reset clears a single key or all keys', () => {
  const rl = new SlidingWindowRateLimiter(1, 1000)
  rl.check('a', 0)
  rl.reset('a')
  expect(rl.check('a', 1).allowed).toBe(true)
  rl.check('a', 2)
  rl.reset()
  expect(rl.check('a', 3).allowed).toBe(true)
})
