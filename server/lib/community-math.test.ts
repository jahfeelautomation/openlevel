import { communityRollup, postCounts, topChannel } from './community-math'

test('communityRollup returns the two real counts', () => {
  expect(communityRollup(128, 42)).toEqual({ members: 128, posts: 42 })
})

test('communityRollup is an honest zero for an empty community', () => {
  expect(communityRollup(0, 0)).toEqual({ members: 0, posts: 0 })
})

test('communityRollup clamps negatives and fractions to non-negative integers', () => {
  expect(communityRollup(-3, 4.9)).toEqual({ members: 0, posts: 4 })
  expect(communityRollup(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ members: 0, posts: 0 })
})

test('postCounts returns real like + comment tallies', () => {
  expect(postCounts(12, 5)).toEqual({ likes: 12, comments: 5 })
})

test('postCounts clamps to non-negative integers', () => {
  expect(postCounts(-1, 2.7)).toEqual({ likes: 0, comments: 2 })
})

test('topChannel picks the channel with the most posts', () => {
  expect(
    topChannel([
      { name: 'General', postCount: 3 },
      { name: 'Wins', postCount: 9 },
      { name: 'Intros', postCount: 1 },
    ]),
  ).toBe('Wins')
})

test('topChannel returns null when there are no channels', () => {
  expect(topChannel([])).toBeNull()
})

test('topChannel returns null when every channel is empty (never invents activity)', () => {
  expect(
    topChannel([
      { name: 'General', postCount: 0 },
      { name: 'Wins', postCount: 0 },
    ]),
  ).toBeNull()
})

test('topChannel breaks ties toward the first channel given (stable, deterministic)', () => {
  expect(
    topChannel([
      { name: 'General', postCount: 4 },
      { name: 'Wins', postCount: 4 },
    ]),
  ).toBe('General')
})
