import { FakeDatabase } from '../db/fake-database'
import { type ClaudeClient, DRAFT_MODEL } from '../jobs/agent-reply'
import { draftConversationReply } from './draft'

function fakeClaude(text = 'Happy to help — yes, we are open Saturday 9-5.') {
  const calls: { apiKey: string; model: string }[] = []
  const client: ClaudeClient = {
    // The draft path runs the engine read-only; this stub emits one text block and
    // no tool_use, so the loop returns the text without dispatching any tool.
    createMessage: async (input) => {
      calls.push({ apiKey: input.apiKey, model: input.model })
      return { stopReason: 'end_turn', content: [{ type: 'text', text }] }
    },
  }
  return { client, calls }
}

test('drafts with the per-client key + Haiku model and persists nothing', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', slug: 'jamal', client_slug: 'jamal', settings: {} }]) // getById
  db.enqueue([{ id: 'conv1', location_id: 'locA', contact_id: 'c1', external_id: '55' }]) // conversations.get
  db.enqueue([{ id: 't1', type: 'message', payload: { direction: 'inbound', body: 'Are you open Saturday?' } }]) // timeline

  const claude = fakeClaude()
  const res = await draftConversationReply(
    { db, claude: claude.client, resolveSecret: () => 'sk-ant-test' },
    'locA',
    'conv1',
  )

  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.text).toMatch(/Saturday/)
  // model received the per-client key + the Haiku draft model (D-44)
  expect(claude.calls[0]).toEqual({ apiKey: 'sk-ant-test', model: DRAFT_MODEL })
  // read-only: getById + conversations.get + timeline list = 3 queries, no INSERT
  expect(db.calls).toHaveLength(3)
  expect(db.calls.every((q) => !/INSERT/i.test(q.sql))).toBe(true)
})

test('404 when the conversation does not exist', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', slug: 'jamal', client_slug: 'jamal', settings: {} }]) // getById
  db.enqueue([]) // conversations.get -> none
  const claude = fakeClaude()
  const res = await draftConversationReply(
    { db, claude: claude.client, resolveSecret: () => 'sk' },
    'locA',
    'ghost',
  )
  expect(res).toMatchObject({ ok: false, status: 404 })
  expect(claude.calls).toHaveLength(0)
})

test('400 when the client has no anthropic key', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'locA', slug: 'jamal', client_slug: 'jamal', settings: {} }]) // getById
  const claude = fakeClaude()
  const res = await draftConversationReply(
    { db, claude: claude.client, resolveSecret: () => undefined },
    'locA',
    'conv1',
  )
  expect(res).toMatchObject({ ok: false, status: 400 })
  expect(claude.calls).toHaveLength(0)
})
