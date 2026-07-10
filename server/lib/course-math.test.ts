import { courseProgressSummary, enrollmentProgress } from './course-math'

describe('enrollmentProgress', () => {
  test('derives a whole-percent figure from completed over total', () => {
    expect(enrollmentProgress(3, 8)).toEqual({
      total: 8,
      completed: 3,
      percent: 38, // 37.5 rounds to 38
      complete: false,
    })
  })

  test('all lessons done is 100% and flagged complete', () => {
    expect(enrollmentProgress(5, 5)).toEqual({
      total: 5,
      completed: 5,
      percent: 100,
      complete: true,
    })
  })

  test('no completions is an honest 0%, not complete', () => {
    expect(enrollmentProgress(0, 4)).toEqual({
      total: 4,
      completed: 0,
      percent: 0,
      complete: false,
    })
  })

  test('a course with no lessons is 0% and never "complete"', () => {
    // A course you cannot finish must not report itself finished.
    expect(enrollmentProgress(0, 0)).toEqual({
      total: 0,
      completed: 0,
      percent: 0,
      complete: false,
    })
  })

  test('clamps stray completions above the lesson count to total', () => {
    // Defensive: even if a stale completion outlives a deleted lesson, progress
    // can never exceed 100% or imply more done than the course holds.
    expect(enrollmentProgress(9, 5)).toEqual({
      total: 5,
      completed: 5,
      percent: 100,
      complete: true,
    })
  })

  test('ignores negative inputs defensively', () => {
    expect(enrollmentProgress(-3, -2)).toEqual({
      total: 0,
      completed: 0,
      percent: 0,
      complete: false,
    })
  })
})

describe('courseProgressSummary', () => {
  test('counts enrollments, averages percent, counts the fully complete', () => {
    const summary = courseProgressSummary([
      enrollmentProgress(5, 5), // 100, complete
      enrollmentProgress(2, 5), // 40
      enrollmentProgress(0, 5), // 0
    ])
    expect(summary).toEqual({
      enrollments: 3,
      averagePercent: 47, // (100 + 40 + 0) / 3 = 46.67 -> 47
      completed: 1,
    })
  })

  test('no enrollments is an honest zero across the board', () => {
    expect(courseProgressSummary([])).toEqual({
      enrollments: 0,
      averagePercent: 0,
      completed: 0,
    })
  })
})
