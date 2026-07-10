/**
 * notify-push.ts — fire-and-forget trigger that asks the nerve-survey gateway to
 * fan a push notification out to the Hub Android app's registered devices.
 *
 * OpenLevel runs out-of-process from the gateway, so it can't call the push
 * fan-out in-process the way the Portal poller does. Instead it POSTs the
 * gateway's INTERNAL_PUSH_SECRET-guarded /push/send endpoint with its own
 * source ('openlevel'). The gateway owns the device registry, per-source
 * toggles, and FCM delivery; this module only kicks it.
 *
 * Contract: this NEVER throws and NEVER blocks the inbound webhook. A push is a
 * best-effort nicety — a Chatwoot message must land in OpenLevel even if the
 * gateway is down or unconfigured. Callers use `void notifyPush(...)`. When url
 * or secret is unset (tests / not-yet-wired prod) it is a silent no-op.
 */

export interface NotifyPushConfig {
  /** GATEWAY_PUSH_URL, e.g. https://gateway/push/send. */
  url: string
  /** INTERNAL_PUSH_SECRET — must match the gateway's. */
  secret: string
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export interface NotifyPushMessage {
  /** This codebase only ever announces its own source. */
  source: 'openlevel'
  title: string
  body: string
  data?: Record<string, string>
}

/** Fire-and-forget push trigger. Swallows ALL errors — the inbound webhook must never wait on or fail for push. */
export async function notifyPush(cfg: NotifyPushConfig, msg: NotifyPushMessage): Promise<void> {
  if (!cfg.url || !cfg.secret) return
  const fetchImpl = cfg.fetchImpl ?? fetch
  try {
    await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-push-secret': cfg.secret },
      body: JSON.stringify(msg),
    })
  } catch {
    // intentionally ignored — best-effort
  }
}
