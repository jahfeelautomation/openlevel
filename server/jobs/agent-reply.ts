import type { sendChatwootMessage } from '../lib/chatwoot-client'
import { generateAgentText } from '../lib/agent-engine'
import { sendOutboundMessage } from '../lib/outbound'
import { resolveSecret as defaultResolveSecret } from '../lib/vault'
import type { Database } from '../db/database'
import { LocationsRepo } from '../repos/locations-repo'
import { MessagesRepo } from '../repos/messages-repo'
import { TimelineRepo } from '../repos/timeline-repo'
import type { WorkflowDispatch } from './workflow-dispatcher'

export type ReplyMode = 'approve-first' | 'autonomous'

/** D-44: Haiku-first; escalate to Sonnet for complex tasks; Opus is OFF. */
export const DRAFT_MODEL = 'claude-haiku-4-5-20251001'

/** The HTTP client the engine talks to. Re-exported from lib/anthropic so the
 *  route + worker + draft path all share the one createMessage-shaped contract. */
export type { ClaudeClient } from '../lib/anthropic'

export interface AgentReplyPayload {
  locationId: string
  conversationId: string
  contactId: string | null
}

export interface AgentReplyDeps {
  db: Database
  claude: import('../lib/anthropic').ClaudeClient
  /** Injectable for tests — defaults to the env/Vaultwarden secret resolver. */
  resolveSecret?: typeof defaultResolveSecret
  /** Passed through to the outbound path on the autonomous branch. */
  sendMessage?: typeof sendChatwootMessage
  /** Fires `appointment_booked` when the agent books in autonomous mode, so a
   *  booking drives the same automation loop the public page does. */
  dispatch?: WorkflowDispatch
  /** Injectable clock for the agent's availability math (tests pin it). */
  now?: () => Date
}

export interface AgentReplyResult {
  mode: ReplyMode
  drafted?: boolean
  sent?: boolean
  text: string
  skipped?: string
}

/**
 * Draft (and, in autonomous mode, send) an AI reply for one conversation.
 *
 * D-44: the per-client Anthropic key is resolved from Vaultwarden by name
 * `<slug>:anthropic:api_key` and Haiku→Sonnet routing applies (Opus off). The
 * mode comes from the location's settings and DEFAULTS to approve-first — the
 * safe default, where the reply is persisted as a `draft` for operator approval
 * and is NOT sent. Autonomous mode reuses the shared outbound path.
 */
export async function handleAgentReply(
  deps: AgentReplyDeps,
  payload: AgentReplyPayload,
): Promise<AgentReplyResult> {
  const { db } = deps
  const getSecret = deps.resolveSecret ?? defaultResolveSecret

  const location = await new LocationsRepo(db).getById(payload.locationId)
  if (!location) return { mode: 'approve-first', text: '', skipped: 'location not found' }

  const mode: ReplyMode =
    (location.settings as { replyMode?: string }).replyMode === 'autonomous' ? 'autonomous' : 'approve-first'

  const slug = location.client_slug ?? location.slug
  const apiKey = getSecret(`${slug}:anthropic:api_key`)
  if (!apiKey) return { mode, text: '', skipped: 'no anthropic api key for this client' }

  // The tool-using agent loads its own conversation history and grounds replies
  // in real data. Writes (booking, tagging) exist ONLY in autonomous mode; in
  // approve-first the agent can read to ground the draft but takes no action.
  const text = await generateAgentText({
    client: deps.claude,
    db,
    locationId: payload.locationId,
    contactId: payload.contactId,
    apiKey,
    model: DRAFT_MODEL,
    settings: location.settings as Record<string, unknown> | null,
    allowWrites: mode === 'autonomous',
    dispatch: deps.dispatch,
    now: deps.now,
  })

  if (mode === 'autonomous') {
    const result = await sendOutboundMessage(
      db,
      payload.locationId,
      { conversationId: payload.conversationId, body: text, authorType: 'agent', authorId: null },
      { sendMessage: deps.sendMessage, resolveSecret: getSecret },
    )
    return { mode, sent: result.ok, text }
  }

  // approve-first (DEFAULT): persist a DRAFT for operator review; do NOT send.
  const message = await new MessagesRepo(db, payload.locationId).insertOutbound({
    conversationId: payload.conversationId,
    contactId: payload.contactId,
    channel: 'chatwoot',
    provider: 'chatwoot',
    externalId: null,
    body: text,
    authorType: 'agent',
    authorId: null,
    status: 'draft',
  })
  await new TimelineRepo(db, payload.locationId).add({
    contactId: payload.contactId,
    type: 'agent_draft',
    refTable: 'messages',
    refId: message.id,
    payload: { direction: 'outbound', body: text, channel: 'chatwoot', status: 'draft' },
  })
  return { mode, drafted: true, text }
}
