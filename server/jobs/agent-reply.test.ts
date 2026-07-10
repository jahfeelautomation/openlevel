import { FakeDatabase } from '../db/fake-database'
import { type ClaudeClient, DRAFT_MODEL, handleAgentReply } from './agent-reply'

function fakeClaude(text = 'drafted reply text') {
  const calls: { apiKey: string; model: string }[] = []
  const client: ClaudeClient = {
    // The engine speaks createMessage; this stub emits a single text block and no
    // tool_use, so the tool loop returns the text in one round-trip.
    createMessage: async (input) => {
      calls.push({ apiKey: input.apiKey, model: input.model })
      return { stopReason: 'end_turn', content: [{ type: 'text', text }] }
    },
  }
  return { client, calls }
}

test('approve-first (default) persists a DRAFT and never sends', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', slug: 'jamal', client_slug: 'jamal', settings: {} }]) // getById
  db.enqueue([{ id: 't-prev', type: 'message', payload: { direction: 'inbound', body: 'hi' } }]) // timeline list
  db.enqueue([{ id: 'm-draft' }]) // insertOutbound (draft)
  db.enqueue([{ id: 't-draft' }]) // timeline add

  const claude = fakeClaude()
  const sendCalls: unknown[] = []
  const res = await handleAgentReply(
    {
      db,
      claude: claude.client,
      resolveSecret: () => 'sk-ant-test',
      sendMessage: async (p) => {
        sendCalls.push(p)
        return { externalId: 'x' }
      },
    },
    { locationId: 'locA', conversationId: 'conv1', contactId: 'c1' },
  )

  expect(res).toMatchObject({ mode: 'approve-first', drafted: true, text: 'drafted reply text' })
  expect(sendCalls).toHaveLength(0) // never federated out
  // the model received the per-client key + the Haiku draft model (D-44)
  expect(claude.calls[0]).toEqual({ apiKey: 'sk-ant-test', model: DRAFT_MODEL })
  // the persisted row is a draft, scoped to the location
  expect(db.calls[2]?.params).toContain('draft')
  expect(db.calls[2]?.params).toContain('locA')
})

test('autonomous mode sends through the shared outbound path', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', slug: 'jamal', client_slug: 'jamal', settings: { replyMode: 'autonomous' } }]) // getById
  db.enqueue([{ id: 't-prev', type: 'message', payload: {} }]) // timeline list
  db.enqueue([{ id: 'conv1', location_id: 'locA', contact_id: 'c1', external_id: '55' }]) // conversations.get
  db.enqueue([
    {
      location_id: 'locA',
      inbox_id: '7',
      config: { baseUrl: 'https://chat', accountId: '1', tokenSecretName: 'jamal:chatwoot:api_token' },
    },
  ]) // getForLocation
  db.enqueue([{ id: 'm-out' }]) // insertOutbound (sent)
  db.enqueue([{ id: 't-out' }]) // timeline add
  db.enqueue([]) // touch

  const claude = fakeClaude()
  const sendCalls: { content: string }[] = []
  const res = await handleAgentReply(
    {
      db,
      claude: claude.client,
      resolveSecret: () => 'tok',
      sendMessage: async (p) => {
        sendCalls.push(p)
        return { externalId: 'cw-1' }
      },
    },
    { locationId: 'locA', conversationId: 'conv1', contactId: 'c1' },
  )

  expect(res).toMatchObject({ mode: 'autonomous', sent: true, text: 'drafted reply text' })
  expect(sendCalls).toHaveLength(1)
  expect(sendCalls[0]?.content).toBe('drafted reply text')
})

test('skips when the client has no anthropic key', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', slug: 'jamal', client_slug: 'jamal', settings: {} }]) // getById
  const claude = fakeClaude()
  const res = await handleAgentReply(
    { db, claude: claude.client, resolveSecret: () => undefined },
    { locationId: 'locA', conversationId: 'conv1', contactId: 'c1' },
  )
  expect(res.skipped).toMatch(/api key/i)
  expect(claude.calls).toHaveLength(0)
  expect(db.calls).toHaveLength(1) // only getById ran
})

test('skips when the location is unknown', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // getById -> none
  const claude = fakeClaude()
  const res = await handleAgentReply(
    { db, claude: claude.client, resolveSecret: () => 'sk' },
    { locationId: 'ghost', conversationId: 'conv1', contactId: 'c1' },
  )
  expect(res.skipped).toMatch(/location/i)
  expect(claude.calls).toHaveLength(0)
})
