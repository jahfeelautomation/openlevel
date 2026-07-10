import type { CourseListItem } from '../../lib/api'

/** Catalog-wide totals for the KPI band, summed from the per-course rollups the
 *  server already derived. Every figure is a real count — courses, how many are
 *  live, total students across all courses, total course completions. Nothing is
 *  averaged into a vanity number; an empty catalog reads as honest zeros. */
export interface CatalogTotals {
  courses: number
  published: number
  students: number
  completed: number
}

export function catalogTotals(courses: CourseListItem[]): CatalogTotals {
  return courses.reduce<CatalogTotals>(
    (acc, c) => ({
      courses: acc.courses + 1,
      published: acc.published + (c.status === 'published' ? 1 : 0),
      students: acc.students + c.summary.enrollments,
      completed: acc.completed + c.summary.completed,
    }),
    { courses: 0, published: 0, students: 0, completed: 0 },
  )
}

/** Bar colour for a derived progress percent — a gentle ramp from brand (just
 *  started) to emerald (finished). Purely cosmetic; never changes the number. */
export function progressTone(percent: number): string {
  if (percent >= 100) return 'bg-emerald-500'
  if (percent >= 50) return 'bg-brand-500'
  return 'bg-brand-400'
}

export function statusLabel(status: string): string {
  return status === 'published' ? 'Published' : 'Draft'
}
