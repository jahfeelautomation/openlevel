/**
 * federation-types.ts — OpenLevel's half of the Acme Hub federation wire
 * contract. The hub gateway aggregates three apps (portal, customapp, openlevel)
 * by calling each one's /federation/* endpoints; these shapes mirror the gateway's
 * own server/lib/federation-types.ts and must stay in lock-step with it.
 *
 *   GET  /federation/capabilities -> ONE CapabilityCard
 *   GET  /federation/today        -> TodayItem[]
 *   POST /federation/turn         -> { message, threadRef? } => { reply, proposals }
 *   POST /federation/confirm      -> { proposalRef } | { verb, params } => ConfirmResult
 *
 * OpenLevel already speaks propose/confirm (operator-tools.ts): a turn PROPOSES
 * {verb, params} and confirm performs exactly one through confirmOperatorWrite,
 * which RE-RESOLVES every action server-side. So this is a thin translation.
 *
 * The gateway's FederationProposal has no params slot and its zod parse STRIPS
 * unknown fields, so we round-trip the native {verb, params} through the opaque
 * `ref` (encodeActionRef/decodeActionRef). Stateless, like the native /confirm,
 * and PII-safe by construction: a send_text proposal's params are {contactId,
 * body, nonce} — never a phone; the number is re-derived from contactId at confirm.
 */
import { z } from 'zod'

export type FederationAppId = 'portal' | 'customapp' | 'openlevel'

export interface Capability {
  id: string
  kind: 'read' | 'action'
  summary: string
  approve: 'none' | 'draft-hold' | 'confirm-card'
}

export interface CapabilityCard {
  app: FederationAppId
  label: string
  capabilities: Capability[]
}

export interface TodayItem {
  app: FederationAppId
  id: string
  title: string
  detail?: string
  urgency: number
}

export interface FederationProposal {
  ref: string
  kind: 'draft' | 'confirm'
  summary: string
  preview?: string
  approve: 'draft-hold' | 'confirm-card'
}

export interface TurnResponse {
  reply: string
  proposals: FederationProposal[]
}

export type ConfirmResult =
  | { ok: true; detail?: string }
  | { ok: false; reason: string; detail?: string }

/** The single honest card OpenLevel returns from GET /federation/capabilities.
 *  No em-dashes (Admin rule for user-facing copy). */
export const OPENLEVEL_CARD: CapabilityCard = {
  app: 'openlevel',
  label: 'OpenLevel CRM',
  capabilities: [
    {
      id: 'openlevel.crm.read',
      kind: 'read',
      approve: 'none',
      summary: 'Look up contacts, appointments, deals, and tasks across your OpenLevel CRM.',
    },
    {
      id: 'openlevel.appointment.book',
      kind: 'action',
      approve: 'confirm-card',
      summary: 'Book an appointment for a contact. You confirm before it is booked.',
    },
    {
      id: 'openlevel.contact.tag',
      kind: 'action',
      approve: 'confirm-card',
      summary: 'Add or remove a tag on a contact. You confirm first.',
    },
    {
      id: 'openlevel.task.create',
      kind: 'action',
      approve: 'confirm-card',
      summary: 'Create a follow-up task on a contact. You confirm first.',
    },
    {
      id: 'openlevel.deal.update',
      kind: 'action',
      approve: 'confirm-card',
      summary: 'Move a deal to another stage or set its status. You confirm first.',
    },
    {
      id: 'openlevel.text.send',
      kind: 'action',
      approve: 'confirm-card',
      summary: 'Draft a text to a contact from your business line. You confirm before it sends.',
    },
  ],
}

const REF_PREFIX = 'ol:'

/** Encode a native {verb, params} into the opaque proposal ref so it survives the
 *  gateway's pass-through (which strips any non-contract field). */
export function encodeActionRef(action: { verb: string; params: Record<string, unknown> }): string {
  const json = JSON.stringify({ verb: action.verb, params: action.params ?? {} })
  return REF_PREFIX + Buffer.from(json, 'utf8').toString('base64url')
}

/** Decode a proposal ref back to {verb, params}, or null if it is not ours /
 *  malformed. confirmOperatorWrite re-validates the verb + re-resolves params, so a
 *  forged ref can do no more than a forged {verb, params} body could. */
export function decodeActionRef(ref: unknown): { verb: string; params: Record<string, unknown> } | null {
  if (typeof ref !== 'string' || !ref.startsWith(REF_PREFIX)) return null
  try {
    const json = Buffer.from(ref.slice(REF_PREFIX.length), 'base64url').toString('utf8')
    const o = JSON.parse(json) as unknown
    if (!o || typeof o !== 'object') return null
    const verb = (o as Record<string, unknown>).verb
    const params = (o as Record<string, unknown>).params
    if (typeof verb !== 'string' || !verb) return null
    if (!params || typeof params !== 'object') return null
    return { verb, params: params as Record<string, unknown> }
  } catch {
    return null
  }
}

// Inbound body schemas. confirmOperatorWrite re-validates the verb against the
// write allowlist + re-resolves params, so the confirm schema only ensures shape.
export const federationTurnSchema = z.object({
  message: z.string().min(1),
  threadRef: z.string().optional(),
})

export const federationConfirmSchema = z.union([
  z.object({ proposalRef: z.string().min(1) }),
  z.object({ verb: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) }),
])

