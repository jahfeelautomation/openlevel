import type { BadgeProps } from '../../components/ui/badge'
import type { ReviewModerationStatus, ReviewRequest, StarBucket } from '../../lib/api'

/** Star buckets in display order (5 at the top, like every reviews UI). */
export const RATING_BUCKETS: StarBucket[] = [5, 4, 3, 2, 1]

/** How each moderation status reads + colors. Hiding a review is moderation only;
 *  it never changes the rating, so it can't move the derived average. */
export const REVIEW_STATUS_META: Record<
  ReviewModerationStatus,
  { label: string; badge: BadgeProps['variant'] }
> = {
  published: { label: 'Published', badge: 'green' },
  hidden: { label: 'Hidden', badge: 'slate' },
}

export function reviewStatusMeta(status: string): { label: string; badge: BadgeProps['variant'] } {
  return REVIEW_STATUS_META[status as ReviewModerationStatus] ?? { label: status, badge: 'slate' }
}

/** Human label for where a review came from. */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'direct':
      return 'Direct'
    case 'google':
      return 'Google'
    case 'facebook':
      return 'Facebook'
    default:
      return source.charAt(0).toUpperCase() + source.slice(1)
  }
}

/**
 * Response rate over the requests we actually sent — completed ÷ total, as a
 * whole-number percent. This is a real count, not a guess: an unsent or
 * unanswered request stays in the denominator, so the figure can't be inflated.
 */
export function responseRate(requests: ReviewRequest[]): {
  completed: number
  total: number
  rate: number
} {
  const total = requests.length
  const completed = requests.filter((r) => r.status === 'completed').length
  return { completed, total, rate: total === 0 ? 0 : Math.round((completed / total) * 100) }
}
