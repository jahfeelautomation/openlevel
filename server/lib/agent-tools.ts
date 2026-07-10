import type { Database } from '../db/database'
import type { WorkflowDispatch } from '../jobs/workflow-dispatcher'
import { AppointmentsRepo } from '../repos/appointments-repo'
import { CalendarsRepo, type Calendar } from '../repos/calendars-repo'
import { ContactsRepo } from '../repos/contacts-repo'
import { TimelineRepo } from '../repos/timeline-repo'
import type { AnthropicTool } from './anthropic'
import { bookableDates, dateLabel, parseYmd, slotsForDate, zonedYmd } from './availability'
import { calendarBusyFor, toConfig } from './booking-availability'
import { isUniqueViolation } from './db-errors'

/** A tool invocation handed down from the runner (lib/agent-runner). */
export interface AgentToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/** The result of running one tool, in the runner's `tool_result` shape. */
export interface AgentToolResult {
  toolUseId: string
  content: string
  isError?: boolean
}

export interface AgentToolsDeps {
  db: Database
  locationId: string
  /** The conversation's contact. EVERY write tool acts on this id, never on one
   *  the model supplies — the agent cannot reach across to another contact. */
  contactId: string
  /** True only in autonomous reply mode. Gates whether write tools exist at all
   *  and whether the dispatcher will run them. */
  allowWrites: boolean
  now: () => Date
  /** Fires `appointment_booked` so booking drives the same automation loop the
   *  public page does. Optional so read-only callers need not supply it. */
  dispatch?: WorkflowDispatch
}

export interface AgentToolset {
  /** Tool schemas to advertise to the model this turn (read-only or read+write). */
  schemas: AnthropicTool[]
  /** Run one tool. Enforces the write gate again here as defense-in-depth, so a
   *  forged tool_use the schema never advertised still cannot take a side effect. */
  dispatch: (call: AgentToolCall) => Promise<AgentToolResult>
}

const MAX_SLOTS_SHOWN = 20

const READ_TOOLS = ['check_availability', 'get_contact_context'] as const
const WRITE_TOOLS = ['book_appointment', 'add_tag'] as const

const SCHEMAS: Record<string, AnthropicTool> = {
  check_availability: {
    name: 'check_availability',
    description:
      'Look up real open appointment times on the business booking calendar. Optionally pass a target date (YYYY-MM-DD); with no date you get the soonest open day. Always call this before offering or confirming any time — never invent availability.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Optional target date in YYYY-MM-DD form.' },
      },
    },
  },
  get_contact_context: {
    name: 'get_contact_context',
    description:
      "Read the current contact's name, tags, and saved fields so you can personalize the reply. Returns only this conversation's contact.",
    input_schema: { type: 'object', properties: {} },
  },
  book_appointment: {
    name: 'book_appointment',
    description:
      'Reserve an open time for THIS contact on the booking calendar. `start` must be the exact ISO start value returned by check_availability. Only book a time the customer has clearly agreed to.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Exact ISO start instant from check_availability.' },
        notes: { type: 'string', description: 'Optional short note for the appointment.' },
      },
      required: ['start'],
    },
  },
  add_tag: {
    name: 'add_tag',
    description:
      "Add a single organizational tag to THIS contact (e.g. 'hot-lead', 'wants-callback'). Use sparingly, only when it reflects something the customer actually said.",
    input_schema: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'The tag to add.' } },
      required: ['tag'],
    },
  },
}

/**
 * The agent's tool surface for one conversation.
 *
 * This is the ONLY door between the model and the database. Three properties make
 * it safe:
 *   1. Tenancy — every repo is constructed with the caller's `locationId`, so a
 *      tool can never read or write another tenant's data.
 *   2. Contact pinning — write tools always act on `deps.contactId`; a model that
 *      hallucinates a different contact id simply cannot express it.
 *   3. Write gate — in approve-first mode the write SCHEMAS are withheld AND the
 *      dispatcher refuses them, so a draft-only agent takes no side effects even
 *      if a tool call is somehow forged.
 * There is deliberately no payment/charge/refund tool: money moves only through the
 * processor, never through the agent.
 */
export function buildAgentTools(deps: AgentToolsDeps): AgentToolset {
  const { db, locationId, contactId, allowWrites, now } = deps
  const workflowDispatch = deps.dispatch

  const names = allowWrites ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS]
  const schemas = names.map((n) => SCHEMAS[n]!).filter(Boolean)

  /** Resolve the single booking-enabled calendar (multi-calendar disambiguation
   *  is intentionally out of scope — we take the first by display order). */
  async function bookingCalendar(): Promise<Calendar | undefined> {
    const cals = await new CalendarsRepo(db, locationId).list()
    return cals.find((c) => c.booking_enabled)
  }

  function describeDay(ymd: string, slots: { start: string; label: string }[]): string {
    if (slots.length === 0) return `No open times on ${ymd} (${dateLabel(ymd)}).`
    const shown = slots.slice(0, MAX_SLOTS_SHOWN)
    const lines = shown.map((s) => `- ${s.label}  [start=${s.start}]`)
    const more = slots.length > shown.length ? `\n(+${slots.length - shown.length} more later that day)` : ''
    return `Open times on ${ymd} (${dateLabel(ymd)}):\n${lines.join('\n')}${more}`
  }

  async function checkAvailability(input: Record<string, unknown>): Promise<AgentToolResult['content']> {
    const cal = await bookingCalendar()
    if (!cal) return "There is no booking calendar available right now, so I can't offer specific times."
    const config = toConfig(cal)

    let target: string | undefined
    if (typeof input.date === 'string' && input.date.trim()) {
      try {
        parseYmd(input.date.trim())
        target = input.date.trim()
      } catch {
        // unreadable date — fall back to the soonest open day
      }
    }

    const upcoming = bookableDates(config, now())
    const chosen = target ?? upcoming[0]
    const header = `Calendar: ${cal.name} (${config.timezone})`
    if (!chosen) return `${header}\nThere are no open days in the booking window right now.`

    const busy = await calendarBusyFor(db, locationId, cal, chosen)
    const slots = slotsForDate(config, chosen, busy, now())
    const daysLine =
      upcoming.length > 0 ? `Upcoming open days: ${upcoming.slice(0, 6).map(dateLabel).join('; ')}` : ''
    return [header, daysLine, describeDay(chosen, slots), 'To book, call book_appointment with the exact start value of the chosen time.']
      .filter(Boolean)
      .join('\n')
  }

  async function getContactContext(): Promise<AgentToolResult['content']> {
    const contact = await new ContactsRepo(db, locationId).get(contactId)
    if (!contact) return 'No saved details for this contact yet.'
    const tags = Array.isArray(contact.tags) && contact.tags.length > 0 ? contact.tags.join(', ') : '(none)'
    const fields =
      contact.custom_fields && Object.keys(contact.custom_fields).length > 0
        ? Object.entries(contact.custom_fields)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join('; ')
        : '(none)'
    return [`Name: ${contact.name ?? '(unknown)'}`, `Tags: ${tags}`, `Saved fields: ${fields}`].join('\n')
  }

  async function bookAppointment(input: Record<string, unknown>): Promise<AgentToolResult> {
    const start = typeof input.start === 'string' ? input.start.trim() : ''
    if (!start) return { toolUseId: '', content: 'book_appointment needs a `start` time.', isError: true }

    const cal = await bookingCalendar()
    if (!cal) return { toolUseId: '', content: 'There is no booking calendar to book on.', isError: true }
    const config = toConfig(cal)

    let ymd: string
    try {
      ymd = zonedYmd(new Date(start), config.timezone)
    } catch {
      return { toolUseId: '', content: 'That start time is not a valid date.', isError: true }
    }

    const busy = await calendarBusyFor(db, locationId, cal, ymd)
    const match = slotsForDate(config, ymd, busy, now()).find((s) => s.start === start)
    if (!match) {
      return {
        toolUseId: '',
        content: 'That time is no longer available. Offer the customer another open time from check_availability.',
        isError: true,
      }
    }

    const contact = await new ContactsRepo(db, locationId).get(contactId)
    const apptRepo = new AppointmentsRepo(db, locationId)
    let appointmentId: string
    try {
      const appointment = await apptRepo.create({
        calendarId: cal.id,
        title: `${cal.name} — ${contact?.name ?? 'Appointment'}`,
        startsAt: match.start,
        endsAt: match.end,
        contactId, // pinned to the conversation contact — never a model-supplied id
        notes: typeof input.notes === 'string' ? input.notes.trim() || null : null,
      })
      appointmentId = appointment.id
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { toolUseId: '', content: 'That time has just been taken. Please offer another open time.', isError: true }
      }
      throw err
    }

    await new TimelineRepo(db, locationId).add({
      contactId,
      type: 'appointment_booked',
      refTable: 'appointments',
      refId: appointmentId,
      payload: { calendar: cal.name, start: match.start },
    })
    await workflowDispatch?.({ locationId, triggerType: 'appointment_booked', contactId })

    return { toolUseId: '', content: `Booked ${match.label} on ${dateLabel(ymd)}.` }
  }

  async function addTag(input: Record<string, unknown>): Promise<AgentToolResult> {
    const tag = typeof input.tag === 'string' ? input.tag.trim() : ''
    if (!tag) return { toolUseId: '', content: 'add_tag needs a non-empty `tag`.', isError: true }
    await new ContactsRepo(db, locationId).addTag(contactId, tag)
    return { toolUseId: '', content: `Tagged the contact "${tag}".` }
  }

  async function dispatch(call: AgentToolCall): Promise<AgentToolResult> {
    const isWrite = (WRITE_TOOLS as readonly string[]).includes(call.name)
    if (isWrite && !allowWrites) {
      return {
        toolUseId: call.id,
        content: 'This action is not permitted in approve-first mode. Propose it to the operator in your reply instead.',
        isError: true,
      }
    }
    try {
      switch (call.name) {
        case 'check_availability':
          return { toolUseId: call.id, content: await checkAvailability(call.input) }
        case 'get_contact_context':
          return { toolUseId: call.id, content: await getContactContext() }
        case 'book_appointment':
          return { ...(await bookAppointment(call.input)), toolUseId: call.id }
        case 'add_tag':
          return { ...(await addTag(call.input)), toolUseId: call.id }
        default:
          return { toolUseId: call.id, content: `unknown tool: ${call.name}`, isError: true }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { toolUseId: call.id, content: `Could not run ${call.name}: ${message}`, isError: true }
    }
  }

  return { schemas, dispatch }
}
