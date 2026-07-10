import { summarizeTasks, taskDueStatus } from './task-math'

// A fixed "now" so every case is deterministic regardless of the machine clock
// or timezone — the math compares by UTC calendar day.
const NOW = new Date('2026-06-03T18:00:00Z')

describe('taskDueStatus', () => {
  test('a completed task is done, even when its due date is in the past', () => {
    expect(
      taskDueStatus({ due_at: '2026-05-01T00:00:00Z', completed_at: '2026-06-02T12:00:00Z' }, NOW),
    ).toBe('done')
  })

  test('an open task with no due date has no due status', () => {
    expect(taskDueStatus({ due_at: null, completed_at: null }, NOW)).toBe('none')
  })

  test('due on an earlier calendar day is overdue', () => {
    expect(taskDueStatus({ due_at: '2026-06-02T23:00:00Z', completed_at: null }, NOW)).toBe(
      'overdue',
    )
  })

  test('due today is today even if the time of day has already passed', () => {
    expect(taskDueStatus({ due_at: '2026-06-03T08:00:00Z', completed_at: null }, NOW)).toBe('today')
    expect(taskDueStatus({ due_at: '2026-06-03T23:30:00Z', completed_at: null }, NOW)).toBe('today')
  })

  test('due on a later calendar day is upcoming', () => {
    expect(taskDueStatus({ due_at: '2026-06-04T01:00:00Z', completed_at: null }, NOW)).toBe(
      'upcoming',
    )
  })

  test('an unparseable due date is treated as no due date, never a throw', () => {
    expect(taskDueStatus({ due_at: 'not-a-date', completed_at: null }, NOW)).toBe('none')
  })
})

describe('summarizeTasks', () => {
  test('folds a mixed set into honest KPI counts with upcoming as the remainder', () => {
    const s = summarizeTasks(
      [
        { due_at: '2026-06-01T00:00:00Z', completed_at: null }, // overdue
        { due_at: '2026-06-02T00:00:00Z', completed_at: null }, // overdue
        { due_at: '2026-06-03T09:00:00Z', completed_at: null }, // today
        { due_at: '2026-06-10T00:00:00Z', completed_at: null }, // upcoming
        { due_at: null, completed_at: null }, // open, no due -> upcoming bucket
        { due_at: '2026-05-20T00:00:00Z', completed_at: '2026-05-21T00:00:00Z' }, // completed
      ],
      NOW,
    )
    expect(s).toEqual({ open: 5, overdue: 2, dueToday: 1, upcoming: 2, completed: 1 })
  })

  test('an empty set is an honest all-zero', () => {
    expect(summarizeTasks([], NOW)).toEqual({
      open: 0,
      overdue: 0,
      dueToday: 0,
      upcoming: 0,
      completed: 0,
    })
  })
})
