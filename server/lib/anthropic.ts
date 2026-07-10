const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

/** An Anthropic tool definition (JSON-schema input). Built by lib/agent-tools. */
export interface AnthropicTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * One content block in a message. `text`/`tool_use` appear in model RESPONSES;
 * `tool_result` is what the runner sends back in the next user turn. Keeping the
 * three in one union lets the tool-use loop build request turns and read response
 * turns with the same type.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

/** A turn in the Anthropic messages array. Simple turns use a string; tool turns
 *  use content blocks. */
export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface CreateMessageInput {
  apiKey: string
  model: string
  system: string
  messages: MessageParam[]
  /** Omitted from the request when empty so a no-tools turn forces a text answer. */
  tools?: AnthropicTool[]
  maxTokens?: number
}

/** A normalized model response: the stop reason plus the assistant's content
 *  blocks (text + any tool_use requests). */
export interface AnthropicResponse {
  stopReason: string | null
  content: ContentBlock[]
}

/**
 * The low-level Anthropic Messages client: ONE round-trip per call. It owns the
 * HTTP shape and nothing else — no conversation loop, no grounding, no repos. The
 * tool-use loop (lib/agent-runner) and the grounding (lib/agent-config) sit above
 * it, which keeps each layer independently testable.
 */
export interface ClaudeClient {
  createMessage(input: CreateMessageInput): Promise<AnthropicResponse>
}

type Turn = MessageParam & { content: string }

/**
 * Build a valid Anthropic messages array from stored timeline events.
 *
 * Roles are assigned STRUCTURALLY (outbound -> assistant, inbound -> user), so a
 * customer cannot forge one of the business's own turns by typing a role label
 * (e.g. a line starting "Us:") into their message — their text always lands in a
 * user turn no matter what it contains. Consecutive same-role turns are coalesced
 * and the array is guaranteed to start with a user turn, both required by the API.
 */
export function buildMessages(timeline: { type: string; payload: Record<string, unknown> }[]): Turn[] {
  const chronological = timeline
    .slice()
    .reverse() // stored newest-first -> chronological for the prompt
    .map((t) => t.payload as { direction?: string; body?: string })
    .map((p): Turn => ({ role: p.direction === 'outbound' ? 'assistant' : 'user', content: (p.body ?? '').trim() }))
    .filter((t) => t.content.length > 0)

  const messages: Turn[] = []
  for (const turn of chronological) {
    const last = messages[messages.length - 1]
    if (last && last.role === turn.role) last.content += `\n${turn.content}`
    else messages.push({ ...turn })
  }

  if (messages.length === 0) {
    return [{ role: 'user', content: '(The customer has not messaged yet. Draft a brief, friendly opening message.)' }]
  }
  // Anthropic requires the array to start with a user turn. If our own message is
  // first (e.g. an outbound nudge), prepend a neutral opener rather than invent
  // customer content.
  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: '(start of conversation)' })
  return messages
}

/** Normalize the raw `content` array from the API into our ContentBlock union,
 *  keeping only the block types a response can contain (text, tool_use). */
function normalizeContent(raw: unknown[]): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue
    const block = b as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') {
      out.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      out.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input as Record<string, unknown>) ?? {},
      })
    }
  }
  return out
}

/**
 * Default ClaudeClient backed by the Anthropic Messages API. The per-client key
 * is resolved from Vaultwarden by the caller and passed in here (D-36: this layer
 * uses the credential to authenticate the request; it is never logged or returned
 * to the agent). `tools` is sent only when non-empty, so the runner's final
 * no-tools call genuinely forces a text answer. fetch is injectable so this is
 * unit-testable without network.
 */
export function createAnthropicClient(fetchImpl: typeof fetch = fetch): ClaudeClient {
  return {
    async createMessage({ apiKey, model, system, messages, tools, maxTokens }) {
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens ?? 1024,
        system,
        messages,
      }
      if (tools && tools.length > 0) body.tools = tools

      const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`anthropic createMessage failed: ${res.status}`)
      const data = (await res.json()) as { stop_reason?: string | null; content?: unknown[] }
      return { stopReason: data.stop_reason ?? null, content: normalizeContent(data.content ?? []) }
    },
  }
}
