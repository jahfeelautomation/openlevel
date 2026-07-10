/**
 * Derived call-log aggregates (Module 52). Like review-math: the KPI band is
 * computed from the real call rows on every read — never a stored counter that
 * can drift from the log it claims to summarize.
 */

export interface CallStatsInput {
  direction: string
  status: string
  duration_seconds: number | null
}

export interface CallStats {
  total: number
  inbound: number
  outbound: number
  /** Calls that actually connected and ran to the end. */
  completed: number
  /** completed / total as a whole percent. 0 when there are no calls. */
  connectedRate: number
  /** Mean over the calls that reported a duration. 0 when none have yet. */
  avgDurationSeconds: number
}

export function callStats(calls: CallStatsInput[]): CallStats {
  const total = calls.length
  const inbound = calls.filter((c) => c.direction === 'inbound').length
  const completed = calls.filter((c) => c.status === 'completed').length
  const timed = calls.filter((c) => typeof c.duration_seconds === 'number')
  const totalSeconds = timed.reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0)
  return {
    total,
    inbound,
    outbound: total - inbound,
    completed,
    connectedRate: total ? Math.round((completed / total) * 100) : 0,
    avgDurationSeconds: timed.length ? Math.round(totalSeconds / timed.length) : 0,
  }
}
