import type { Database } from '../../db/database'
import { resolveSocialPublisher, type ResolvedSocialPublisher } from './resolve'

export interface PublishTargetInput {
  accountId: string
  platform: string
}

export interface TargetOutcome {
  accountId: string
  platform: string
  status: 'published' | 'failed'
  /** The honest failure reason — null when the post went out. */
  detail: string | null
  /** The provider's id for the live post — null when it did not go out. */
  externalId: string | null
}

export type PublishSocialPostResult =
  | { ok: true; outcomes: TargetOutcome[]; publishedCount: number }
  | { ok: false; reason: string }

export interface PublishSocialPostDeps {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolver. */
  resolvePublisher?: typeof resolveSocialPublisher
  /** Pause between provider calls so a multi-channel post is not a burst. */
  throttleMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface PublishSocialPostInput {
  locationId: string
  post: { body: string; mediaUrl?: string }
  targets: PublishTargetInput[]
}

const DEFAULT_THROTTLE_MS = 100
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Publish one post to every selected channel through the LOCATION's own
 * adapters — the social mirror of sendCampaign. Targets are isolated: one
 * channel failing (or being unconfigured) never blocks the others, and each
 * target gets an honest recorded outcome. Only when NOTHING published does the
 * whole call report ok:false, so the route can refuse and leave the post in
 * its prior status instead of marking it published on zero deliveries.
 */
export async function publishSocialPost(
  deps: PublishSocialPostDeps,
  input: PublishSocialPostInput,
): Promise<PublishSocialPostResult> {
  if (input.targets.length === 0) {
    return { ok: false, reason: 'no channels selected — add at least one channel to this post' }
  }

  const resolvePublisher = deps.resolvePublisher ?? resolveSocialPublisher
  const throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE_MS
  const sleep = deps.sleep ?? defaultSleep

  // One resolve per platform — several targets on the same platform (rare but
  // legal) share the publisher instead of re-reading settings + vault.
  const resolved = new Map<string, ResolvedSocialPublisher>()
  for (const target of input.targets) {
    if (!resolved.has(target.platform)) {
      resolved.set(target.platform, await resolvePublisher(deps.db, input.locationId, target.platform))
    }
  }

  const message = { text: input.post.body, mediaUrl: input.post.mediaUrl }
  const outcomes: TargetOutcome[] = []
  let sentAnyProviderCall = false

  for (const target of input.targets) {
    const resolution = resolved.get(target.platform)
    if (!resolution || !resolution.ok) {
      outcomes.push({
        accountId: target.accountId,
        platform: target.platform,
        status: 'failed',
        detail: resolution && !resolution.ok ? resolution.reason : 'channel is not configured',
        externalId: null,
      })
      continue
    }

    if (sentAnyProviderCall && throttleMs > 0) await sleep(throttleMs)
    sentAnyProviderCall = true

    try {
      const published = await resolution.publisher.publish(message)
      outcomes.push({
        accountId: target.accountId,
        platform: target.platform,
        status: 'published',
        detail: null,
        externalId: published.externalId,
      })
    } catch (err) {
      outcomes.push({
        accountId: target.accountId,
        platform: target.platform,
        status: 'failed',
        detail: err instanceof Error ? err.message : 'publish failed',
        externalId: null,
      })
    }
  }

  const publishedCount = outcomes.filter((o) => o.status === 'published').length
  if (publishedCount === 0) {
    const reasons = [...new Set(outcomes.map((o) => o.detail).filter((d): d is string => d !== null))]
    return { ok: false, reason: reasons.join('; ') }
  }
  return { ok: true, outcomes, publishedCount }
}
