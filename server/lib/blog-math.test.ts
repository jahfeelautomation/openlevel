import { readingTimeMinutes, wordCount } from './blog-math'

describe('wordCount', () => {
  test('counts whitespace-delimited words', () => {
    expect(wordCount('the quick brown fox')).toBe(4)
  })

  test('collapses runs of whitespace and ignores leading/trailing space', () => {
    expect(wordCount('  one\n\ntwo   three\tfour  ')).toBe(4)
  })

  test('empty, whitespace-only, null and undefined are an honest 0', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('   \n\t ')).toBe(0)
    expect(wordCount(null)).toBe(0)
    expect(wordCount(undefined)).toBe(0)
  })
})

describe('readingTimeMinutes', () => {
  test('rounds up to whole minutes at 200 wpm', () => {
    // 201 words -> 1.005 min -> ceil -> 2
    const body = Array.from({ length: 201 }, () => 'word').join(' ')
    expect(readingTimeMinutes(body)).toBe(2)
  })

  test('a short non-empty post is a floor of 1 min, never 0', () => {
    expect(readingTimeMinutes('just a few words here')).toBe(1)
  })

  test('exactly 200 words is 1 minute', () => {
    const body = Array.from({ length: 200 }, () => 'word').join(' ')
    expect(readingTimeMinutes(body)).toBe(1)
  })

  test('an empty post is an honest 0 min — there is nothing to read', () => {
    expect(readingTimeMinutes('')).toBe(0)
    expect(readingTimeMinutes(null)).toBe(0)
    expect(readingTimeMinutes(undefined)).toBe(0)
  })
})
