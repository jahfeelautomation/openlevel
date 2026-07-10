import { buildOperatorSystemPrompt } from './operator-config'

// --- operator-trusted framing ----------------------------------------------
// Unlike the customer agent (agent-config), the OPERATOR is trusted: their chat
// turns are instructions to carry out, not data to resist.

test('operator prompt frames the operator as the trusted instruction-giver running their CRM', () => {
  for (const allowWrites of [true, false]) {
    const prompt = buildOperatorSystemPrompt({ allowWrites })
    expect(prompt).toMatch(/operator/i)
    expect(prompt).toMatch(/CRM|run (their|the) business|their records/i)
    // the operator's own turns are instructions, explicitly
    expect(prompt).toMatch(/trusted instructions|do what they ask|carry out/i)
  }
})

// --- the load-bearing guardrail: tool results stay untrusted data -----------
// A customer can smuggle "ignore your rules" into a message that later flows back
// as a tool result. That content is data we report on, never a command.

test('operator prompt keeps tool results as untrusted data, never instructions, in BOTH modes', () => {
  for (const allowWrites of [true, false]) {
    const prompt = buildOperatorSystemPrompt({ allowWrites })
    expect(prompt).toMatch(/untrusted/i)
    expect(prompt).toMatch(/tool result/i)
    expect(prompt).toMatch(/never .*instructions|not .*instructions/i)
    // refuse role-change / override / system-reveal smuggled into content
    expect(prompt).toMatch(/change your role|override these rules|reveal/i)
  }
})

// --- anti-hallucination / grounding -----------------------------------------

test('operator prompt forbids inventing data and requires looking it up first', () => {
  const prompt = buildOperatorSystemPrompt({ allowWrites: false })
  expect(prompt).toMatch(/never invent|look (them|it) up|ground/i)
})

// --- mode clause: read-only (slice 1) ---------------------------------------

test('read-only mode tells the agent it cannot change anything yet and must not pretend it did', () => {
  const prompt = buildOperatorSystemPrompt({ allowWrites: false })
  expect(prompt).toMatch(/read-only|cannot change|can't change|can not change/i)
  expect(prompt).toMatch(/do not claim|never claim|not.*pretend|never.*pretend/i)
})

// --- mode clause: approve-first (slice 2) -----------------------------------

test('approve-first mode tells the agent to propose changes and wait for a confirm', () => {
  const prompt = buildOperatorSystemPrompt({ allowWrites: true })
  expect(prompt).toMatch(/propose/i)
  expect(prompt).toMatch(/confirm/i)
})

// --- the D-36 hard line, stated in words ------------------------------------
// Admin lifted the v1 "never message a customer" posture: the agent MAY now text a
// customer — but only approve-first (draft -> the operator confirms -> the rail
// sends), exactly like every other write. Moving money stays a universal hard-no.

test('write mode allows texting a customer but only approve-first, and still forbids moving money', () => {
  const prompt = buildOperatorSystemPrompt({ allowWrites: true })
  // texting a customer is now a named capability — the agent must not refuse it outright
  expect(prompt).toMatch(/text a customer|send a text/i)
  // but it is gated behind the same confirm step as every other change
  expect(prompt).toMatch(/confirm/i)
  // the old blanket ban on messaging a customer must be gone
  expect(prompt).not.toMatch(/never send a message to a customer|can never send a message/i)
  // money stays a hard no, forever
  expect(prompt).toMatch(/money|charge|refund|payout/i)
})

// --- conversational, not a single drafted message ---------------------------

test('operator prompt is conversational — it does NOT constrain output to one customer message', () => {
  for (const allowWrites of [true, false]) {
    const prompt = buildOperatorSystemPrompt({ allowWrites })
    expect(prompt).not.toContain('ONLY the message text')
  }
})

// --- plain-text output: no markdown, no dangling "shown above" --------------
// The chat bubble renders the reply RAW (whitespace-pre-wrap, no markdown parse) and the
// operator sees ONLY the reply, not the tool output. So "**135**" would show literal asterisks
// and "the 25 most recent are shown above" points at nothing — both look half-built to a
// non-technical operator. The prompt must forbid both, in BOTH modes.

test('operator prompt forbids markdown and dangling references to tool output', () => {
  for (const allowWrites of [true, false]) {
    const prompt = buildOperatorSystemPrompt({ allowWrites })
    // plain text only — the bubble renders raw, so **bold**/bullets would show literally
    expect(prompt).toMatch(/markdown/i)
    // nothing is "shown above": the operator sees only the reply, never the tool output
    expect(prompt).toMatch(/shown above|listed above/i)
  }
})

