import { reviewStats } from './review-math'

test('an empty list is an honest zero — no invented reviews', () => {
  const s = reviewStats([])
  expect(s.count).toBe(0)
  expect(s.average).toBe(0)
  expect(s.distribution).toEqual({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 })
})

test('a single review carries its own rating as the average', () => {
  const s = reviewStats([{ rating: 5 }])
  expect(s.count).toBe(1)
  expect(s.average).toBe(5)
  expect(s.distribution[5]).toBe(1)
})

test('averages across reviews and buckets the distribution', () => {
  const s = reviewStats([{ rating: 5 }, { rating: 4 }, { rating: 5 }, { rating: 4 }])
  expect(s.count).toBe(4)
  expect(s.average).toBe(4.5) // 18 / 4
  expect(s.distribution).toEqual({ 5: 2, 4: 2, 3: 0, 2: 0, 1: 0 })
})

test('rounds the average to one decimal place', () => {
  const s = reviewStats([{ rating: 5 }, { rating: 5 }, { rating: 4 }]) // 14 / 3 = 4.666…
  expect(s.average).toBe(4.7)
})

test('ignores out-of-range ratings defensively (DB already constrains 1–5)', () => {
  const s = reviewStats([{ rating: 5 }, { rating: 0 }, { rating: 6 }, { rating: 3 }])
  expect(s.count).toBe(2)
  expect(s.average).toBe(4) // (5 + 3) / 2
  expect(s.distribution).toEqual({ 5: 1, 4: 0, 3: 1, 2: 0, 1: 0 })
})
