import { FakeDatabase } from '../db/fake-database'
import { buildOperatorTools, confirmOperatorWrite, type SendTextResult } from './operator-tools'

// 2026-06-18 16:00Z — a fixed "now" so the appointment range is deterministic.
const NOW = () => new Date('2026-06-18T16:00:00.000Z')

function makeTools(over: Partial<Parameters<typeof buildOperatorTools>[0]> = {}) {
  const db = new FakeDatabase()
  const tools = buildOperatorTools({ db, locationId: 'locA', allowWrites: false, now: NOW, ...over })
  return { db, tools }
}

// --- schema / write gate ----------------------------------------------------

test('read-only mode exposes exactly the six read tools', () => {
  const { tools } = makeTools({ allowWrites: false })
  expect(tools.schemas.map((s) => s.name).sort()).toEqual([
    'get_contact',
    'list_appointments',
    'list_contacts',
    'list_opportunities',
    'list_tasks',
    'search_contacts',
  ])
})

test('no tool touches money or deletes, and the only customer-message tool is the approve-gated send_text (D-36 invariant)', () => {
  for (const allowWrites of [true, false]) {
    const { tools } = makeTools({ allowWrites })
    const names = tools.schemas.map((s) => s.name)
    // money and destructive verbs are absent by construction, never merely gated
    expect(names.join(' ')).not.toMatch(/pay|charge|refund|invoice|card|bank|delete|destroy/i)
    // exactly ONE tool can reach a customer — send_text — and only in write mode.
    // No other send/message/email/sms/dm/notify/broadcast tool may slip in.
    const messagey = names.filter((n) => /send|message|email|sms|\bdm\b|notify|broadcast/i.test(n))
    expect(messagey).toEqual(allowWrites ? ['send_text'] : [])
  }
})

test('the dispatcher refuses a write tool in read-only mode without touching the DB', async () => {
  const { db, tools } = makeTools({ allowWrites: false })
  const r = await tools.dispatch({ id: 'w1', name: 'book_appointment', input: { contactId: 'c1', start: 'x' } })
  expect(r.isError).toBe(true)
  expect(r.toolUseId).toBe('w1')
  expect(r.content).toMatch(/read-only|can't do it yet|cannot|not available/i)
  expect(db.calls).toHaveLength(0)
})

test('every write verb the design names is gated, never silently runnable in read-only mode', async () => {
  const { db, tools } = makeTools({ allowWrites: false })
  for (const name of [
    'book_appointment',
    'tag_contact',
    'untag_contact',
    'create_task',
    'move_opportunity',
    'set_opportunity_status',
  ]) {
    const r = await tools.dispatch({ id: 'g', name, input: {} })
    expect(r.isError).toBe(true)
  }
  expect(db.calls).toHaveLength(0)
})

test('an unknown tool is reported as an error', async () => {
  const { tools } = makeTools()
  const r = await tools.dispatch({ id: 'u1', name: 'launch_missiles', input: {} })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/unknown tool/i)
})

// --- search_contacts --------------------------------------------------------

test('search_contacts searches the location contacts and lists the matches with ids', async () => {
  const { db, tools } = makeTools()
  db.enqueue([
    { id: 'c1', location_id: 'locA', name: 'Jane Altstatt', phones: ['+16025551234'], emails: ['jane@x.com'], tags: ['lead'] },
  ])
  const r = await tools.dispatch({ id: 't1', name: 'search_contacts', input: { query: 'altstatt' } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('Jane Altstatt')
  expect(r.content).toContain('c1')
  // location-scoped: locationId is the first bound param
  expect(db.calls[0]?.params[0]).toBe('locA')
  // and the search term rides as a LIKE pattern
  expect(String(db.calls[0]?.params[1])).toContain('altstatt')
})

test('search_contacts needs a non-empty query and never hits the DB without one', async () => {
  const { db, tools } = makeTools()
  const r = await tools.dispatch({ id: 't2', name: 'search_contacts', input: { query: '   ' } })
  expect(r.isError).toBe(true)
  expect(db.calls).toHaveLength(0)
})

test('search_contacts reports plainly when nothing matches', async () => {
  const { db, tools } = makeTools()
  db.enqueue([])
  const r = await tools.dispatch({ id: 't3', name: 'search_contacts', input: { query: 'zzz' } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/no contacts? match|nothing/i)
})

// --- get_contact ------------------------------------------------------------

test('get_contact reads one contact in full, location-scoped', async () => {
  const { db, tools } = makeTools()
  db.enqueue([
    {
      id: 'c1',
      location_id: 'locA',
      name: 'Jane Doe',
      tags: ['vip'],
      custom_fields: { city: 'Phoenix' },
      phones: ['+1602'],
      emails: ['j@x.com'],
      source: 'web',
    },
  ])
  const r = await tools.dispatch({ id: 't4', name: 'get_contact', input: { contactId: 'c1' } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('Jane Doe')
  expect(r.content).toContain('Phoenix')
  expect(db.calls[0]?.params).toContain('c1')
})

test('get_contact reports a missing contact honestly, not as a crash', async () => {
  const { db, tools } = makeTools()
  db.enqueue([])
  const r = await tools.dispatch({ id: 't5', name: 'get_contact', input: { contactId: 'nope' } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/no contact|not found/i)
})

// --- list_contacts ----------------------------------------------------------
// This is the tool that answers Admin's first question — "how many leads/contacts
// do I have?" — which the search-only contact surface could not. The COUNT is the
// headline; the recent sample is a courtesy. Count and list are two reads, so the
// fakes enqueue the count row first, then the sample rows.

test('list_contacts reports the real total count and lists recent contacts with ids', async () => {
  const { db, tools } = makeTools()
  db.enqueue([{ n: 3 }]) // count()
  db.enqueue([
    { id: 'c1', location_id: 'locA', name: 'Jane Altstatt', phones: ['+16025551234'], emails: ['jane@x.com'], tags: ['lead'] },
    { id: 'c2', location_id: 'locA', name: 'Bob Smith', phones: [], emails: [], tags: [] },
  ]) // list(limit)
  const r = await tools.dispatch({ id: 'lc1', name: 'list_contacts', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('3') // the actual number, never a refusal to count
  expect(r.content).toContain('Jane Altstatt')
  expect(r.content).toContain('c1')
  // location-scoped: the count query filters on locationId as the first bound param
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('list_contacts answers the total even when more contacts exist than it samples', async () => {
  const { db, tools } = makeTools()
  db.enqueue([{ n: 135 }]) // count() — Admin's biggest dataset
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane', phones: [], emails: [], tags: [] }]) // list(1) sample
  const r = await tools.dispatch({ id: 'lc2', name: 'list_contacts', input: { limit: 1 } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('135') // the true total, not the sampled count of 1
})

test('list_contacts says so plainly when the location has no contacts, without a second read', async () => {
  const { db, tools } = makeTools()
  db.enqueue([{ n: 0 }]) // count() -> empty; the function must short-circuit before list()
  const r = await tools.dispatch({ id: 'lc3', name: 'list_contacts', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/no contacts|none yet|0 contacts/i)
  expect(db.calls).toHaveLength(1) // count only — no wasted sample read on an empty book
})

// --- list_appointments ------------------------------------------------------

test('list_appointments lists upcoming appointments in a location-scoped range from now', async () => {
  const { db, tools } = makeTools()
  db.enqueue([
    { id: 'a1', location_id: 'locA', title: 'Discovery — Jane', starts_at: '2026-06-19T16:00:00.000Z', status: 'scheduled' },
  ])
  const r = await tools.dispatch({ id: 't6', name: 'list_appointments', input: { withinDays: 7 } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('Discovery — Jane')
  expect(r.content).toContain('2026-06-19T16:00:00.000Z')
  expect(db.calls[0]?.params[0]).toBe('locA')
  // the lower bound starts at "now"
  expect(String(db.calls[0]?.params[1])).toContain('2026-06-18')
})

test('list_appointments says so when the calendar is clear', async () => {
  const { db, tools } = makeTools()
  db.enqueue([])
  const r = await tools.dispatch({ id: 't7', name: 'list_appointments', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/no appointments|nothing/i)
})

// --- list_opportunities -----------------------------------------------------

test('list_opportunities lists deals with pipeline, stage, dollar value, and status', async () => {
  const { db, tools } = makeTools()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // pipelines
  db.enqueue([{ id: 's1', location_id: 'locA', pipeline_id: 'p1', name: 'New', position: 0 }]) // stages
  db.enqueue([
    { id: 'o1', location_id: 'locA', pipeline_id: 'p1', stage_id: 's1', name: 'Roof job', value_cents: 250000, status: 'open' },
  ]) // listByPipeline(p1)
  const r = await tools.dispatch({ id: 't8', name: 'list_opportunities', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('Roof job')
  expect(r.content).toContain('Sales')
  expect(r.content).toContain('New')
  expect(r.content).toContain('2500.00')
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('list_opportunities reports plainly when there are none', async () => {
  const { db, tools } = makeTools()
  db.enqueue([{ id: 'p1', location_id: 'locA', name: 'Sales', position: 0 }]) // pipelines
  db.enqueue([]) // stages
  db.enqueue([]) // listByPipeline(p1) -> none
  const r = await tools.dispatch({ id: 't9', name: 'list_opportunities', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/no opportunities|no deals|nothing/i)
})

// --- list_tasks -------------------------------------------------------------

test('list_tasks lists open tasks across contacts by default, naming the contact', async () => {
  const { db, tools } = makeTools()
  db.enqueue([
    { id: 'tk1', location_id: 'locA', contact_id: 'c1', contact_name: 'Jane Doe', title: 'Call back', due_at: '2026-06-20T17:00:00.000Z', completed_at: null },
    { id: 'tk2', location_id: 'locA', contact_id: 'c2', contact_name: 'Bob', title: 'Done thing', due_at: null, completed_at: '2026-06-10T00:00:00.000Z' },
  ])
  const r = await tools.dispatch({ id: 't10', name: 'list_tasks', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('Call back')
  expect(r.content).toContain('Jane Doe')
  expect(r.content).not.toContain('Done thing') // completed filtered out by default
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('list_tasks can include completed tasks when asked', async () => {
  const { db, tools } = makeTools()
  db.enqueue([
    { id: 'tk2', location_id: 'locA', contact_id: 'c2', contact_name: 'Bob', title: 'Done thing', due_at: null, completed_at: '2026-06-10T00:00:00.000Z' },
  ])
  const r = await tools.dispatch({ id: 't11', name: 'list_tasks', input: { includeCompleted: true } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toContain('Done thing')
})

test('list_tasks says so when there are no open tasks', async () => {
  const { db, tools } = makeTools()
  db.enqueue([])
  const r = await tools.dispatch({ id: 't12', name: 'list_tasks', input: {} })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/no open tasks|no tasks|nothing/i)
})

// --- slice 2: write tools PROPOSE, they never mutate inside the chat loop -----

test('approve-first mode advertises all six write tools alongside the reads', () => {
  const { tools } = makeTools({ allowWrites: true })
  const names = tools.schemas.map((s) => s.name)
  expect(names).toEqual(
    expect.arrayContaining([
      'book_appointment',
      'tag_contact',
      'untag_contact',
      'create_task',
      'move_opportunity',
      'set_opportunity_status',
    ]),
  )
})

test('in approve-first mode tag_contact PROPOSES the change, it does not perform it', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }]) // resolve: contacts.get
  const r = await tools.dispatch({ id: 'w1', name: 'tag_contact', input: { contactId: 'c1', tag: 'vip' } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/awaiting|confirm|queued|prepared/i)
  expect(r.content).not.toMatch(/tagged|added|done/i)
  expect(tools.proposals).toHaveLength(1)
  expect(tools.proposals[0]).toMatchObject({ verb: 'tag_contact', params: { contactId: 'c1', tag: 'vip' } })
  expect(tools.proposals[0]?.summary).toContain('Jane Doe')
  // the loop only READ to build the proposal; it never wrote
  expect(db.calls.every((q) => !/INSERT|UPDATE|DELETE/i.test(q.sql))).toBe(true)
})

test('tag_contact will not propose a tag for a contact that does not exist', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([]) // contacts.get -> none
  const r = await tools.dispatch({ id: 'w2', name: 'tag_contact', input: { contactId: 'ghost', tag: 'vip' } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/no contact|not found|could not find/i)
  expect(tools.proposals).toHaveLength(0)
})

test('create_task refuses to propose without a contact and never reads the DB', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  const r = await tools.dispatch({ id: 'w4', name: 'create_task', input: { title: 'Follow up' } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/which contact|search/i)
  expect(db.calls).toHaveLength(0)
  expect(tools.proposals).toHaveLength(0)
})

test('move_opportunity rejects a stage from a different pipeline before proposing', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([{ id: 'o1', location_id: 'locA', pipeline_id: 'p1', stage_id: 's1', name: 'Roof job', status: 'open' }]) // opps.get
  db.enqueue([{ id: 's9', location_id: 'locA', pipeline_id: 'p2', name: 'Won' }]) // pipelines.getStage -> different pipeline
  const r = await tools.dispatch({ id: 'w5', name: 'move_opportunity', input: { opportunityId: 'o1', stageId: 's9' } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/different pipeline|same pipeline|belongs to/i)
  expect(tools.proposals).toHaveLength(0)
})

test('set_opportunity_status rejects a status outside the allowlist before any DB read', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  const r = await tools.dispatch({ id: 'w6', name: 'set_opportunity_status', input: { opportunityId: 'o1', status: 'banana' } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/open|won|lost|abandoned/i)
  expect(db.calls).toHaveLength(0)
  expect(tools.proposals).toHaveLength(0)
})

// --- slice 2: the confirm step is the ONLY place a write actually happens -----

test('confirmOperatorWrite performs the tag write, location-scoped, and reports it done', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }]) // re-resolve: contacts.get
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: ['vip'] }]) // addTag RETURNING
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW },
    { verb: 'tag_contact', params: { contactId: 'c1', tag: 'vip' } },
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.message).toMatch(/tagged|added|vip/i)
  const writes = db.calls.filter((q) => /INSERT|UPDATE|DELETE/i.test(q.sql))
  expect(writes).toHaveLength(1)
  expect(writes[0]?.params[0]).toBe('locA')
})

test('confirmOperatorWrite refuses a verb that is not a known write tool', async () => {
  const db = new FakeDatabase()
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW },
    { verb: 'delete_everything', params: {} },
  )
  expect(res).toMatchObject({ ok: false, status: 400 })
  expect(res.message).toMatch(/unknown action|not allowed|cannot/i)
  expect(db.calls).toHaveLength(0)
})

test('confirmOperatorWrite re-resolves and refuses when the target vanished', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // re-resolve contacts.get -> gone
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW },
    { verb: 'tag_contact', params: { contactId: 'c1', tag: 'vip' } },
  )
  expect(res).toMatchObject({ ok: false, status: 400 })
  expect(res.message).toMatch(/no contact|not found/i)
  const writes = db.calls.filter((q) => /INSERT|UPDATE|DELETE/i.test(q.sql))
  expect(writes).toHaveLength(0)
})

test('confirmOperatorWrite creates a task end to end, location-scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }]) // resolve: contacts.get
  db.enqueue([{ id: 'tk1', location_id: 'locA', contact_id: 'c1', title: 'Call Jane', body: null, due_at: null, completed_at: null }]) // create RETURNING
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW },
    { verb: 'create_task', params: { contactId: 'c1', title: 'Call Jane' } },
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.message).toMatch(/created|task/i)
  const writes = db.calls.filter((q) => /INSERT|UPDATE|DELETE/i.test(q.sql))
  expect(writes).toHaveLength(1)
  expect(writes[0]?.params[0]).toBe('locA')
})

// --- slice 2: book_appointment (the only write that derives its target) -------
// Booking is back-office: the operator OVERRIDES the public slot grid, so there is
// no slotsForDate check. The proposal stores RAW {contactId, start} and a shared
// prepareBooking() re-derives the calendar + end time on BOTH the propose and the
// confirm pass — that keeps the proposal re-resolvable (idempotent) on confirm.

// Reused rows: a real contact and one bookable calendar.
const BOOK_CONTACT = { id: 'c1', location_id: 'locA', name: 'Jane Doe', tags: [] }
const BOOK_CAL = {
  id: 'cal1',
  location_id: 'locA',
  name: 'Roof Inspection',
  duration_min: 30,
  position: 0,
  booking_enabled: true,
  timezone: 'America/Phoenix',
}
const BOOK_START = '2026-06-20T17:00:00.000Z'

test('book_appointment PROPOSES a booking with RAW contactId+start params, it does not write', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([BOOK_CONTACT]) // prepareBooking: contacts.get
  db.enqueue([BOOK_CAL]) // prepareBooking: calendars.list
  const r = await tools.dispatch({ id: 'wb1', name: 'book_appointment', input: { contactId: 'c1', start: BOOK_START } })
  expect(r.isError).toBeFalsy()
  expect(r.content).toMatch(/awaiting|confirm|queued|prepared/i)
  expect(r.content).not.toMatch(/\bbooked\b/i) // never claims it already happened
  expect(tools.proposals).toHaveLength(1)
  expect(tools.proposals[0]).toMatchObject({ verb: 'book_appointment', params: { contactId: 'c1', start: BOOK_START } })
  // params stay RAW so confirm can re-resolve them — no derived calendar id leaks in
  expect(tools.proposals[0]?.params).not.toHaveProperty('calendarId')
  expect(tools.proposals[0]?.params).not.toHaveProperty('calId')
  expect(tools.proposals[0]?.summary).toContain('Jane Doe')
  expect(tools.proposals[0]?.summary).toContain('Roof Inspection')
  // the chat loop only READ to build the proposal; it never wrote
  expect(db.calls.every((q) => !/INSERT|UPDATE|DELETE/i.test(q.sql))).toBe(true)
})

test('book_appointment will not propose for a missing contact, stopping after the contact read', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([]) // contacts.get -> none
  const r = await tools.dispatch({ id: 'wb2', name: 'book_appointment', input: { contactId: 'ghost', start: BOOK_START } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/no contact|not found/i)
  expect(tools.proposals).toHaveLength(0)
  // the missing contact short-circuits before the calendar lookup ever runs
  expect(db.calls).toHaveLength(1)
})

test('book_appointment refuses to propose when the location has no calendar set up', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([BOOK_CONTACT]) // contacts.get
  db.enqueue([]) // calendars.list -> none
  const r = await tools.dispatch({ id: 'wb3', name: 'book_appointment', input: { contactId: 'c1', start: BOOK_START } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/no calendar|add one|settings/i)
  expect(tools.proposals).toHaveLength(0)
})

test('book_appointment rejects an unparseable start time before touching the DB', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  const r = await tools.dispatch({ id: 'wb4', name: 'book_appointment', input: { contactId: 'c1', start: 'next thursdayish' } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/valid|date|time/i)
  expect(db.calls).toHaveLength(0)
  expect(tools.proposals).toHaveLength(0)
})

test('confirmOperatorWrite books the appointment end to end, location-scoped, with one write', async () => {
  const db = new FakeDatabase()
  db.enqueue([BOOK_CONTACT]) // resolve: contacts.get
  db.enqueue([BOOK_CAL]) // resolve: calendars.list
  db.enqueue([BOOK_CONTACT]) // perform re-resolve: contacts.get
  db.enqueue([BOOK_CAL]) // perform re-resolve: calendars.list
  db.enqueue([
    {
      id: 'a1',
      location_id: 'locA',
      calendar_id: 'cal1',
      contact_id: 'c1',
      title: 'Roof Inspection — Jane Doe',
      starts_at: BOOK_START,
      ends_at: '2026-06-20T17:30:00.000Z',
      status: 'scheduled',
      location_text: null,
      notes: null,
      created_at: '2026-06-18T16:00:00.000Z',
      updated_at: '2026-06-18T16:00:00.000Z',
    },
  ]) // appointments.create RETURNING
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW },
    { verb: 'book_appointment', params: { contactId: 'c1', start: BOOK_START } },
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.message).toMatch(/booked/i)
  const writes = db.calls.filter((q) => /INSERT|UPDATE|DELETE/i.test(q.sql))
  expect(writes).toHaveLength(1)
  expect(writes[0]?.params[0]).toBe('locA')
})

test('confirmOperatorWrite reports a double-booked slot gently instead of crashing', async () => {
  const db = new FakeDatabase()
  db.enqueue([BOOK_CONTACT]) // resolve: contacts.get
  db.enqueue([BOOK_CAL]) // resolve: calendars.list
  db.enqueue([BOOK_CONTACT]) // perform re-resolve: contacts.get
  db.enqueue([BOOK_CAL]) // perform re-resolve: calendars.list
  db.enqueueError({ code: '23505' }) // appointments.create -> unique violation (slot already taken)
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW },
    { verb: 'book_appointment', params: { contactId: 'c1', start: BOOK_START } },
  )
  // a conflict is a benign outcome, not a 500: ok with a plain-English heads-up
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.message).toMatch(/just taken|another open time|not booked|already/i)
  const writes = db.calls.filter((q) => /INSERT|UPDATE|DELETE/i.test(q.sql))
  expect(writes).toHaveLength(1) // the INSERT was attempted (and rejected by the DB)
})

// --- slice 3: send_text — the first APPROVE-GATED outbound-message tool --------
// Admin's instruction lifted the v1 "never message a customer" posture: the agent
// may now DRAFT a text. But, exactly like every other write, it only ever PROPOSES
// in the chat loop; the single send happens later at the operator's Confirm tap
// (confirmOperatorWrite -> a real sendText rail), never inside the conversation.
//
// The destination is NEVER trusted from the model or the client. send_text is
// symmetric with book_appointment: the proposal stores only RAW {contactId, body,
// nonce} and the phone number is DERIVED from the contact on BOTH the propose and
// the confirm pass — a forged `e164` in the tool input can never redirect a text.
// A nonce is minted server-side at propose (any model/client-supplied nonce is
// ignored) so the gateway can collapse a double-tap to an at-most-once send.

// BOOK_CONTACT has no phone; send_text needs a contact WITH one on file.
const TEXT_CONTACT = { id: 'c1', location_id: 'locA', name: 'Jane Doe', phones: ['+16025551234'], emails: [], tags: [] }

test('approve-first mode advertises send_text alongside the other write tools', () => {
  const { tools } = makeTools({ allowWrites: true })
  expect(tools.schemas.map((s) => s.name)).toContain('send_text')
})

test('send_text PROPOSES with the DERIVED real phone + a server-minted nonce, ignoring a model-supplied e164/nonce', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([TEXT_CONTACT]) // prepareText: contacts.get
  const r = await tools.dispatch({
    id: 'wt1',
    name: 'send_text',
    // the model supplies a FORGED destination + nonce; both must be ignored
    input: { contactId: 'c1', body: 'Hi Jane, following up on your roof.', e164: '+19998887777', nonce: 'attacker-nonce' },
  })
  expect(r.isError).toBeFalsy()
  // it PROPOSES — it never claims the text already went out
  expect(r.content).toMatch(/awaiting|confirm|queued|prepared/i)
  expect(r.content).not.toMatch(/\bsent\b/i)
  expect(tools.proposals).toHaveLength(1)
  const p = tools.proposals[0]!
  expect(p.verb).toBe('send_text')
  // RAW params only: contactId + body + a server nonce. NEVER an e164 — the
  // destination is re-derived on confirm, never trusted from the stored params.
  expect(p.params).not.toHaveProperty('e164')
  expect(p.params.contactId).toBe('c1')
  expect(p.params.body).toBe('Hi Jane, following up on your roof.')
  // the nonce is server-minted: a non-empty string that is NOT the one the model sent
  expect(typeof p.params.nonce).toBe('string')
  expect((p.params.nonce as string).length).toBeGreaterThan(0)
  expect(p.params.nonce).not.toBe('attacker-nonce')
  // the summary names the real contact so the operator knows who they're texting
  expect(p.summary).toContain('Jane Doe')
  // the chat loop only READ to build the proposal; it never wrote
  expect(db.calls.every((q) => !/INSERT|UPDATE|DELETE/i.test(q.sql))).toBe(true)
})

test('send_text refuses to propose a text to a contact with no phone on file', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([{ id: 'c1', location_id: 'locA', name: 'Jane Doe', phones: [], emails: [], tags: [] }]) // contacts.get, no phone
  const r = await tools.dispatch({ id: 'wt2', name: 'send_text', input: { contactId: 'c1', body: 'Hi' } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/no phone|phone number/i)
  expect(tools.proposals).toHaveLength(0)
})

test('send_text refuses an empty body without ever reading the DB', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  const r = await tools.dispatch({ id: 'wt3', name: 'send_text', input: { contactId: 'c1', body: '   ' } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/what should the text say|message/i)
  expect(db.calls).toHaveLength(0)
  expect(tools.proposals).toHaveLength(0)
})

test('send_text refuses a body over the length cap', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  db.enqueue([TEXT_CONTACT]) // contacts.get (may or may not be reached; cap check is cheap-first)
  const r = await tools.dispatch({ id: 'wt4', name: 'send_text', input: { contactId: 'c1', body: 'x'.repeat(1001) } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/too long/i)
  expect(tools.proposals).toHaveLength(0)
})

test('send_text refuses to propose without a contact and never reads the DB', async () => {
  const { db, tools } = makeTools({ allowWrites: true })
  const r = await tools.dispatch({ id: 'wt5', name: 'send_text', input: { body: 'Hi there' } })
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/who is this|search/i)
  expect(db.calls).toHaveLength(0)
  expect(tools.proposals).toHaveLength(0)
})

// --- slice 3: the confirm step is the ONLY place a text actually goes out -----
// confirmOperatorWrite re-resolves {verb, params} and performs the single send via
// the injected sendText rail. The destination is re-DERIVED from contactId (so a
// forged e164 in the confirm payload is ignored) and the nonce rides through
// unchanged so the gateway can dedup a double-tap. Delivery outcomes come back as a
// SendTextResult, which maps to plain-English words that NEVER falsely claim success.

function fakeSendText(result: SendTextResult = { ok: true, messageId: 'm1' }) {
  const calls: Array<{ e164: string; body: string; nonce: string; state?: string }> = []
  const fn = async (e164: string, body: string, nonce: string, state: string): Promise<SendTextResult> => {
    calls.push({ e164, body, nonce, state })
    return result
  }
  return { fn, calls }
}

test('confirmOperatorWrite sends the text to the DERIVED phone with the echoed nonce, ignoring a forged e164', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT]) // resolve: prepareText contacts.get
  db.enqueue([TEXT_CONTACT]) // perform: prepareText contacts.get (re-derives the e164)
  const { fn, calls } = fakeSendText({ ok: true, messageId: 'm-123' })
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW, sendText: fn },
    // the confirm payload carries a FORGED e164 — it must be ignored, never trusted
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi Jane', nonce: 'n1', e164: '+19998887777' } },
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.message).toMatch(/sent/i)
  expect(res.message).toContain('Jane Doe')
  expect(calls).toHaveLength(1)
  // the rail got the contact's REAL phone, not the forged one in the payload
  expect(calls[0]).toEqual({ e164: '+16025551234', body: 'Hi Jane', nonce: 'n1', state: '' })
})

// THE HEART OF THE PER-STATE FEATURE: the contact's own US state must travel all
// the way to the rail, because the gateway is the single legal authority that
// turns that state into a texting window (8am-9pm in THAT state's timezone). If
// state never reaches the rail, a North-Carolina lead gets judged on Arizona's
// clock and a too-late evening text could go out illegally. These two tests pin
// that the value flows: a real state passes through, and no-state passes '' (which
// the gateway then refuses as unknown_state rather than guessing a timezone).
test('confirmOperatorWrite carries the contact\'s state through to the rail, so the gateway enforces the right state\'s hours', async () => {
  const db = new FakeDatabase()
  const NC = { ...TEXT_CONTACT, state: 'NC' }
  db.enqueue([NC]) // resolve read
  db.enqueue([NC]) // perform read
  const { fn, calls } = fakeSendText({ ok: true, messageId: 'm-nc' })
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW, sendText: fn },
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi Jane', nonce: 'n1' } },
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(calls).toHaveLength(1)
  expect(calls[0]?.state).toBe('NC')
})

test('confirmOperatorWrite passes an empty state when the contact has none, so the gateway blocks it as unknown', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT]) // resolve read — TEXT_CONTACT has no state field
  db.enqueue([TEXT_CONTACT]) // perform read
  const { fn, calls } = fakeSendText({ ok: true, messageId: 'm-x' })
  await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW, sendText: fn },
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi', nonce: 'n1' } },
  )
  expect(calls).toHaveLength(1)
  expect(calls[0]?.state).toBe('')
})

test('confirmOperatorWrite tells the operator to set the state when the gateway refuses as unknown_state', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT]) // resolve read
  db.enqueue([TEXT_CONTACT]) // perform read
  const fn = async (): Promise<SendTextResult> => ({ ok: false, reason: 'unknown_state' })
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW, sendText: fn },
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi', nonce: 'n1' } },
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  // honest, actionable copy: name the contact and tell the operator to set a state
  expect(res.message).toMatch(/state|which state/i)
  expect(res.message).toContain('Jane Doe')
  // it must never falsely claim the text went out
  expect(res.message).not.toMatch(/\bsent your text\b/i)
})

test('confirmOperatorWrite reports a deduped send honestly — it never claims a second text went out', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT])
  db.enqueue([TEXT_CONTACT])
  const { fn } = fakeSendText({ ok: true, messageId: 'm-1', deduped: true })
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW, sendText: fn },
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi Jane', nonce: 'n1' } },
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.message).toMatch(/already sent|didn't send it again|did not send it again/i)
  expect(res.message).not.toMatch(/\bsent your text\b/i)
})

test('confirmOperatorWrite maps each send failure reason to an honest, no-false-success sentence', async () => {
  type FailReason = Extract<SendTextResult, { ok: false }>['reason']
  const table: Array<{ reason: FailReason; re: RegExp }> = [
    { reason: 'outside_window', re: /outside .*hours|texting hours|8am and 9pm/i },
    { reason: 'unknown_state', re: /which state|set their state|don't know which state/i },
    { reason: 'not_configured', re: /not set up|isn't set up|nothing was sent/i },
    { reason: 'bad_phone', re: /phone number|can't text|nothing was sent/i },
    { reason: 'in_flight', re: /already going out|didn't send it twice|check the thread/i },
    // 'failed' is the AMBIGUOUS reason: the rail couldn't get a clear answer, so the
    // text MAY have gone out. The copy must NOT claim "nothing was sent" (that would
    // be a lie if it did) — it tells the operator to check before retrying.
    { reason: 'failed', re: /couldn't confirm|could not confirm|check the thread/i },
  ]
  for (const { reason, re } of table) {
    const db = new FakeDatabase()
    db.enqueue([TEXT_CONTACT]) // resolve read
    db.enqueue([TEXT_CONTACT]) // perform read
    const fn = async (): Promise<SendTextResult> => ({ ok: false, reason })
    const res = await confirmOperatorWrite(
      { db, locationId: 'locA', now: NOW, sendText: fn },
      { verb: 'send_text', params: { contactId: 'c1', body: 'Hi', nonce: 'n1' } },
    )
    // a non-delivery is a benign outcome (like a double-booked slot): 200 + honest words
    expect(res).toMatchObject({ ok: true, status: 200 })
    expect(res.message).toMatch(re)
    // CRUCIAL: it never falsely claims the text was sent
    expect(res.message).not.toMatch(/\bsent your text\b/i)
    // and the ambiguous 'failed' reason must NOT claim it definitely did NOT send:
    // only the reasons where the gateway refused BEFORE sending may say that.
    if (reason === 'failed') expect(res.message).not.toMatch(/nothing was sent/i)
  }
})

test('confirmOperatorWrite never silently succeeds when texting is not wired up on the server', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT]) // resolve read
  db.enqueue([TEXT_CONTACT]) // perform read
  // no sendText injected at all
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW },
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi Jane', nonce: 'n1' } },
  )
  expect(res).toMatchObject({ ok: true, status: 200 })
  expect(res.message).toMatch(/not set up|isn't set up|nothing was sent/i)
  expect(res.message).not.toMatch(/\bsent your text\b/i)
})

test('confirmOperatorWrite refuses a send_text confirm that lost its nonce, and sends nothing', async () => {
  const db = new FakeDatabase()
  db.enqueue([TEXT_CONTACT]) // resolve: prepareText reads the contact before the nonce check
  const { fn, calls } = fakeSendText()
  const res = await confirmOperatorWrite(
    { db, locationId: 'locA', now: NOW, sendText: fn },
    { verb: 'send_text', params: { contactId: 'c1', body: 'Hi Jane' } }, // nonce missing
  )
  expect(res).toMatchObject({ ok: false, status: 400 })
  expect(res.message).toMatch(/send token|draft it again/i)
  expect(calls).toHaveLength(0) // nothing was sent
})

