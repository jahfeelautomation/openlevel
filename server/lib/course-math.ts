/**
 * Honest progress math for the Memberships module. A learner's "62% complete" is
 * COMPUTED here from two real facts — how many of a course's lessons they've
 * actually finished, over how many lessons the course holds — and is never
 * stored. That keeps the figure from drifting from the completions that justify
 * it and makes it impossible to inflate: deleting a lesson can only re-derive a
 * truthful number, and re-marking a lesson does nothing (completions are unique
 * per lesson at the DB). The same honesty-by-construction rule the review average
 * and the invoice total follow. Everything here is pure (numbers in, numbers
 * out), so it is trivially testable and side-effect free.
 */

export interface EnrollmentProgress {
  /** Lessons the course holds. */
  total: number
  /** Lessons this enrollee has finished (clamped to `total`). */
  completed: number
  /** Whole-percent progress, 0–100; 0 when the course has no lessons. */
  percent: number
  /** True only when every lesson of a non-empty course is finished. */
  complete: boolean
}

/** Derive one enrollee's progress from their completion count and the course's
 *  lesson count. Inputs are floored at 0 and `completed` is capped at `total`, so
 *  a stale completion outliving a deleted lesson can never push past 100%. */
export function enrollmentProgress(completed: number, total: number): EnrollmentProgress {
  const t = Math.max(0, Math.trunc(total))
  const c = Math.min(t, Math.max(0, Math.trunc(completed)))
  const percent = t === 0 ? 0 : Math.round((c / t) * 100)
  return { total: t, completed: c, percent, complete: t > 0 && c >= t }
}

export interface CourseProgressSummary {
  /** How many enrollees the course has. */
  enrollments: number
  /** Mean of the enrollees' percent figures; 0 when there are none. */
  averagePercent: number
  /** How many enrollees have finished every lesson. */
  completed: number
}

/** Roll the per-enrollment figures up to the course card the operator sees. The
 *  average is over the real enrollee percents, so an empty course is an honest 0
 *  — never a flattering guess. */
export function courseProgressSummary(progresses: EnrollmentProgress[]): CourseProgressSummary {
  const enrollments = progresses.length
  if (enrollments === 0) return { enrollments: 0, averagePercent: 0, completed: 0 }
  const sum = progresses.reduce((acc, p) => acc + p.percent, 0)
  const completed = progresses.reduce((acc, p) => acc + (p.complete ? 1 : 0), 0)
  return { enrollments, averagePercent: Math.round(sum / enrollments), completed }
}
