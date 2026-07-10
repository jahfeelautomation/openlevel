// Shared funnel vocabulary: the closed set of step types a funnel page can be,
// and the publish states. Plain string unions (not a DB enum) so the set can
// grow without a migration; routes validate against these arrays with Zod and
// the web UI mirrors the labels.

export const FUNNEL_STEP_TYPES = ['opt_in', 'thank_you', 'sales'] as const
export const FUNNEL_STATUSES = ['draft', 'published'] as const

export type FunnelStepType = (typeof FUNNEL_STEP_TYPES)[number]
export type FunnelStatus = (typeof FUNNEL_STATUSES)[number]

export const FUNNEL_STEP_LABELS: Record<FunnelStepType, string> = {
  opt_in: 'Opt-in',
  thank_you: 'Thank you',
  sales: 'Sales page',
}
