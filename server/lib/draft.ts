import type { Database } from '../db/database'
import { type ClaudeClient, DRAFT_MODEL } from '../jobs/agent-reply'
import { ConversationsRepo } from '../repos/conversations-repo'
import { LocationsRepo } from '../repos/locations-repo'
import { generateAgentText } from './agent-engine'
import { resolveSecret as defaultResolveSecret } from './vault'

export interface DraftDeps {
  db: Database
  claude: ClaudeClient
  /** Injectable for tests — defaults to the env/Vaultwarden secret resolver. */
  resolveSecret?: typeof defaultResolveSecret
}

export interface DraftResult {
  ok: boolean
  status: 200 | 400 | 404
  text?: string
  error?: string
}

/**
 * Generate an AI draft reply for one conversation WITHOUT persisting or sending
 * it — this backs the "Draft from agent" button in the composer (the
 * approve-first UX). The per-client Anthropic key is resolved by name
 * `<slug>:anthropic:api_key` (D-44/D-36) and Haiku is the draft model (Opus
 * off). The operator edits/approves the text and sends it through the normal
 * outbound path, so nothing here writes to the database.
 */
export async function draftConversationReply(
  deps: DraftDeps,
  locationId: string,
  conversationId: string,
): Promise<DraftResult> {
  const { db } = deps
  const getSecret = deps.resolveSecret ?? defaultResolveSecret

  const location = await new LocationsRepo(db).getById(locationId)
  if (!location) return { ok: false, status: 404, error: 'location not found' }

  const slug = location.client_slug ?? location.slug
  const apiKey = getSecret(`${slug}:anthropic:api_key`)
  if (!apiKey) return { ok: false, status: 400, error: 'no anthropic key configured for this client' }

  const conversation = await new ConversationsRepo(db, locationId).get(conversationId)
  if (!conversation) return { ok: false, status: 404, error: 'conversation not found' }

  // Draft path is ALWAYS read-only: allowWrites:false withholds the write tools
  // and refuses them in the dispatcher, so the agent grounds the draft against
  // real data but never books, tags, or sends. The operator approves the text.
  const text = await generateAgentText({
    client: deps.claude,
    db,
    locationId,
    contactId: conversation.contact_id,
    apiKey,
    model: DRAFT_MODEL,
    settings: location.settings as Record<string, unknown> | null,
    allowWrites: false,
  })
  return { ok: true, status: 200, text }
}
