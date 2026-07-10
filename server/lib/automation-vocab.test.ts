import { ACTION_TYPES, TRIGGER_LABELS, TRIGGER_TYPES } from './automation-vocab'

test('trigger_link_clicked is part of the closed trigger set and has a label', () => {
  // Trigger Links (slice 14) start automations: a click on an attributed link
  // fires this trigger. It must stay in the closed set so the workflows route
  // (z.enum(TRIGGER_TYPES)) accepts it and the builder lists it. The web mirror
  // in src/features/automations/automation-meta.ts must match this set.
  expect(TRIGGER_TYPES).toContain('trigger_link_clicked')
  expect(TRIGGER_LABELS.trigger_link_clicked).toBe('Trigger link clicked')
})

test('survey_submitted is part of the closed trigger set and has a label', () => {
  // Surveys (slice 15) start automations: completing a multi-step survey fires
  // this trigger so a finished survey can enroll the contact in a workflow. It
  // must stay in the closed set so the workflows route (z.enum(TRIGGER_TYPES))
  // accepts it and the builder lists it. The web mirror must match this set.
  expect(TRIGGER_TYPES).toContain('survey_submitted')
  expect(TRIGGER_LABELS.survey_submitted).toBe('Survey submitted')
})

test('proposal_signed is part of the closed trigger set and has a label', () => {
  // Proposals (slice 16) start automations: a recipient typing their name and
  // accepting a proposal on its public page fires this trigger, so an accepted
  // proposal can kick off onboarding/fulfilment. It must stay in the closed set
  // so the workflows route (z.enum(TRIGGER_TYPES)) accepts it and the builder
  // lists it. The web mirror in automation-meta.ts must match this set.
  expect(TRIGGER_TYPES).toContain('proposal_signed')
  expect(TRIGGER_LABELS.proposal_signed).toBe('Proposal signed')
})

test('every trigger type has exactly one label (no gaps, no orphans)', () => {
  expect(Object.keys(TRIGGER_LABELS).sort()).toEqual([...TRIGGER_TYPES].sort())
})

test('the action vocabulary is unchanged by the trigger addition', () => {
  expect(ACTION_TYPES).toEqual(['send_sms', 'send_email', 'add_tag', 'wait'])
})
