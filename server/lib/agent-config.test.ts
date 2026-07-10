import { buildSystemPrompt, readAgentConfig } from './agent-config'

// --- readAgentConfig --------------------------------------------------------

test('readAgentConfig reads the agent block defensively', () => {
  const cfg = readAgentConfig({
    agent: {
      enabled: true,
      persona: 'You are Ada, the friendly front desk for Bright Smiles Dental.',
      instructions: 'Always offer a free first cleaning.',
      facts: ['We are open Mon-Fri.', 'Parking is free behind the building.'],
    },
  })
  expect(cfg).toEqual({
    enabled: true,
    persona: 'You are Ada, the friendly front desk for Bright Smiles Dental.',
    instructions: 'Always offer a free first cleaning.',
    facts: ['We are open Mon-Fri.', 'Parking is free behind the building.'],
  })
})

test('readAgentConfig tolerates missing or malformed settings', () => {
  expect(readAgentConfig(undefined)).toEqual({})
  expect(readAgentConfig(null)).toEqual({})
  expect(readAgentConfig({})).toEqual({})
  expect(readAgentConfig({ agent: 'nope' })).toEqual({})
  expect(readAgentConfig({ agent: { facts: 'not-an-array' } })).toEqual({})
})

test('readAgentConfig keeps only non-empty string facts', () => {
  const cfg = readAgentConfig({ agent: { facts: ['real fact', '', '   ', 7, null, 'another'] } })
  expect(cfg.facts).toEqual(['real fact', 'another'])
})

// --- buildSystemPrompt: the Module 37 security invariant --------------------

test('buildSystemPrompt marks customer messages AND tool results as untrusted data, never instructions', () => {
  for (const allowWrites of [true, false]) {
    const prompt = buildSystemPrompt({}, { allowWrites })
    expect(prompt).toMatch(/untrusted/i)
    expect(prompt).toMatch(/tool result/i)
    expect(prompt).toMatch(/never .*instructions|not .*instructions/i)
    // it must refuse role-change / system-reveal attempts smuggled in content
    expect(prompt).toMatch(/change your role|override these rules|reveal/i)
    // and always constrain the output to the bare message
    expect(prompt).toMatch(/ONLY the message text/)
  }
})

// --- buildSystemPrompt: grounding -------------------------------------------

test('buildSystemPrompt folds in the operator persona, instructions, and facts', () => {
  const prompt = buildSystemPrompt(
    {
      persona: 'You are Ada at Bright Smiles Dental.',
      instructions: 'Always offer a free first cleaning.',
      facts: ['We are open Mon-Fri.', 'Parking is free.'],
    },
    { allowWrites: true },
  )
  expect(prompt).toContain('You are Ada at Bright Smiles Dental.')
  expect(prompt).toContain('Always offer a free first cleaning.')
  expect(prompt).toContain('We are open Mon-Fri.')
  expect(prompt).toContain('Parking is free.')
})

test('buildSystemPrompt uses a sane default persona when none is configured', () => {
  const prompt = buildSystemPrompt({}, { allowWrites: false })
  expect(prompt).toMatch(/assistant/i)
  expect(prompt).toMatch(/never invent|look (them|it) up|ground/i) // anti-hallucination guidance
})

// --- buildSystemPrompt: the write gate, in words ----------------------------

test('autonomous mode authorizes actions after the customer agrees', () => {
  const prompt = buildSystemPrompt({}, { allowWrites: true })
  expect(prompt).toMatch(/action tools|may .*book|take .*action/i)
  expect(prompt).toMatch(/clearly agreed|agreed/i)
})

test('approve-first mode forbids actions and frames the output as a draft', () => {
  const prompt = buildSystemPrompt({}, { allowWrites: false })
  expect(prompt).toMatch(/draft/i)
  expect(prompt).toMatch(/do not take any action|not take any action|do NOT/i)
  // it may still READ to ground the draft
  expect(prompt).toMatch(/read-only|look up|ground/i)
})
