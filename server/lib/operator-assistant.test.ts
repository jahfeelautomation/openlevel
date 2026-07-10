import { FakeDatabase } from '../db/fake-database'
import type { ClaudeClient, ContentBlock, CreateMessageInput } from './anthropic'
import { OPERATOR_MODEL, runOperatorAssistant } from './operator-assistant'

function fakeClaude(text = 'You have 2 appointments this week.') {
  const calls: CreateMessageInput[] = []
  const client: ClaudeClient = {
    // One text block, no tool_use — so runToolConversation returns the text in a
    // single round without dispatching any tool.
    createMessage: async (input) => {
      calls.push(input)
      return { stopReason: 'end_turn', content: [{ type: 'text', text }] }
    },
  }
  return { client, calls }
}

/**
 * A STATEFUL fake Claude that drives the real two-round tool loop: round 1 it asks
 * to run `toolName`; round 2 it answers with VERBATIM the tool_result the runner
 * fed back. Because its final words can only be real tool output, a passing
 * assertion proves the tool actually executed against the DB and its result
 * reached the model — the thing the dev-server stub (canned reply, never emits
 * tool_use) cannot exercise. Serves both a read tool (grounded answer) and a write
 * tool (the refusal text becomes the answer).
 */
function toolUsingClaude(toolName: string, toolInput: Record<string, unknown> = {}) {
  const calls: CreateMessageInput[] = []
  const client: ClaudeClient = {
    createMessage: async (input) => {
      calls.push(input)
      if (calls.length === 1) {
        return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: toolName, input: toolInput }] }
      }
      const last = input.messages[input.messages.length - 1]
      const result = Array.isArray(last?.content)
        ? last.content.find((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result')
        : undefined
      return { stopReason: 'end_turn', content: [{ type: 'text', text: result?.content ?? '(no tool output)' }] }
    },
  }
  return { client, calls }
}

const LOC = { id: 'locA', name: 'Jamal Co', slug: 'jamal', client_slug: 'jamal', branding: {}, settings: {} }

test('answers with the per-client key + the operator (Sonnet) model, persisting nothing', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC]) // getById
  const { client, calls } = fakeClaude()
  const res = await runOperatorAssistant(
    { db, claude: client, resolveSecret: () => 'sk-ant-test' },
    'locA',
    [],
    'How many appointments do I have this week?',
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.reply).toMatch(/appointments/i)
  // per-client key + the Sonnet operator model
  expect(calls[0]?.apiKey).toBe('sk-ant-test')
  expect(calls[0]?.model).toBe(OPERATOR_MODEL)
  // only the location was read; nothing was written
  expect(db.calls).toHaveLength(1)
  expect(db.calls.every((q) => !/INSERT|UPDATE|DELETE/i.test(q.sql))).toBe(true)
})

test('the prompt is operator-trusted and approve-first, offering the read + write tools (slice-2 posture)', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC])
  const { client, calls } = fakeClaude()
  await runOperatorAssistant({ db, claude: client, resolveSecret: () => 'k' }, 'locA', [], 'hi')
  const sent = calls[0]!
  expect(sent.system).toMatch(/operator/i)
  // approve-first mode is on: the prompt tells the model to confirm before acting
  expect(sent.system).toMatch(/confirm/i)
  // all thirteen tools are offered — the six reads plus the seven approve-first
  // writes (the seventh being the approve-gated send_text, slice 3)
  expect((sent.tools ?? []).map((t) => t.name).sort()).toEqual([
    'book_appointment',
    'create_task',
    'get_contact',
    'list_appointments',
    'list_contacts',
    'list_opportunities',
    'list_tasks',
    'move_opportunity',
    'search_contacts',
    'send_text',
    'set_opportunity_status',
    'tag_contact',
    'untag_contact',
  ])
})

test('history maps operator->user and agent->assistant, with the new message appended as a user turn', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC])
  const { client, calls } = fakeClaude()
  await runOperatorAssistant(
    { db, claude: client, resolveSecret: () => 'k' },
    'locA',
    [
      { role: 'operator', content: 'who is Jane?' },
      { role: 'assistant', content: 'Jane Doe, a lead in Phoenix.' },
    ],
    'book her for Thursday',
  )
  const msgs = calls[0]!.messages
  expect(msgs[0]).toEqual({ role: 'user', content: 'who is Jane?' })
  expect(msgs[1]).toEqual({ role: 'assistant', content: 'Jane Doe, a lead in Phoenix.' })
  expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'book her for Thursday' })
})

test('404 when the location does not exist', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // getById -> none
  const { client, calls } = fakeClaude()
  const res = await runOperatorAssistant({ db, claude: client, resolveSecret: () => 'k' }, 'ghost', [], 'hi')
  expect(res).toMatchObject({ ok: false, status: 404 })
  expect(calls).toHaveLength(0)
})

test('400 when the client has no anthropic key', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC])
  const { client, calls } = fakeClaude()
  const res = await runOperatorAssistant({ db, claude: client, resolveSecret: () => undefined }, 'locA', [], 'hi')
  expect(res).toMatchObject({ ok: false, status: 400 })
  expect(calls).toHaveLength(0)
})

test('400 when the message is empty', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC])
  const { client, calls } = fakeClaude()
  const res = await runOperatorAssistant({ db, claude: client, resolveSecret: () => 'k' }, 'locA', [], '   ')
  expect(res).toMatchObject({ ok: false, status: 400 })
  expect(calls).toHaveLength(0)
})

// --- end-to-end: the read tool actually executes (what the dev stub can't show) ---

test('FUNCTIONAL: a real question runs a read tool and the answer is grounded in its live DB output', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC]) // LocationsRepo.getById
  db.enqueue([
    {
      id: 'tk1',
      location_id: 'locA',
      contact_id: 'c1',
      contact_name: 'Jane Altstatt',
      title: 'Call back about the roof',
      due_at: '2026-06-20T17:00:00.000Z',
      completed_at: null,
    },
  ]) // ContactTasksRepo.listForLocation
  const { client, calls } = toolUsingClaude('list_tasks')
  const res = await runOperatorAssistant(
    { db, claude: client, resolveSecret: () => 'sk-ant-test' },
    'locA',
    [],
    'what are my open tasks?',
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  // The reply carries the REAL row the read tool pulled from the DB — proof the
  // tool executed and its output reached the model, not a canned stub echo.
  expect(res.reply).toContain('Call back about the roof')
  expect(res.reply).toContain('Jane Altstatt')
  // Two model rounds: the tool call, then the grounded answer.
  expect(calls).toHaveLength(2)
  // Read-only throughout: a location read + a task read, and zero writes.
  expect(db.calls.every((q) => !/INSERT|UPDATE|DELETE/i.test(q.sql))).toBe(true)
})

test('FUNCTIONAL: a write tool_use PROPOSES the change and the engine returns it for confirmation (slice-2)', async () => {
  const db = new FakeDatabase()
  db.enqueue([LOC]) // getById
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }]) // book resolve: contacts.get
  db.enqueue([
    { id: 'cal1', location_id: 'locA', name: 'Roof Inspection', duration_min: 30, position: 0, booking_enabled: true, timezone: 'America/Phoenix' },
  ]) // book resolve: calendars.list
  const { client, calls } = toolUsingClaude('book_appointment', { contactId: 'c1', start: '2026-06-20T17:00:00Z' })
  const res = await runOperatorAssistant(
    { db, claude: client, resolveSecret: () => 'sk-ant-test' },
    'locA',
    [],
    'book Jane for Friday at 10',
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  // The agent PREPARED a booking and said so — it never claims the booking is done.
  expect(res.reply).toMatch(/awaiting|confirm|prepared|queued/i)
  expect(res.reply).not.toMatch(/\bbooked\b/i)
  // The proposal is handed back for the operator to confirm; verb + RAW params survive.
  expect(res.proposals).toHaveLength(1)
  expect(res.proposals?.[0]).toMatchObject({
    verb: 'book_appointment',
    params: { contactId: 'c1', start: '2026-06-20T17:00:00Z' },
  })
  expect(calls).toHaveLength(2)
  // Still NO write in the chat turn: location + contact + calendar reads only.
  expect(db.calls.every((q) => !/INSERT|UPDATE|DELETE/i.test(q.sql))).toBe(true)
})
