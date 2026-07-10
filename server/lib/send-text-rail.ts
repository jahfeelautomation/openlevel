/**
 * send-text-rail.ts — the HTTP rail that turns the operator assistant's APPROVED
 * text into a real send, by calling the nerve-survey gateway's internal text-send
 * endpoint. The gateway owns the Beeper credential, so OpenLevel never holds or
 * sees it (D-36); this module is the only outbound seam.
 *
 * It is the deliberate OPPOSITE of notify-push:
 *   - notify-push is fire-and-forget and swallows every error — a push is a nicety.
 *   - this AWAITS the gateway, parses its JSON body as the AUTHORITATIVE
 *     SendTextResult, and NEVER swallows. Confirming a text must report honestly
 *     whether it went out, so an unreachable or unparseable gateway becomes a
 *     `failed` result the operator sees — never a silent success.
 *
 * Wire contract (matches the gateway's POST /text/send, slice 3C): POST JSON
 * `{ e164, body, nonce, state }` with the shared `x-internal-push-secret` header;
 * the gateway replies with a SendTextResult JSON body (200 on send, 422/503 on a
 * refusal). The HTTP status is advisory — the JSON body is what we trust, so a
 * gateway that returns `{ok:false, reason:'outside_window'}` with any status is
 * honoured. The destination e164 is already DERIVED from the contact upstream and
 * `state` is the contact's US state; this rail only carries them. The gateway is
 * the legal authority that turns `state` into the texting window (8am-9pm in that
 * state's own timezone); an empty `state` comes back as a `unknown_state` refusal.
 */

import type { SendTextFn, SendTextResult } from './operator-tools'

export interface HttpSendTextConfig {
  /** GATEWAY_TEXT_URL, e.g. https://api.acmecorp.com/text/send. */
  url: string
  /** INTERNAL_PUSH_SECRET — reused; must match the gateway's. */
  secret: string
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

const KNOWN_REASONS = new Set(['outside_window', 'unknown_state', 'not_configured', 'bad_phone', 'in_flight', 'failed'])

type FailReason = Extract<SendTextResult, { ok: false }>['reason']

function isKnownReason(r: unknown): r is FailReason {
  return typeof r === 'string' && KNOWN_REASONS.has(r)
}

/**
 * Defensively turn an arbitrary parsed gateway body into a SendTextResult. A body
 * we cannot recognise (wrong shape, missing messageId, an auth-error `{error}`
 * payload) becomes `failed` — never a false `ok`, so we cannot claim a text was
 * sent when the gateway did not actually say so.
 */
function parseSendTextResult(json: unknown): SendTextResult {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    if (o.ok === true && typeof o.messageId === 'string') {
      return o.deduped === true ? { ok: true, messageId: o.messageId, deduped: true } : { ok: true, messageId: o.messageId }
    }
    if (o.ok === false && isKnownReason(o.reason)) {
      return typeof o.detail === 'string' ? { ok: false, reason: o.reason, detail: o.detail } : { ok: false, reason: o.reason }
    }
  }
  return { ok: false, reason: 'failed', detail: 'unrecognised gateway response' }
}

/** Build the injected SendTextFn used by confirmOperatorWrite's send_text rail. */
export function makeHttpSendText(cfg: HttpSendTextConfig): SendTextFn {
  return async (e164, body, nonce, state) => {
    // Unwired server: report it plainly rather than pretending. The /confirm
    // handler turns this into "Texting isn't set up on this server yet."
    if (!cfg.url || !cfg.secret) return { ok: false, reason: 'not_configured' }
    const fetchImpl = cfg.fetchImpl ?? fetch
    try {
      const res = await fetchImpl(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-push-secret': cfg.secret },
        // state rides along so the gateway can pick the legal texting window for it.
        body: JSON.stringify({ e164, body, nonce, state }),
      })
      return parseSendTextResult(await res.json())
    } catch {
      // Network error or non-JSON body — honest failure, never a swallowed no-op.
      return { ok: false, reason: 'failed', detail: 'gateway unreachable' }
    }
  }
}

