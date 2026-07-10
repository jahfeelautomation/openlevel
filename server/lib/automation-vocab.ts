// Shared automation vocabulary: the closed set of triggers that can start a
// workflow and the actions a step can take. Kept as plain string unions (not a
// DB enum) so the vocab can grow without a migration; the route validates
// against these arrays with Zod and the web UI mirrors the labels.

export const TRIGGER_TYPES = [
  'contact_created',
  'inbound_message',
  'appointment_booked',
  'opportunity_created',
  'trigger_link_clicked',
  'survey_submitted',
  'proposal_signed',
] as const

export const ACTION_TYPES = ['send_sms', 'send_email', 'add_tag', 'wait'] as const

export type TriggerType = (typeof TRIGGER_TYPES)[number]
export type ActionType = (typeof ACTION_TYPES)[number]

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  contact_created: 'New contact created',
  inbound_message: 'Inbound message received',
  appointment_booked: 'Appointment booked',
  opportunity_created: 'Opportunity created',
  trigger_link_clicked: 'Trigger link clicked',
  survey_submitted: 'Survey submitted',
  proposal_signed: 'Proposal signed',
}

export const ACTION_LABELS: Record<ActionType, string> = {
  send_sms: 'Send SMS',
  send_email: 'Send email',
  add_tag: 'Add tag',
  wait: 'Wait',
}
