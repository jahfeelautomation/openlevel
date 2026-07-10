/**
 * federation.ts — OpenLevel's /federation/* surface for the Acme Hub gateway.
 *
 *   GET  /federation/capabilities -> ONE CapabilityCard (OPENLEVEL_CARD)
 *   GET  /federation/today        -> TodayItem[]
 *   POST /federation/turn         -> propose only, never mutates   (Task 4)
 *   POST /federation/confirm      -> performs exactly one write    (Task 5)
 *
 * The whole surface is gated: 503 until the shared service token is configured,
 * then a constant-time bearer match. The tenant (locationId) rides in the trusted
 * X-Federation-Tenant header set by the gateway, never read from the body — so a
 * caller can never act on a location it was not routed to.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import type { ClaudeClient } from '../lib/anthropic'
import {
  OPENLEVEL_CARD,
  type ConfirmResult,
  decodeActionRef,
  encodeActionRef,
  federationConfirmSchema,
  federationTurnSchema,
  type FederationProposal,
  type TodayItem,
  type TurnResponse,
} from '../lib/federation-types'
import { type AssistantDeps, runOperatorAssistant } from '../lib/operator-assistant'
import { confirmOperatorWrite, type SendTextFn } from '../lib/operator-tools'
import { AppointmentsRepo } from '../repos/appointments-repo'
import { ContactTasksRepo } from '../repos/contact-tasks-repo'

export interface FederationRouteDeps {
  db: Database
  /** The hub gateway's shared bearer. undefined => the whole surface answers 503. */
  federationServiceToken: string | undefined
  /** Claude client for /turn. Unset => /turn answers 501 (assistant not configured). */
  claude?: ClaudeClient
  /** Injectable secret resolver — defaults inside the engine to env/Vaultwarden. */
  resolveSecret?: AssistantDeps['resolveSecret']
  /** Outbound text rail. Unset => send_text confirms report "not set up" (no send). */
  sendText?: SendTextFn
  /** Injectable clock (tests pin it; production passes nothing). */
  now?: () => Date
}

/** Constant-time string compare via fixed-length sha256 digests (timingSafeEqual
 *  needs equal-length buffers, and hashing first avoids leaking length). */
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

// Today ranking: an overdue task is the loudest, then an upcoming appointment,
// then a task that is merely due soon. MAX caps the list; the window bounds both
// the appointments shown and which tasks count as "today" (a task with no due
// date, or due past the window, is not a today item — it would only add noise).
const URGENCY = { TASK_OVERDUE: 8, APPT: 7, TASK_DUE: 6 } as const
const MAX_TODAY = 25
const TODAY_WINDOW_DAYS = 2

/** Join the non-empty parts of a detail line with a middot, matching the portal's
 *  TodayItem convention so the hub's merged feed reads consistently across apps. */
function detailOf(parts: string[]): string {
  return parts.filter(Boolean).join(' · ')
}

/** pg returns timestamptz columns as Date objects (there is no setTypeParser override);
 *  tests and any text columns pass ISO strings. An in-process comparison has to reduce both
 *  to the same form first: `Date > string` coerces to NaN => false, which silently defeats
 *  the window filter and the overdue flag. epochOf is for comparison; isoOf is for display,
 *  leaving an existing string verbatim so a value already in ISO renders unchanged. */
function epochOf(v: unknown): number {
  return v instanceof Date ? v.getTime() : new Date(String(v)).getTime()
}
function isoOf(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v)
}

/** Map the next couple of days of appointments + every task due in that window into
 *  the uniform TodayItem shape. Titles carry a human label ("Appointment:" / "Task:")
 *  and detail is omitted when empty, matching the portal so the hub feed is uniform.
 *  PII-safe by construction: titles/names only, NEVER phone digits. */
async function buildToday(db: Database, locationId: string, now: Date): Promise<TodayItem[]> {
  const nowMs = now.getTime()
  const toMs = nowMs + TODAY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  // Appointments are windowed in SQL: listByRange binds ISO-string params that postgres
  // compares against the timestamptz column server-side, so that path is sound. Tasks are
  // windowed here in-process, so each due_at goes through epochOf below (see helper note).
  const appts = await new AppointmentsRepo(db, locationId).listByRange(
    new Date(nowMs).toISOString(),
    new Date(toMs).toISOString(),
  )
  const tasks = await new ContactTasksRepo(db, locationId).listForLocation()
  const items: TodayItem[] = []
  for (const a of appts.slice(0, MAX_TODAY)) {
    const detail = detailOf([a.starts_at ? `starts ${isoOf(a.starts_at)}` : ''])
    items.push({
      app: 'openlevel',
      id: `openlevel:appt:${a.id}`,
      title: a.title ? `Appointment: ${a.title}` : 'Appointment',
      ...(detail ? { detail } : {}),
      urgency: URGENCY.APPT,
    })
  }
  for (const t of tasks) {
    if (t.completed_at) continue // open tasks only
    if (t.due_at == null) continue // no due date => not "today"
    const dueMs = epochOf(t.due_at)
    if (Number.isNaN(dueMs) || dueMs > toMs) continue // unparseable, or beyond the window
    const detail = detailOf([t.contact_name ?? '', `due ${isoOf(t.due_at)}`])
    items.push({
      app: 'openlevel',
      id: `openlevel:task:${t.id}`,
      title: t.title ? `Task: ${t.title}` : 'Task',
      ...(detail ? { detail } : {}),
      urgency: dueMs < nowMs ? URGENCY.TASK_OVERDUE : URGENCY.TASK_DUE,
    })
    if (items.length >= MAX_TODAY * 2) break
  }
  items.sort((a, b) => b.urgency - a.urgency)
  return items.slice(0, MAX_TODAY)
}

export function federationRoute(deps: FederationRouteDeps) {
  const now = deps.now ?? (() => new Date())
  const app = new Hono<AppEnv>()

  // Gate the whole /federation/* surface. 503 wins over 401 so an un-provisioned
  // app is plainly "not turned on" rather than "wrong key".
  app.use('/federation/*', async (c, next) => {
    const token = deps.federationServiceToken
    if (!token) return c.json({ error: 'federation not configured' }, 503)
    const provided = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!constantTimeEqual(provided, token)) return c.json({ error: 'unauthorized' }, 401)
    await next()
  })

  app.get('/federation/capabilities', (c) => c.json(OPENLEVEL_CARD))

  app.get('/federation/today', async (c) => {
    const tenant = c.req.header('x-federation-tenant')
    if (!tenant) return c.json({ error: 'missing tenant' }, 400)
    const items = await buildToday(deps.db, tenant, now())
    return c.json(items)
  })

  // A chat turn: answer the operator and, when the assistant prepares a change,
  // hand back confirm proposals. runOperatorAssistant NEVER mutates — it only
  // proposes — so this whole endpoint is side-effect free. The native ProposedAction
  // {verb, params} is round-tripped through the opaque proposal ref so it survives
  // the gateway's contract pass-through; the actual write is a later POST /confirm.
  app.post('/federation/turn', async (c) => {
    if (!deps.claude) return c.json({ ok: false, error: 'assistant is not configured' }, 501)
    const loc = (c.req.header('x-federation-tenant') ?? '').trim()
    if (!loc) return c.json({ ok: false, error: 'tenant_required' }, 400)
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      raw = null
    }
    const parsed = federationTurnSchema.safeParse(raw)
    if (!parsed.success) return c.json({ ok: false, error: 'bad_request' }, 400)
    // Single-shot: the gateway turn carries no history, so the assistant runs with an
    // empty history + this one message (its tool loop can still search then propose
    // within the turn). threadRef is accepted for contract uniformity, but OpenLevel's
    // assistant is location-global, so it does not scope to a thread.
    const result = await runOperatorAssistant(
      { db: deps.db, claude: deps.claude, resolveSecret: deps.resolveSecret, now },
      loc,
      [],
      parsed.data.message,
    )
    if (!result.ok) return c.json({ ok: false, error: result.error ?? 'assistant_error' }, result.status)
    const proposals: FederationProposal[] = (result.proposals ?? []).map((p) => ({
      ref: encodeActionRef({ verb: p.verb, params: p.params }),
      kind: 'confirm',
      summary: p.summary,
      approve: 'confirm-card',
    }))
    return c.json({ reply: result.reply ?? '', proposals } satisfies TurnResponse)
  })

  // Perform exactly one write. The body is either a proposal ref (from a prior turn)
  // or a native {verb, params}; both funnel into confirmOperatorWrite, which
  // RE-VALIDATES the verb against the write allowlist and RE-RESOLVES params against
  // the live DB (so a forged ref or body can do no more than a legitimate one). A
  // rejected business outcome is HTTP 200 with {ok:false} so the gateway client does
  // not throw; HTTP 400 is reserved for protocol errors (no tenant, bad shape, ref
  // we cannot decode). send_text re-derives the phone from contactId server-side.
  app.post('/federation/confirm', async (c) => {
    const loc = (c.req.header('x-federation-tenant') ?? '').trim()
    if (!loc) return c.json({ ok: false, reason: 'tenant_required' } satisfies ConfirmResult, 400)
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      raw = null
    }
    const parsed = federationConfirmSchema.safeParse(raw)
    if (!parsed.success) return c.json({ ok: false, reason: 'unsupported' } satisfies ConfirmResult, 400)
    let action: { verb: string; params: Record<string, unknown> } | null
    if ('proposalRef' in parsed.data) {
      action = decodeActionRef(parsed.data.proposalRef)
      if (!action) return c.json({ ok: false, reason: 'unsupported' } satisfies ConfirmResult, 400)
    } else {
      action = { verb: parsed.data.verb, params: parsed.data.params }
    }
    const r = await confirmOperatorWrite({ db: deps.db, locationId: loc, sendText: deps.sendText, now }, action)
    if (!r.ok) return c.json({ ok: false, reason: 'rejected', detail: r.message } satisfies ConfirmResult, 200)
    return c.json({ ok: true, detail: r.message } satisfies ConfirmResult, 200)
  })

  return app
}

