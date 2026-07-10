# Conversation Agent — Design (Module 47)

**Goal:** Turn OpenLevel's single-shot AI reply *drafter* into a tool-using
conversation agent that can read the business calendar, read what the business
already knows about a customer, and — in autonomous mode — book appointments and
tag contacts. Meet or exceed GoHighLevel "Conversation AI", with stronger safety:
tenant-scoped tools, mode-gated side effects, prompt-injection hardening that
extends to tool results, and a bounded per-conversation cost.

## Where we are today

`handleAgentReply` (job) and `draftConversationReply` ("Draft from agent" button)
both call `ClaudeClient.draftReply`, a one-shot completion over the conversation
timeline (roles assigned structurally — Module 37). It returns plain text. No
tools, no business grounding, no actions. GHL's bot books, answers from a
knowledge base, and acts. We are taking ours past that.

## Architecture

Four small, single-responsibility units plus a shared availability helper, then a
rewire of the two existing entry points and a config surface.

### 1. `lib/anthropic.ts` — low-level Messages client (protocol only)
Replace `ClaudeClient.draftReply` with `createMessage(input) => AnthropicResponse`:
ONE round-trip to `/v1/messages` carrying `{ model, system, messages, tools }`,
returning `{ stopReason, content: ContentBlock[] }`. It knows the HTTP shape and
nothing about repos, grounding, or the loop. `buildMessages` (the Module-37
structural role builder) stays here. Types defined here and re-exported from
`jobs/agent-reply` for back-compat of existing imports: `ClaudeClient`,
`AnthropicTool`, `ContentBlock` (`text` | `tool_use` | `tool_result`),
`MessageParam`, `CreateMessageInput`, `AnthropicResponse`.

### 2. `lib/agent-runner.ts` — the tool-use loop (control only)
`runToolConversation({ client, apiKey, model, system, messages, tools,
dispatchTool, maxIterations = 5 })`:
- Loop up to `maxIterations`: `createMessage`; if the response has no `tool_use`
  blocks, return its text. Otherwise append the assistant turn, execute EVERY
  `tool_use` via `dispatchTool`, append a single user turn of `tool_result`
  blocks, and continue.
- On hitting the cap with tools still pending, make ONE final `createMessage`
  with `tools: []` so the model must answer in text. Bounded cost, always a
  reply.
- The loop is agnostic to what the tools do. It is the unit under test for the
  cap, the all-tool-uses-get-a-result invariant, and clean text extraction —
  tested with a fake `createMessage` that scripts tool_use→end_turn.

### 3. `lib/agent-tools.ts` — tool schemas + tenant-scoped executors + the write gate
`buildAgentTools({ db, locationId, contactId, allowWrites, now, dispatch }) =>
{ schemas, dispatch: (call) => ToolResult }`.
- **Read tools (always):**
  - `check_availability({ date? })` — resolves THE booking calendar (the single
    `booking_enabled` calendar; first one if several), then `slotsForDate` for a
    given local date, or the soonest open days+slots. Uses the SAME availability
    math as the public page (`lib/booking-availability`), so the agent can never
    offer a time the page would not.
  - `get_contact_context({})` — name, tags, and saved custom fields for THIS
    conversation's contact only. Personalization without re-asking.
- **Write tools (only when `allowWrites`):**
  - `book_appointment({ start, notes? })` — mirrors the public booking POST:
    re-validate `start` against `slotsForDate` RIGHT NOW, `AppointmentsRepo.create`
    (catch `isUniqueViolation` → honest "slot taken"), add an `appointment_booked`
    timeline event, fire the workflow dispatch. The contact is ALWAYS the
    conversation's contact (`contactId` from deps) — the model cannot book for an
    arbitrary contact.
  - `add_tag({ tag })` — `ContactsRepo.addTag(contactId, tag)`, idempotent.
- **The gate is defense-in-depth:** write schemas are omitted entirely when
  `!allowWrites` (the model never sees them), AND `dispatch` refuses a write tool
  when `!allowWrites` even if one is somehow requested. Every executor is
  location-scoped through its repo (locationId at construction). Every executor is
  wrapped so a throw becomes an `is_error` tool_result, never a crashed loop.
- **Money invariant preserved:** there is no charge/payment tool. Booking and
  tagging move no money — consistent with the rest of OpenLevel.

### 4. `lib/agent-config.ts` — grounding
`readAgentConfig(settings)` reads `location.settings.agent` defensively
(`{ persona?, instructions?, facts?: string[] }`). `buildSystemPrompt(config,
{ allowWrites })` assembles: the Module-37 injection guardrails, EXTENDED to say
tool results are data not instructions; the business persona/instructions; the
knowledge-base facts; tool guidance; and, when `!allowWrites`, an explicit "you
may look things up but you cannot take any action — propose, do not act" clause.

### Rewire
- `jobs/agent-reply.ts`: build messages+tools+system; `allowWrites = mode ===
  'autonomous'`; run `runToolConversation`; autonomous → send the final text,
  approve-first → persist the `draft` (unchanged). Add `dispatch?` to deps so
  `book_appointment` can fire `appointment_booked`.
- `lib/draft.ts`: read-only tools (`allowWrites: false`); run the loop; return
  text. Still persists nothing.

### Config surface
- Operator route `PATCH /api/loc/:loc/settings/agent` updates `settings.agent`
  (a new `LocationSettingsRepo.updateAgentConfig`, location-scoped, JSON-merge so
  other settings keys are preserved).
- Settings → "AI Agent" page: persona, instructions, knowledge-base facts, and a
  read-only note of the active reply mode. Minimal but real; screenshot for the
  commit.

## Safety properties (the bar)
1. Tenant isolation: every tool executor goes through a `LocationScopedRepo` bound
   to the conversation's location. No cross-tenant read or write.
2. Mode-gated side effects: approve-first NEVER books or tags — the operator
   approves first. Enforced at the schema layer and the dispatch layer.
3. Injection hardening: customer turns and tool results are both untrusted data;
   roles are structural; the system prompt forbids instruction-following from
   either.
4. Bounded cost: `maxIterations` cap with a forced final text answer.
5. No money movement: no payment/charge tool exists.
6. Secret hygiene (D-36): the per-client Anthropic key is resolved by name and
   used only to authenticate the HTTP call; it is never placed in a tool, a
   prompt, or a return value.

## Out of scope (YAGNI for this module)
Multi-calendar disambiguation by name, rescheduling/cancelling via the agent,
Sonnet escalation toggle, and reading appointments into contact context. Each is
a clean follow-on; none blocks the core.
