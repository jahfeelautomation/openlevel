/**
 * In-memory sliding-window rate limiter. Tracks the timestamps of recent hits
 * per key, prunes those older than the window, and allows up to `max` hits
 * within any rolling window. Per-process (no shared store) — correct and cheap
 * for a single-instance deploy; swap the store for Redis if the app is scaled
 * horizontally. Time is passed in explicitly so the limiter is deterministic
 * and trivially testable.
 */
export interface RateLimitResult {
  allowed: boolean
  /** Hits still available in the current window (0 when blocked). */
  remaining: number
  /** Milliseconds until the oldest counted hit ages out (0 when allowed). */
  retryAfterMs: number
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Record a hit for `key` at time `now` (epoch ms) and report the verdict. */
  check(key: string, now: number): RateLimitResult {
    const cutoff = now - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff)

    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      const oldest = recent[0] ?? now
      return { allowed: false, remaining: 0, retryAfterMs: oldest + this.windowMs - now }
    }

    recent.push(now)
    this.hits.set(key, recent)
    return { allowed: true, remaining: this.max - recent.length, retryAfterMs: 0 }
  }

  /** Forget a single key, or every key when called with no argument. */
  reset(key?: string): void {
    if (key === undefined) this.hits.clear()
    else this.hits.delete(key)
  }
}
