import { FakeDatabase } from '../db/fake-database'
import type { Calendar } from '../repos/calendars-repo'
import { generateAgentText } from './agent-engine'
import type { AnthropicResponse, ClaudeClient, CreateMessageInput } from './anthropic'

function scriptedClient(responses: AnthropicResponse[]) {
  const calls: CreateMessageInput[] = []
  let i = 0
  const client: ClaudeClient = {
    async createMessage(input) {
      calls.push(input)
      return responses[i++] ?? { stopReason: 'end_turn', content: [{ type: 'text', text: '' }] }
    },
  }
  return { client, calls }
}

const cal: Calendar = {
  id: 'cal1',
  location_id: 'locA',
  name: 'Discovery Call',
  color: 'indigo',
  duration_min: 30,
  position: 0,
  booking_enabled: true,
  booking_slug: 'discovery',
  timezone: 'America/New_York',
  slot_interval_min: 30,
  buffer_min: 0,
  notice_min: 0,
  rolling_days: 14,
  availability: [{ weekday: 1, start: '09:00', end: '17:00' }],
  booking_headline: null,
  booking_blurb: null,
  created_at: '2026-06-01T00:00:00.000Z',
}

test('no contact: one plain completion, no tools advertised, no timeline load', async () => {
  const db = new FakeDatabase()
  const { client, calls } = scriptedClient([{ stopReason: 'end_turn', content: [{ type: 'text', text: 'Hi there!' }] }])
  const text = await generateAgentText({
    client,
    db,
    locationId: 'locA',
    contactId: null,
    apiKey: 'k',
    model: 'm',
    settings: {},
    allowWrites: false,
  })
  expect(text).toBe('Hi there!')
  expect(calls[0]?.tools ?? []).toEqual([])
  expect(db.calls).toHaveLength(0)
})

test('approve-first: read tools advertised, write tools withheld, draft system prompt', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // timeline list
  const { client, calls } = scriptedClient([{ stopReason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }])
  await generateAgentText({
    client,
    db,
    locationId: 'locA',
    contactId: 'c1',
    apiKey: 'k',
    model: 'm',
    settings: {},
    allowWrites: false,
  })
  const names = (calls[0]?.tools ?? []).map((t) => t.name).sort()
  expect(names).toEqual(['check_availability', 'get_contact_context'])
  expect(calls[0]?.system).toMatch(/draft/i)
})

test('autonomous: the agent runs a real tool end-to-end through the engine', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // timeline list
  db.enqueue([cal]) // check_availability -> calendars list
  db.enqueue([]) // listByCalendarRange busy
  const { client, calls } = scriptedClient([
    {
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu', name: 'check_availability', input: { date: '2026-06-08' } }],
    },
    { stopReason: 'end_turn', content: [{ type: 'text', text: 'We have 9 AM open.' }] },
  ])
  const text = await generateAgentText({
    client,
    db,
    locationId: 'locA',
    contactId: 'c1',
    apiKey: 'k',
    model: 'm',
    settings: {},
    allowWrites: true,
    now: () => new Date('2026-06-08T12:00:00.000Z'),
  })
  expect(text).toBe('We have 9 AM open.')
  // the tool really queried the calendar, location-scoped
  const listCall = db.calls.find((c) => /FROM calendars/i.test(c.sql))
  expect(listCall?.params[0]).toBe('locA')
  // write tools advertised in autonomous mode
  expect((calls[0]?.tools ?? []).map((t) => t.name)).toContain('book_appointment')
})
