import type { AnthropicResponse, AnthropicTool, ClaudeClient, CreateMessageInput } from './anthropic'
import { type ToolCall, runToolConversation } from './agent-runner'

/** A ClaudeClient that replays a fixed script of responses and records every
 *  request it was given, so the loop itself is the thing under test. */
function scriptedClient(responses: AnthropicResponse[]) {
  const calls: CreateMessageInput[] = []
  let i = 0
  const client: ClaudeClient = {
    async createMessage(input) {
      calls.push(input)
      const res = responses[i] ?? { stopReason: 'end_turn', content: [{ type: 'text', text: '' }] }
      i++
      return res
    },
  }
  return { client, calls }
}

const TOOL: AnthropicTool = {
  name: 'check_availability',
  description: 'Look up open times.',
  input_schema: { type: 'object', properties: {} },
}

const base = {
  apiKey: 'k',
  model: 'm',
  system: 's',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [TOOL],
}

test('returns the model text immediately when no tool is requested', async () => {
  const { client, calls } = scriptedClient([
    { stopReason: 'end_turn', content: [{ type: 'text', text: 'Hello!' }] },
  ])
  const dispatched: ToolCall[] = []
  const out = await runToolConversation({
    ...base,
    client,
    dispatchTool: async (c) => {
      dispatched.push(c)
      return { toolUseId: c.id, content: 'x' }
    },
  })
  expect(out).toBe('Hello!')
  expect(dispatched).toEqual([])
  expect(calls).toHaveLength(1)
})

test('runs a tool, feeds the result back, and returns the follow-up text', async () => {
  const { client, calls } = scriptedClient([
    {
      stopReason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'tu_1', name: 'check_availability', input: { date: '2026-06-11' } },
      ],
    },
    { stopReason: 'end_turn', content: [{ type: 'text', text: 'You are all set for Thursday.' }] },
  ])
  const dispatched: ToolCall[] = []
  const out = await runToolConversation({
    ...base,
    client,
    dispatchTool: async (c) => {
      dispatched.push(c)
      return { toolUseId: c.id, content: '9am, 10am free' }
    },
  })
  expect(out).toBe('You are all set for Thursday.')
  expect(dispatched).toEqual([{ id: 'tu_1', name: 'check_availability', input: { date: '2026-06-11' } }])
  expect(calls).toHaveLength(2)
  // the SECOND request carried the assistant tool-call turn, then the tool_result turn
  const second = calls[1]!.messages
  expect(second[second.length - 2]).toEqual({
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'tu_1', name: 'check_availability', input: { date: '2026-06-11' } },
    ],
  })
  expect(second[second.length - 1]).toEqual({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '9am, 10am free' }],
  })
})

test('executes every tool_use block in a turn, in order', async () => {
  const { client, calls } = scriptedClient([
    {
      stopReason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'a', name: 'get_contact_context', input: {} },
        { type: 'tool_use', id: 'b', name: 'check_availability', input: {} },
      ],
    },
    { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  ])
  const order: string[] = []
  await runToolConversation({
    ...base,
    client,
    dispatchTool: async (c) => {
      order.push(c.id)
      return { toolUseId: c.id, content: c.id }
    },
  })
  expect(order).toEqual(['a', 'b'])
  const results = calls[1]!.messages.at(-1)!.content
  expect(results).toEqual([
    { type: 'tool_result', tool_use_id: 'a', content: 'a' },
    { type: 'tool_result', tool_use_id: 'b', content: 'b' },
  ])
})

test('joins multiple text blocks in the final answer', async () => {
  const { client } = scriptedClient([
    {
      stopReason: 'end_turn',
      content: [
        { type: 'text', text: 'Line one.' },
        { type: 'text', text: 'Line two.' },
      ],
    },
  ])
  const out = await runToolConversation({
    ...base,
    client,
    dispatchTool: async (c) => ({ toolUseId: c.id, content: '' }),
  })
  expect(out).toBe('Line one.\nLine two.')
})

test('caps tool rounds and forces a final no-tools answer', async () => {
  // the model keeps asking for a tool forever
  const loopy: AnthropicResponse = {
    stopReason: 'tool_use',
    content: [{ type: 'tool_use', id: 'x', name: 'check_availability', input: {} }],
  }
  const { client, calls } = scriptedClient([
    loopy,
    loopy,
    { stopReason: 'end_turn', content: [{ type: 'text', text: 'Here is what I can tell you.' }] },
  ])
  let dispatchCount = 0
  const out = await runToolConversation({
    ...base,
    client,
    maxIterations: 2,
    dispatchTool: async (c) => {
      dispatchCount++
      return { toolUseId: c.id, content: 'busy' }
    },
  })
  expect(out).toBe('Here is what I can tell you.')
  expect(dispatchCount).toBe(2) // two rounds, then stop
  expect(calls).toHaveLength(3) // 2 tool rounds + 1 forced final
  // the forced final call sent NO tools, so the model must answer in text
  expect(calls[2]!.tools).toEqual([])
})

test('passes a tool error back as an is_error tool_result and continues', async () => {
  const { client, calls } = scriptedClient([
    { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'e1', name: 'book_appointment', input: {} }] },
    { stopReason: 'end_turn', content: [{ type: 'text', text: 'Sorry, that slot just filled.' }] },
  ])
  const out = await runToolConversation({
    ...base,
    client,
    dispatchTool: async (c) => ({ toolUseId: c.id, content: 'slot taken', isError: true }),
  })
  expect(out).toBe('Sorry, that slot just filled.')
  expect(calls[1]!.messages.at(-1)!.content).toEqual([
    { type: 'tool_result', tool_use_id: 'e1', content: 'slot taken', is_error: true },
  ])
})
