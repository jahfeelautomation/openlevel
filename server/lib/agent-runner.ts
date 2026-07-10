import type { AnthropicTool, ClaudeClient, ContentBlock, MessageParam } from './anthropic'

/** A tool the model asked us to run, lifted out of a `tool_use` content block. */
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/** The outcome of running one tool, sent back to the model as a `tool_result`.
 *  `isError: true` lets the model recover (e.g. offer another time) instead of
 *  the whole job throwing. */
export interface ToolResult {
  toolUseId: string
  content: string
  isError?: boolean
}

export interface RunToolConversationInput {
  client: ClaudeClient
  apiKey: string
  model: string
  system: string
  /** The seed conversation (built by lib/anthropic.buildMessages). Copied, not mutated. */
  messages: MessageParam[]
  /** Tool schemas the model may call this turn. Read-only vs. read+write is decided
   *  upstream (lib/agent-tools) by which schemas are present. */
  tools: AnthropicTool[]
  /** Runs one tool and returns its result. Never throws for a tool-level failure —
   *  it returns `{ isError: true }` so the model can recover. */
  dispatchTool: (call: ToolCall) => Promise<ToolResult>
  /** Hard ceiling on tool-executing rounds before we force a text answer. Bounds
   *  cost and latency so a confused model can't loop without end. */
  maxIterations?: number
}

const isToolUse = (b: ContentBlock): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use'
const isText = (b: ContentBlock): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text'

/** Concatenate the assistant's text blocks into the reply we surface. */
function textOf(content: ContentBlock[]): string {
  return content
    .filter(isText)
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/**
 * Drive a bounded tool-use conversation to a final text answer.
 *
 * Each round: ask the model; if it requested no tools, return its text. Otherwise
 * record its tool-call turn verbatim, run EVERY requested tool in order, feed the
 * results back as one user turn, and ask again. After `maxIterations` rounds the
 * model is asked ONE more time with no tools, which forces a textual answer rather
 * than an unbounded loop. The model can never reach a side effect this layer does
 * not allow: `dispatchTool` (lib/agent-tools) is the only door to the database, and
 * it refuses writes the location's reply mode hasn't authorized.
 */
export async function runToolConversation(input: RunToolConversationInput): Promise<string> {
  const { client, apiKey, model, system, dispatchTool } = input
  const maxIterations = input.maxIterations ?? 5
  const messages = input.messages.slice()
  const tools = input.tools

  for (let round = 0; round < maxIterations; round++) {
    const res = await client.createMessage({ apiKey, model, system, messages, tools })
    const toolUses = res.content.filter(isToolUse)
    if (toolUses.length === 0) return textOf(res.content)

    // Echo the model's tool-call turn back so the next request is a valid
    // assistant->tool_result exchange.
    messages.push({ role: 'assistant', content: res.content })

    const results: ContentBlock[] = []
    for (const tu of toolUses) {
      const r = await dispatchTool({ id: tu.id, name: tu.name, input: tu.input })
      results.push({
        type: 'tool_result',
        tool_use_id: r.toolUseId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })
    }
    messages.push({ role: 'user', content: results })
  }

  // Cap reached with the model still wanting tools: drop the tools so it must
  // answer in words. One final round, no recursion.
  const final = await client.createMessage({ apiKey, model, system, messages, tools: [] })
  return textOf(final.content)
}
