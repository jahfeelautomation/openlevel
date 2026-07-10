import { nanoid } from 'nanoid'
import type { Database } from '../db/database'
import { AppointmentsRepo } from '../repos/appointments-repo'
import { CalendarsRepo } from '../repos/calendars-repo'
import { ContactsRepo } from '../repos/contacts-repo'
import { ContactTasksRepo } from '../repos/contact-tasks-repo'
import { OpportunitiesRepo } from '../repos/opportunities-repo'
import { PipelinesRepo } from '../repos/pipelines-repo'
import type { AnthropicTool } from './anthropic'
import type { ToolCall, ToolResult } from './agent-runner'
import { isUniqueViolation } from './db-errors'
import { normalizePhone } from './contact-match'

/**
 * The operator assistant's tool surface for ONE location — the only door between
 * the model and the database for the "AI front door". Unlike the customer agent's
 * tools (lib/agent-tools), these are NOT pinned to a single contact: the operator
 * works across the whole location, so the tools are location-scoped and the agent
 * names a contact by searching for one (search_contacts -> id), never by guessing.
 *
 * Three properties keep it safe, exactly as in agent-tools:
 *   1. Tenancy — every repo is built with the caller's locationId, so a tool can
 *      never reach another tenant's data.
 *   2. Read/write split — slice 1 advertises only the read tools. The planned
 *      write verbs are listed in WRITE_TOOLS and the dispatcher REFUSES them while
 *      allowWrites is false, so a forged write tool_use takes no side effect.
 *   3. No money tool and no delete tool exist at all (D-36): those failure modes are
 *      absent by construction, not merely gated. The one outbound-message tool
 *      (send_text) is approve-gated like every other write — it only ever PROPOSES
 *      in the chat loop and the actual send happens at the operator's confirm tap,
 *      through a rail that never lets the agent see the texting credential.
 */

/**
 * The outcome of an actual text send, reported back from the gateway rail. A
 * discriminated union so `perform` maps every result to an honest sentence and
 * NEVER falsely claims a text went out. `deduped` means the gateway recognised a
 * repeated nonce and returned the prior send instead of texting twice.
 */
export type SendTextResult =
  | { ok: true; messageId: string; deduped?: boolean }
  | {
      ok: false
      reason: 'outside_window' | 'unknown_state' | 'not_configured' | 'bad_phone' | 'in_flight' | 'failed'
      detail?: string
    }

/**
 * Injected sender for the one outbound-message verb. It takes the DERIVED e164
 * (never a model- or client-supplied number), the body, the nonce that keys the
 * gateway's dedup, and the contact's US `state`. The state is what the gateway
 * turns into the legal texting window (8am-9pm in THAT state's own timezone); an
 * empty string means "not set", which the gateway refuses as unknown_state rather
 * than guessing a timezone. OpenLevel never holds the texting credential — this
 * calls out to the gateway rail, which owns it (D-36) and is the legal authority.
 * Absent on an unconfigured server.
 */
export type SendTextFn = (e164: string, body: string, nonce: string, state: string) => Promise<SendTextResult>

export interface OperatorToolsDeps {
  db: Database
  locationId: string
  /** false = read-only (slice 1). The write verbs stay refused. */
  allowWrites: boolean
  /** Injected clock so the appointment range is deterministic in tests. */
  now: () => Date
  /** Injected text sender (gateway rail). Absent = texting not wired up; send_text
   *  proposals still form, but confirming one honestly reports it isn't set up. */
  sendText?: SendTextFn
}

/**
 * A change the agent has PREPARED but NOT performed — the heart of "answer + act
 * on confirm". The chat loop can only ever produce one of these; performing it is
 * a separate, operator-initiated step (confirmOperatorWrite). `id` is a client-side
 * correlation handle for the confirm card — the server NEVER trusts it, it
 * re-derives the action from {verb, params} on confirm. `summary` is the plain-
 * English line the operator reads before tapping Confirm.
 */
export interface ProposedAction {
  id: string
  verb: string
  params: Record<string, unknown>
  summary: string
}

export interface OperatorToolset {
  schemas: AnthropicTool[]
  /** Run one tool. Shape matches lib/agent-runner so it plugs straight into
   *  runToolConversation's dispatchTool with no adapter. */
  dispatch: (call: ToolCall) => Promise<ToolResult>
  /** Changes the agent proposed this turn, in order. Empty in read-only mode (a
   *  write is refused before it can ever reach here) and empty until a write
   *  tool_use is dispatched. The engine returns these so the UI can render a
   *  confirm card per proposal. */
  proposals: ProposedAction[]
}

/** Tools that only read. Always advertised. */
const READ_TOOLS = ['search_contacts', 'get_contact', 'list_contacts', 'list_appointments', 'list_opportunities', 'list_tasks'] as const

/** Tools that change data — each one only PROPOSES in the chat loop and is performed
 *  later at the operator's confirm tap. send_text is the one tool that reaches a
 *  customer (an approve-gated outbound text, slice 3); it derives its destination
 *  from the contact, never from the model. Deliberately NO payment/charge/refund and
 *  NO delete tool — those failure modes stay absent by construction. */
const WRITE_TOOLS = [
  'book_appointment',
  'tag_contact',
  'untag_contact',
  'create_task',
  'move_opportunity',
  'set_opportunity_status',
  'send_text',
] as const

const MAX_ROWS_SHOWN = 25

/** Hard cap on a proposed text's length. A normal SMS is far shorter; this just
 *  stops a runaway model from queuing a wall of text. The gateway is the final
 *  authority on delivery, but a cheap length check here fails fast and plainly. */
const MAX_TEXT_BODY = 1000

const SCHEMAS: Record<string, AnthropicTool> = {
  search_contacts: {
    name: 'search_contacts',
    description:
      "Search this location's contacts by name, phone, or email. Returns up to a handful of matches, each with its id, name, phones, emails, and tags. Use the id with get_contact for full detail, or to act on a contact later. Always search before naming or acting on a contact — never guess an id.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A name, phone, or email fragment to search for.' },
        limit: { type: 'number', description: 'Max matches to return (default 20).' },
      },
      required: ['query'],
    },
  },
  get_contact: {
    name: 'get_contact',
    description:
      'Read one contact in full by id: name, phones, emails, tags, saved custom fields, and source. Use an id returned by search_contacts.',
    input_schema: {
      type: 'object',
      properties: { contactId: { type: 'string', description: 'The contact id from search_contacts.' } },
      required: ['contactId'],
    },
  },
  list_contacts: {
    name: 'list_contacts',
    description:
      'Count and list this location\'s contacts (its leads), most recently updated first. This is the tool to use whenever the operator asks "how many contacts do I have?", "how many leads?", or "how big is my list?" — it returns the TOTAL count plus a sample of the most recent contacts with their ids. To find one specific person, use search_contacts instead.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many recent contacts to show in the sample (default 25, max 25). The total count is always reported in full regardless of this.' },
      },
    },
  },
  list_appointments: {
    name: 'list_appointments',
    description:
      'List upcoming appointments for this location, soonest first, starting now. Optionally limit to the next N days (default 7).',
    input_schema: {
      type: 'object',
      properties: { withinDays: { type: 'number', description: 'How many days ahead to include (default 7).' } },
    },
  },
  list_opportunities: {
    name: 'list_opportunities',
    description:
      'List sales opportunities (deals) for this location with their pipeline, stage, dollar value, and status. Optionally filter to one pipeline or one stage by id.',
    input_schema: {
      type: 'object',
      properties: {
        pipelineId: { type: 'string', description: 'Optional pipeline id to filter to.' },
        stageId: { type: 'string', description: 'Optional stage id to filter to.' },
      },
    },
  },
  list_tasks: {
    name: 'list_tasks',
    description:
      'List operator to-do tasks across all contacts in this location, open ones first, each with the contact it belongs to and its due date. Open (incomplete) tasks only by default; pass includeCompleted to also see finished ones.',
    input_schema: {
      type: 'object',
      properties: { includeCompleted: { type: 'boolean', description: 'Include completed tasks too (default false).' } },
    },
  },
  book_appointment: {
    name: 'book_appointment',
    description:
      "Book an appointment for one contact (id from search_contacts) at a given start time. The location's booking calendar and the end time are chosen for you, so you only need the contact and the start. This is a back-office booking — it is NOT limited to the public booking page's open slots. This is a CHANGE: it is PROPOSED for the operator to confirm with a tap, not done immediately. Say what you are queuing and that you are waiting on their confirm — never claim it is booked yet.",
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact id from search_contacts.' },
        start: { type: 'string', description: 'The start as an ISO date/time, e.g. 2026-06-20T17:00:00Z.' },
        notes: { type: 'string', description: 'Optional note to attach to the appointment.' },
      },
      required: ['contactId', 'start'],
    },
  },
  tag_contact: {
    name: 'tag_contact',
    description:
      'Add a tag to one contact (by id from search_contacts). This is a CHANGE: it is PROPOSED for the operator to confirm with a tap, not done immediately. Say what you are queuing and that you are waiting on their confirm — never claim the tag is on yet.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact id from search_contacts.' },
        tag: { type: 'string', description: 'The tag to add, e.g. "vip" or "needs-callback".' },
      },
      required: ['contactId', 'tag'],
    },
  },
  untag_contact: {
    name: 'untag_contact',
    description:
      'Remove a tag from one contact (by id from search_contacts). This is a CHANGE: it is PROPOSED for the operator to confirm with a tap, not done immediately. Say what you are queuing and that you are waiting on their confirm — never claim it is removed yet.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact id from search_contacts.' },
        tag: { type: 'string', description: 'The tag to remove.' },
      },
      required: ['contactId', 'tag'],
    },
  },
  create_task: {
    name: 'create_task',
    description:
      'Create an operator to-do task on one contact (by id from search_contacts). This is a CHANGE: it is PROPOSED for the operator to confirm with a tap, not done immediately. Say what you are queuing and that you are waiting on their confirm — never claim the task exists yet.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact id from search_contacts.' },
        title: { type: 'string', description: 'A short title for the task.' },
        dueAt: { type: 'string', description: 'Optional ISO date/time the task is due.' },
      },
      required: ['contactId', 'title'],
    },
  },
  move_opportunity: {
    name: 'move_opportunity',
    description:
      "Move a deal to another stage WITHIN ITS OWN PIPELINE (both ids from list_opportunities). This is a CHANGE: it is PROPOSED for the operator to confirm with a tap, not done immediately. Say what you are queuing and that you are waiting on their confirm — never claim it moved yet.",
    input_schema: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'The deal id from list_opportunities.' },
        stageId: { type: 'string', description: "A stage id from the deal's own pipeline." },
      },
      required: ['opportunityId', 'stageId'],
    },
  },
  set_opportunity_status: {
    name: 'set_opportunity_status',
    description:
      'Set a deal\'s status to open, won, lost, or abandoned (id from list_opportunities). This is a CHANGE: it is PROPOSED for the operator to confirm with a tap, not done immediately. Say what you are queuing and that you are waiting on their confirm — never claim the status changed yet.',
    input_schema: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'The deal id from list_opportunities.' },
        status: {
          type: 'string',
          enum: ['open', 'won', 'lost', 'abandoned'],
          description: 'One of: open, won, lost, abandoned.',
        },
      },
      required: ['opportunityId', 'status'],
    },
  },
  send_text: {
    name: 'send_text',
    description:
      "Draft a text message to one contact (id from search_contacts) to go out from the business's texting line. You supply only the contact and the message — the phone number is looked up for you, so never put a phone number in your arguments. This is a CHANGE that reaches a real person: it is PROPOSED for the operator to confirm with a tap, never sent immediately. Say what you've drafted and that you're waiting on their confirm — never claim the text was sent. Texting hours and actual delivery are handled at the moment they confirm.",
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact id from search_contacts.' },
        body: { type: 'string', description: 'The message text. Keep it to a normal text-message length.' },
      },
      required: ['contactId', 'body'],
    },
  },
}

/** A tool's outcome before the dispatcher stamps on the tool_use id. */
type Outcome = { content: string; isError?: boolean }

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
  return Math.min(max, Math.max(min, n))
}

function fmtList(arr: unknown): string {
  return Array.isArray(arr) && arr.length > 0 ? arr.join(', ') : '(none)'
}

function dollars(cents: unknown): string {
  const n = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0
  return `$${(n / 100).toFixed(2)}`
}

/** The only statuses a deal may be set to. Validated before any DB read. */
const OPP_STATUSES = ['open', 'won', 'lost', 'abandoned'] as const

/** Trim a value to a string, or '' if it isn't one. */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** A human, timezone-aware rendering of an appointment time for the confirm card —
 *  e.g. "Jun 20, 2026, 10:00 AM". Falls back to the raw ISO string if the calendar's
 *  timezone is not a recognised IANA zone (Intl throws on a bad zone). */
function humanWhen(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(date)
  } catch {
    return date.toISOString()
  }
}

type ResolveOk = { ok: true; summary: string; params: Record<string, unknown> }
type ResolveErr = { ok: false; error: string }
type ResolveResult = ResolveOk | ResolveErr

interface WriteOpsDeps {
  db: Database
  locationId: string
  now: () => Date
  sendText?: SendTextFn
}

/**
 * The write half of the operator toolset, factored out so the SAME validation and
 * the SAME mutation back BOTH paths: the propose path (chat loop) and the confirm
 * path (confirmOperatorWrite). `resolve` only READS — it checks the inputs and
 * looks up the targets to build a plain-English summary, never mutating. `perform`
 * does the single write. Sharing them guarantees the confirm step re-checks exactly
 * what the proposal claimed, so a target deleted between propose and confirm is
 * caught rather than blindly written.
 */
function makeWriteOps({ db, locationId, sendText }: WriteOpsDeps) {
  const contacts = new ContactsRepo(db, locationId)
  const tasks = new ContactTasksRepo(db, locationId)
  const opps = new OpportunitiesRepo(db, locationId)
  const pipelines = new PipelinesRepo(db, locationId)
  const appointments = new AppointmentsRepo(db, locationId)
  const calendars = new CalendarsRepo(db, locationId)

  /**
   * Read-only derivation shared by BOTH the propose pass and the confirm pass:
   * validate the inputs, confirm the contact exists, pick the location's booking
   * calendar, and compute the end time + title. Returns everything either pass
   * needs, or a plain-English error. It NEVER writes, so re-running it on confirm
   * safely re-checks that the target still exists — that is what lets the proposal
   * store only the RAW {contactId, start} and stay re-resolvable (idempotent).
   * Order is load-bearing: the cheap input checks run first (no DB), then the
   * contact read, then the calendar read — a missing contact short-circuits before
   * the calendar lookup.
   */
  type BookingPrep =
    | {
        ok: true
        contactId: string
        calId: string
        calName: string
        who: string
        startsAt: string
        endsAt: string
        title: string
        when: string
      }
    | { ok: false; error: string }
  async function prepareBooking(input: Record<string, unknown>): Promise<BookingPrep> {
    const contactId = str(input.contactId)
    if (!contactId)
      return { ok: false, error: 'Who is this for? Search for the contact first with search_contacts, then try again.' }
    const start = str(input.start)
    if (!start) return { ok: false, error: 'When should it be? Give me a start date and time.' }
    const startDate = new Date(start)
    if (Number.isNaN(startDate.getTime()))
      return { ok: false, error: `"${start}" is not a valid date/time. Use an ISO time like 2026-06-20T17:00:00Z.` }
    const c = await contacts.get(contactId)
    if (!c) return { ok: false, error: `No contact found with id ${contactId}.` }
    const cals = await calendars.list()
    const cal = cals.find((x) => x.booking_enabled) ?? cals[0]
    if (!cal) return { ok: false, error: 'There is no calendar set up yet — add one in Settings before booking.' }
    const who = c.name ?? 'Appointment'
    const startsAt = startDate.toISOString()
    const endsAt = new Date(startDate.getTime() + cal.duration_min * 60_000).toISOString()
    return {
      ok: true,
      contactId,
      calId: cal.id,
      calName: cal.name,
      who,
      startsAt,
      endsAt,
      title: `${cal.name} — ${who}`,
      when: humanWhen(startDate, cal.timezone),
    }
  }

  /**
   * Read-only derivation shared by BOTH passes for send_text, exactly like
   * prepareBooking: validate the inputs, confirm the contact exists, and DERIVE the
   * destination phone from the contact's own record. The proposal therefore stores
   * only {contactId, body, nonce} — never a phone number — so a forged `e164` in the
   * tool input or the confirm payload can never redirect a text. Order is load-
   * bearing: the cheap input checks run first (no DB), then the single contact read.
   */
  type TextPrep =
    | { ok: true; contactId: string; who: string; e164: string; body: string; state: string }
    | { ok: false; error: string }
  async function prepareText(input: Record<string, unknown>): Promise<TextPrep> {
    const contactId = str(input.contactId)
    if (!contactId)
      return { ok: false, error: 'Who is this text for? Search for the contact first with search_contacts, then try again.' }
    const body = str(input.body)
    if (!body) return { ok: false, error: 'What should the text say? Give me the message.' }
    if (body.length > MAX_TEXT_BODY)
      return { ok: false, error: `That message is too long (${body.length} characters). Keep it under ${MAX_TEXT_BODY}.` }
    const c = await contacts.get(contactId)
    if (!c) return { ok: false, error: `No contact found with id ${contactId}.` }
    const who = c.name ?? 'that contact'
    const rawPhone = Array.isArray(c.phones) ? str(c.phones[0]) : ''
    const e164 = rawPhone ? normalizePhone(rawPhone) : ''
    if (!e164 || !/\d/.test(e164))
      return { ok: false, error: `No phone number on file for ${who}, so I can't text them. Add a phone number to their contact first.` }
    // The contact's US state rides through to the gateway, which alone decides the
    // legal texting window for it. No state on file collapses to '' — the gateway
    // then blocks the send as unknown_state instead of guessing a timezone. We do
    // NOT normalize here; the gateway is the legal authority and normalizes on read.
    const state = str(c.state)
    return { ok: true, contactId, who, e164, body, state }
  }

  /**
   * `mode` exists for ONE reason: the send_text nonce. On 'propose' the nonce is
   * minted server-side here (any model- or client-supplied nonce is ignored), and on
   * 'confirm' the echoed nonce from the proposal is used verbatim so the gateway can
   * collapse a double-tap to a single send. Every other verb ignores `mode`.
   */
  async function resolve(verb: string, input: Record<string, unknown>, mode: 'propose' | 'confirm'): Promise<ResolveResult> {
    switch (verb) {
      case 'book_appointment': {
        const prep = await prepareBooking(input)
        if (!prep.ok) return { ok: false, error: prep.error }
        const notes = str(input.notes)
        const summary = `Book "${prep.calName}" for ${prep.who} on ${prep.when}`
        // RAW params only — the confirm pass re-derives the calendar + end time, so
        // a derived calendar id must NOT leak into what gets stored and re-resolved.
        const params: Record<string, unknown> = notes
          ? { contactId: prep.contactId, start: str(input.start), notes }
          : { contactId: prep.contactId, start: str(input.start) }
        return { ok: true, summary, params }
      }
      case 'tag_contact':
      case 'untag_contact': {
        const contactId = str(input.contactId)
        const tag = str(input.tag)
        if (!contactId) return { ok: false, error: 'Which contact? Search for them first with search_contacts, then try again.' }
        if (!tag) return { ok: false, error: 'What tag? Give me the exact tag text.' }
        const c = await contacts.get(contactId)
        if (!c) return { ok: false, error: `No contact found with id ${contactId}.` }
        const who = c.name ?? 'that contact'
        const summary = verb === 'tag_contact' ? `Tag ${who} as "${tag}"` : `Remove the tag "${tag}" from ${who}`
        return { ok: true, summary, params: { contactId, tag } }
      }
      case 'create_task': {
        const contactId = str(input.contactId)
        const title = str(input.title)
        const dueAt = str(input.dueAt)
        if (!contactId)
          return { ok: false, error: 'Which contact is this task for? Search for them first with search_contacts, then try again.' }
        if (!title) return { ok: false, error: 'What should the task say? Give me a short title.' }
        const c = await contacts.get(contactId)
        if (!c) return { ok: false, error: `No contact found with id ${contactId}.` }
        const who = c.name ?? 'that contact'
        const summary = `Create task "${title}" for ${who}${dueAt ? ` (due ${dueAt})` : ''}`
        return { ok: true, summary, params: dueAt ? { contactId, title, dueAt } : { contactId, title } }
      }
      case 'move_opportunity': {
        const opportunityId = str(input.opportunityId)
        const stageId = str(input.stageId)
        if (!opportunityId) return { ok: false, error: 'Which deal? Use a deal id from list_opportunities.' }
        if (!stageId) return { ok: false, error: "Which stage? Use a stage id from the deal's own pipeline." }
        const opp = await opps.get(opportunityId)
        if (!opp) return { ok: false, error: `No deal found with id ${opportunityId}.` }
        const stage = await pipelines.getStage(stageId)
        if (!stage) return { ok: false, error: `No stage found with id ${stageId}.` }
        if (stage.pipeline_id !== opp.pipeline_id)
          return { ok: false, error: "That stage is in a different pipeline than the deal — pick a stage from the deal's own pipeline." }
        const summary = `Move deal "${opp.name}" to stage "${stage.name}"`
        return { ok: true, summary, params: { opportunityId, stageId } }
      }
      case 'set_opportunity_status': {
        const opportunityId = str(input.opportunityId)
        const status = str(input.status)
        if (!(OPP_STATUSES as readonly string[]).includes(status))
          return { ok: false, error: 'Status must be one of: open, won, lost, abandoned.' }
        if (!opportunityId) return { ok: false, error: 'Which deal? Use a deal id from list_opportunities.' }
        const opp = await opps.get(opportunityId)
        if (!opp) return { ok: false, error: `No deal found with id ${opportunityId}.` }
        const summary = `Mark deal "${opp.name}" as ${status}`
        return { ok: true, summary, params: { opportunityId, status } }
      }
      case 'send_text': {
        const prep = await prepareText(input)
        if (!prep.ok) return { ok: false, error: prep.error }
        // Mint the nonce on propose; echo the proposal's on confirm. The nonce is the
        // gateway's dedup key, so it MUST survive in the stored params unchanged.
        const nonce = mode === 'confirm' ? str(input.nonce) : nanoid()
        if (mode === 'confirm' && !nonce)
          return { ok: false, error: 'This text proposal is missing its send token — ask me to draft it again.' }
        const preview = prep.body.length > 60 ? `${prep.body.slice(0, 57)}...` : prep.body
        const summary = `Text ${prep.who}: "${preview}"`
        // RAW params only — NEVER an e164. The destination is re-derived from
        // contactId on confirm, so a forged phone in the payload can't redirect it.
        return { ok: true, summary, params: { contactId: prep.contactId, body: prep.body, nonce } }
      }
      default:
        return { ok: false, error: `The ${verb} action is not available yet.` }
    }
  }

  async function perform(verb: string, params: Record<string, unknown>): Promise<string> {
    switch (verb) {
      case 'book_appointment': {
        const prep = await prepareBooking(params)
        if (!prep.ok) return prep.error // target vanished between propose and confirm
        const notes = str(params.notes)
        try {
          const appt = await appointments.create({
            calendarId: prep.calId,
            contactId: prep.contactId,
            title: prep.title,
            startsAt: prep.startsAt,
            endsAt: prep.endsAt,
            notes: notes || null,
          })
          return `Booked "${appt.title}" for ${prep.when}.`
        } catch (err) {
          // A double-book is a benign conflict, not a fault: report it plainly and
          // return ok so the operator just picks another time. Any other error
          // rethrows — a real fault must never be masked as a slot clash.
          if (isUniqueViolation(err))
            return 'That time was just taken by another booking — pick another open time. Nothing was booked.'
          throw err
        }
      }
      case 'tag_contact': {
        const c = await contacts.addTag(str(params.contactId), str(params.tag))
        if (!c) return 'That contact no longer exists — nothing was changed.'
        return `Tagged ${c.name ?? 'the contact'} as "${str(params.tag)}".`
      }
      case 'untag_contact': {
        const c = await contacts.removeTag(str(params.contactId), str(params.tag))
        if (!c) return 'That contact no longer exists — nothing was changed.'
        return `Removed the tag "${str(params.tag)}" from ${c.name ?? 'the contact'}.`
      }
      case 'create_task': {
        const dueAt = str(params.dueAt)
        const t = await tasks.create({ contactId: str(params.contactId), title: str(params.title), dueAt: dueAt || undefined })
        return `Created the task "${t.title}".`
      }
      case 'move_opportunity': {
        const o = await opps.move(str(params.opportunityId), str(params.stageId))
        if (!o) return 'That deal no longer exists — nothing was changed.'
        return `Moved the deal "${o.name}" to its new stage.`
      }
      case 'set_opportunity_status': {
        const o = await opps.setStatus(str(params.opportunityId), str(params.status))
        if (!o) return 'That deal no longer exists — nothing was changed.'
        return `Marked the deal "${o.name}" as ${str(params.status)}.`
      }
      case 'send_text': {
        // Re-derive the destination from contactId (a forged e164 in params is
        // ignored) and read back the same nonce the proposal carried. The single
        // send goes through the injected gateway rail; OpenLevel never sees the
        // texting credential. Every outcome maps to an honest sentence — we never
        // claim a text went out unless the rail says it did.
        const prep = await prepareText(params)
        if (!prep.ok) return prep.error // contact or phone vanished between propose and confirm
        const nonce = str(params.nonce)
        if (!sendText) return "Texting isn't set up on this server yet, so nothing was sent."
        // The contact's state goes to the gateway, which turns it into the legal
        // texting window. An empty state comes back as unknown_state below.
        const result = await sendText(prep.e164, prep.body, nonce, prep.state)
        if (result.ok) {
          return result.deduped
            ? `That text to ${prep.who} was already sent, so I didn't send it again.`
            : `Sent your text to ${prep.who}.`
        }
        switch (result.reason) {
          case 'outside_window':
            return "It's outside legal texting hours right now, so nothing was sent. Texts can only go out between 8am and 9pm in the contact's own state."
          case 'unknown_state':
            // We can't know the legal hours without knowing the state, so we refuse
            // rather than guess (a wrong guess could send a text too late). Actionable.
            return `I don't know which state ${prep.who} is in, so I can't tell which texting hours are legal there. Set their state on the contact, then I can send.`
          case 'not_configured':
            return "Texting isn't set up on this server yet, so nothing was sent."
          case 'bad_phone':
            return `${prep.who}'s phone number doesn't look like one I can text, so nothing was sent.`
          case 'in_flight':
            return `That text to ${prep.who} is already going out, so I didn't send it twice. Check the thread to confirm it landed.`
          case 'failed':
          default:
            // AMBIGUOUS: the rail couldn't get a clear answer, so the text may or
            // may not have gone out. We must NOT claim "nothing was sent" — that
            // would be a lie if it did. Tell the operator to look before retrying.
            return `I couldn't confirm the text to ${prep.who} went through. Check the thread before sending again, so they don't get it twice.`
        }
      }
      default:
        return `The ${verb} action is not available yet.`
    }
  }

  return { resolve, perform }
}

export function buildOperatorTools(deps: OperatorToolsDeps): OperatorToolset {
  const { db, locationId, allowWrites, now, sendText } = deps
  const writeOps = makeWriteOps({ db, locationId, now, sendText })
  const proposals: ProposedAction[] = []

  // Read schemas are always advertised. In approve-first mode the write schemas
  // join them — but the write tools still only PROPOSE (see dispatch). A write
  // verb with no schema yet (book_appointment, commit B) is filtered out here.
  const writeNames = allowWrites ? WRITE_TOOLS.filter((n) => SCHEMAS[n]) : []
  const schemas = [...READ_TOOLS, ...writeNames].map((n) => SCHEMAS[n]!).filter(Boolean)

  async function searchContacts(input: Record<string, unknown>): Promise<Outcome> {
    const query = typeof input.query === 'string' ? input.query.trim() : ''
    if (!query) return { content: 'search_contacts needs a non-empty `query`.', isError: true }
    const limit = clampInt(input.limit, 20, 1, 50)
    const contacts = await new ContactsRepo(db, locationId).search(query, limit)
    if (contacts.length === 0) return { content: `No contacts match "${query}".` }
    const lines = contacts.slice(0, MAX_ROWS_SHOWN).map((c) => {
      const tags = Array.isArray(c.tags) && c.tags.length > 0 ? ` — tags: ${c.tags.join(', ')}` : ''
      return `- ${c.name ?? '(no name)'} [id=${c.id}] — phones: ${fmtList(c.phones)} — emails: ${fmtList(c.emails)}${tags}`
    })
    return { content: `${contacts.length} match${contacts.length === 1 ? '' : 'es'} for "${query}":\n${lines.join('\n')}` }
  }

  async function getContact(input: Record<string, unknown>): Promise<Outcome> {
    const id = typeof input.contactId === 'string' ? input.contactId.trim() : ''
    if (!id) return { content: 'get_contact needs a `contactId`.', isError: true }
    const c = await new ContactsRepo(db, locationId).get(id)
    if (!c) return { content: `No contact found with id ${id}.` }
    const fields =
      c.custom_fields && Object.keys(c.custom_fields).length > 0
        ? Object.entries(c.custom_fields)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join('; ')
        : '(none)'
    return {
      content: [
        `Name: ${c.name ?? '(unknown)'} [id=${c.id}]`,
        `Phones: ${fmtList(c.phones)}`,
        `Emails: ${fmtList(c.emails)}`,
        `Tags: ${fmtList(c.tags)}`,
        `Saved fields: ${fields}`,
        `Source: ${c.source ?? '(unknown)'}`,
      ].join('\n'),
    }
  }

  async function listContacts(input: Record<string, unknown>): Promise<Outcome> {
    const limit = clampInt(input.limit, MAX_ROWS_SHOWN, 1, MAX_ROWS_SHOWN)
    const repo = new ContactsRepo(db, locationId)
    // Count first: it is the headline answer ("how many leads do I have?"). On an
    // empty book, short-circuit — no point spending a second read to sample zero rows.
    const total = await repo.count()
    if (total === 0) return { content: 'This location has no contacts yet.' }
    const rows = await repo.list(limit)
    const lines = rows.map((c) => {
      const tags = Array.isArray(c.tags) && c.tags.length > 0 ? ` — tags: ${c.tags.join(', ')}` : ''
      return `- ${c.name ?? '(no name)'} [id=${c.id}] — phones: ${fmtList(c.phones)} — emails: ${fmtList(c.emails)}${tags}`
    })
    const more = total > rows.length ? `\n(Showing the ${rows.length} most recently updated; ${total - rows.length} more not shown.)` : ''
    return {
      content: `This location has ${total} contact${total === 1 ? '' : 's'} total.\nMost recent:\n${lines.join('\n')}${more}`,
    }
  }

  async function listAppointments(input: Record<string, unknown>): Promise<Outcome> {
    const withinDays = clampInt(input.withinDays, 7, 1, 90)
    const from = now()
    const to = new Date(from.getTime() + withinDays * 24 * 60 * 60 * 1000)
    const appts = await new AppointmentsRepo(db, locationId).listByRange(from.toISOString(), to.toISOString())
    if (appts.length === 0) return { content: `No appointments in the next ${withinDays} day${withinDays === 1 ? '' : 's'}.` }
    const lines = appts
      .slice(0, MAX_ROWS_SHOWN)
      .map((a) => `- ${a.title} — starts ${a.starts_at} [${a.status}]`)
    return { content: `Upcoming appointments (next ${withinDays} day${withinDays === 1 ? '' : 's'}):\n${lines.join('\n')}` }
  }

  async function listOpportunities(input: Record<string, unknown>): Promise<Outcome> {
    const wantPipeline = typeof input.pipelineId === 'string' ? input.pipelineId.trim() : ''
    const wantStage = typeof input.stageId === 'string' ? input.stageId.trim() : ''
    const pipelines = await new PipelinesRepo(db, locationId).listWithStages()
    const pipelineName = (pid: string) => pipelines.find((p) => p.id === pid)?.name ?? '(unknown pipeline)'
    const stageName = (pid: string, sid: string) =>
      pipelines.find((p) => p.id === pid)?.stages.find((s) => s.id === sid)?.name ?? '(unknown stage)'

    const targets = wantPipeline ? pipelines.filter((p) => p.id === wantPipeline) : pipelines
    const oppRepo = new OpportunitiesRepo(db, locationId)
    let opps = []
    for (const p of targets) opps.push(...(await oppRepo.listByPipeline(p.id)))
    if (wantStage) opps = opps.filter((o) => o.stage_id === wantStage)
    if (opps.length === 0) return { content: 'No opportunities match.' }
    const lines = opps
      .slice(0, MAX_ROWS_SHOWN)
      .map(
        (o) =>
          `- ${o.name} — ${dollars(o.value_cents)} — ${pipelineName(o.pipeline_id)} / ${stageName(o.pipeline_id, o.stage_id)} [${o.status}]`,
      )
    return { content: `${opps.length} opportunit${opps.length === 1 ? 'y' : 'ies'}:\n${lines.join('\n')}` }
  }

  async function listTasks(input: Record<string, unknown>): Promise<Outcome> {
    const includeCompleted = input.includeCompleted === true
    const all = await new ContactTasksRepo(db, locationId).listForLocation()
    const tasks = includeCompleted ? all : all.filter((t) => t.completed_at === null)
    if (tasks.length === 0) return { content: includeCompleted ? 'No tasks.' : 'No open tasks.' }
    const lines = tasks.slice(0, MAX_ROWS_SHOWN).map((t) => {
      const who = t.contact_name ?? '(no contact)'
      const due = t.due_at ? ` — due ${t.due_at}` : ''
      const state = t.completed_at ? 'done' : 'open'
      return `- ${t.title} — ${who}${due} [${state}]`
    })
    return { content: `${tasks.length} task${tasks.length === 1 ? '' : 's'}${includeCompleted ? '' : ' (open)'}:\n${lines.join('\n')}` }
  }

  async function dispatch(call: ToolCall): Promise<ToolResult> {
    const isWrite = (WRITE_TOOLS as readonly string[]).includes(call.name)
    if (isWrite && !allowWrites) {
      return {
        toolUseId: call.id,
        content:
          "This action changes data and is not available in read-only mode. Tell the operator plainly what you would do and that you can't do it yet — do not pretend it happened.",
        isError: true,
      }
    }
    try {
      if (isWrite) {
        // The chat loop NEVER mutates. A write tool_use only ever produces a
        // proposal: validate + look up the target (read-only), then queue it for
        // the operator's confirm tap. The worst a forged or prompt-injected write
        // tool_use can do is add a proposal — which changes nothing until the
        // operator taps Confirm (confirmOperatorWrite).
        const r = await writeOps.resolve(call.name, call.input, 'propose')
        if (!r.ok) return { toolUseId: call.id, content: r.error, isError: true }
        proposals.push({ id: nanoid(), verb: call.name, params: r.params, summary: r.summary })
        return {
          toolUseId: call.id,
          content: `Prepared: ${r.summary}. This is AWAITING the operator's confirm tap — it has NOT happened yet. Tell the operator what you've queued and that you're waiting on their tap; never claim it is finished.`,
        }
      }
      switch (call.name) {
        case 'search_contacts':
          return { toolUseId: call.id, ...(await searchContacts(call.input)) }
        case 'get_contact':
          return { toolUseId: call.id, ...(await getContact(call.input)) }
        case 'list_contacts':
          return { toolUseId: call.id, ...(await listContacts(call.input)) }
        case 'list_appointments':
          return { toolUseId: call.id, ...(await listAppointments(call.input)) }
        case 'list_opportunities':
          return { toolUseId: call.id, ...(await listOpportunities(call.input)) }
        case 'list_tasks':
          return { toolUseId: call.id, ...(await listTasks(call.input)) }
        default:
          return { toolUseId: call.id, content: `unknown tool: ${call.name}`, isError: true }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { toolUseId: call.id, content: `Could not run ${call.name}: ${message}`, isError: true }
    }
  }

  return { schemas, dispatch, proposals }
}

/** What confirmOperatorWrite needs: the same tenancy as the chat loop. locationId
 *  MUST come from the trusted session/route layer (c.get('locationId')), never the
 *  request payload. */
export interface ConfirmDeps {
  db: Database
  locationId: string
  now?: () => Date
  sendText?: SendTextFn
}

/** The action to perform, exactly as the proposal recorded it. The proposal's id
 *  is deliberately NOT here: the server re-derives everything from {verb, params},
 *  so a forged or stale id can never redirect the write. */
export interface ConfirmInput {
  verb: string
  params: Record<string, unknown>
}

export interface ConfirmResult {
  ok: boolean
  status: 200 | 400
  message: string
}

/**
 * Perform ONE proposed write, statelessly — the only path in the whole assistant
 * that mutates. It re-validates the verb against the write allowlist (a forged
 * verb is refused), re-resolves {verb, params} against the live DB (a target
 * deleted since the proposal is caught here, not blindly written), then performs
 * the single write. There is no proposal store: the proposal's id was a UI handle
 * only, and trust lives entirely in this server-side re-resolution.
 */
export async function confirmOperatorWrite(deps: ConfirmDeps, action: ConfirmInput): Promise<ConfirmResult> {
  const now = deps.now ?? (() => new Date())
  if (!(WRITE_TOOLS as readonly string[]).includes(action.verb)) {
    return { ok: false, status: 400, message: `Unknown action "${action.verb}". Nothing was changed.` }
  }
  const ops = makeWriteOps({ db: deps.db, locationId: deps.locationId, now, sendText: deps.sendText })
  const r = await ops.resolve(action.verb, action.params ?? {}, 'confirm')
  if (!r.ok) return { ok: false, status: 400, message: r.error }
  return { ok: true, status: 200, message: await ops.perform(action.verb, r.params) }
}
