/**
 * The shared conversation-agent engine. One entry point — `generateAgentText` —
 * that both the autonomous reply worker and the approve-first draft path call.
 *
 * It wires together the four independently-tested pieces:
 *   - lib/anthropic       the HTTP protocol (createMessage) + buildMessages
 *   - lib/agent-config    the grounded, security-load-bearing system prompt
 *   - lib/agent-tools     the location-scoped, contact-pinned, write-gated tools
 *   - lib/agent-runner    the tool-use loop that drives the model to a final text
 *
 * The single security knob is `allowWrites`. In approve-first mode it is false:
 * the write tool SCHEMAS are withheld AND the dispatcher refuses them, so a draft
 * can read to ground itself but can never take a side effect. In autonomous mode
 * it is true and the agent may act after the customer agrees.
 */

import type { Database } from '../db/database'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { TimelineRepo } from '../repos/timeline-repo'
import { buildSystemPrompt, readAgentConfig } from './agent-config'
import { type ToolCall, type ToolResult, runToolConversation } from './agent-runner'
import { buildAgentTools } from './agent-tools'
import { type AnthropicTool, type ClaudeClient, buildMessages } from './anthropic'

export interface AgentTurnInput {
  client: ClaudeClient
  db: Database
  locationId: string
  /** The conversation's contact. With none, the agent runs a single plain
   *  completion with no tools and no timeline load. */
  contactId: string | null
  apiKey: string
  model: string
  /** The location's settings blob; `settings.agent` carries the agent config. */
  settings: Record<string, unknown> | null | undefined
  /** True only in autonomous reply mode — gates the write tools. */
  allowWrites: boolean
  /** Fires `appointment_booked` when the agent books, so it drives the same
   *  automation loop the public booking page does. */
  dispatch?: WorkflowDispatch
  now?: () => Date
}

/** How many recent timeline events to feed the model as conversation history. */
const TIMELINE_WINDOW = 20

export async function generateAgentText(input: AgentTurnInput): Promise<string> {
  const { client, db, locationId, contactId, apiKey, model, settings, allowWrites } = input
  const now = input.now ?? (() => new Date())

  const timeline = contactId ? await new TimelineRepo(db, locationId).listByContact(contactId, TIMELINE_WINDOW) : []
  const messages = buildMessages(timeline.map((t) => ({ type: t.type, payload: t.payload })))
  const system = buildSystemPrompt(readAgentConfig(settings ?? undefined), { allowWrites })

  let schemas: AnthropicTool[] = []
  let dispatchTool: (call: ToolCall) => Promise<ToolResult> = async (call) => ({
    toolUseId: call.id,
    content: 'No tools are available for this conversation.',
    isError: true,
  })

  if (contactId) {
    const toolset = buildAgentTools({ db, locationId, contactId, allowWrites, now, dispatch: input.dispatch })
    schemas = toolset.schemas
    dispatchTool = toolset.dispatch
  }

  return runToolConversation({ client, apiKey, model, system, messages, tools: schemas, dispatchTool })
}
