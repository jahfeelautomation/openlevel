import type { Database } from '../db/database'
import { LocationsRepo } from '../repos/locations-repo'
import { runToolConversation } from './agent-runner'
import { type ClaudeClient, type MessageParam } from './anthropic'
import { buildOperatorSystemPrompt } from './operator-config'
import { buildOperatorTools, type ProposedAction } from './operator-tools'
import { resolveSecret as defaultResolveSecret } from './vault'

/**
 * The operator assistant engine — the server half of OpenLevel's "AI front door".
 *
 * It mirrors lib/draft (resolve the per-client Anthropic key by name, run the
 * engine) but the shape is different: LOCATION-scoped and operator-trusted, not
 * contact-pinned. The operator types in plain English, the agent reads across the
 * whole CRM with its tools, and answers. In approve-first mode (allowWrites:true)
 * the write tools are offered too, but the chat loop only ever PROPOSES a change —
 * nothing in THIS function mutates the database. The actual write is a separate,
 * operator-initiated step: the route's POST /confirm calls confirmOperatorWrite.
 * So the worst a forged or prompt-injected write tool_use can do here is add a
 * proposal the operator has not yet confirmed.
 */

/** Sonnet, not Haiku: the operator assistant is complex multi-tool reasoning over
 *  the whole CRM, the case D-44 reserves for escalating above the Haiku floor. */
export const OPERATOR_MODEL = 'claude-sonnet-4-6'

export interface OperatorChatTurn {
  /** 'operator' = the human staff member; 'assistant' = this AI. */
  role: 'operator' | 'assistant'
  content: string
}

export interface AssistantDeps {
  db: Database
  claude: ClaudeClient
  /** Injectable for tests — defaults to the env/Vaultwarden secret resolver. */
  resolveSecret?: typeof defaultResolveSecret
  now?: () => Date
}

export interface AssistantResult {
  ok: boolean
  status: 200 | 400 | 404
  reply?: string
  /** Changes the agent PREPARED this turn for the operator to confirm. Empty when
   *  the turn only answered. The UI renders one confirm card per proposal; POST
   *  /confirm performs a chosen one. Always present (possibly empty) on success. */
  proposals?: ProposedAction[]
  error?: string
}

/**
 * Map the operator↔agent chat history plus the new message into a valid Anthropic
 * messages array: operator -> user, assistant -> assistant, consecutive same-role
 * turns coalesced, and the array guaranteed to start with a user turn (API
 * requirement). The new operator message is always the final user turn. Empty
 * turns are dropped so a stray blank never breaks the alternation.
 */
function buildOperatorMessages(history: OperatorChatTurn[], message: string): MessageParam[] {
  const turns: MessageParam[] = []
  const push = (role: 'user' | 'assistant', content: string) => {
    const text = content.trim()
    if (!text) return
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.content = `${last.content as string}\n${text}`
    else turns.push({ role, content: text })
  }
  for (const h of Array.isArray(history) ? history : []) {
    push(h?.role === 'assistant' ? 'assistant' : 'user', typeof h?.content === 'string' ? h.content : '')
  }
  push('user', message)
  // Anthropic requires the first turn to be a user turn; if the agent somehow
  // spoke first, prepend a neutral opener rather than invent operator content.
  if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', content: '(start of conversation)' })
  return turns
}

export async function runOperatorAssistant(
  deps: AssistantDeps,
  locationId: string,
  history: OperatorChatTurn[],
  message: string,
): Promise<AssistantResult> {
  const { db, claude } = deps
  const getSecret = deps.resolveSecret ?? defaultResolveSecret
  const now = deps.now ?? (() => new Date())

  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, status: 400, error: 'message is required' }
  }

  const location = await new LocationsRepo(db).getById(locationId)
  if (!location) return { ok: false, status: 404, error: 'location not found' }

  const slug = location.client_slug ?? location.slug
  const apiKey = getSecret(`${slug}:anthropic:api_key`)
  if (!apiKey) return { ok: false, status: 400, error: 'no anthropic key configured for this client' }

  const messages = buildOperatorMessages(history, message)
  const system = buildOperatorSystemPrompt({ allowWrites: true })
  const tools = buildOperatorTools({ db, locationId, allowWrites: true, now })

  const reply = await runToolConversation({
    client: claude,
    apiKey,
    model: OPERATOR_MODEL,
    system,
    messages,
    tools: tools.schemas,
    dispatchTool: tools.dispatch,
  })
  // tools.proposals holds anything the chat loop PREPARED (never performed). Hand it
  // back so the route can surface confirm cards; performing one is POST /confirm.
  return { ok: true, status: 200, reply, proposals: tools.proposals }
}
