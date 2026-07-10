// Typed client for the OpenLevel Hono API. All calls are same-origin under /api
// (Vite proxies to the backend in dev) and send the session cookie.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    let message = `request failed (${res.status})`
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---- Types (mirror the server repos' public shapes) ----

export interface Operator {
  id: string
  email: string
  name: string | null
  role: string
}

export interface Location {
  id: string
  name: string
  slug: string
  client_slug: string | null
  branding: Record<string, unknown>
  settings: Record<string, unknown>
}

export interface Contact {
  id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  phones: string[]
  emails: string[]
  tags: string[]
  /** Values for the operator-defined custom fields, keyed by each field's slug. */
  custom_fields: Record<string, unknown>
  source: string | null
  created_at: string
  updated_at: string
  /** Soft-delete stamp: null = live; a timestamp = archived (restorable). */
  archived_at?: string | null
  /** US state (2-letter code) for legal texting hours; null/absent = not set,
   *  which the gateway refuses as unknown_state. Set via setContactState. */
  state?: string | null
}

/** One operator-defined custom-field *definition* (the "Custom Fields" settings
 *  area). The contact's value for it lives in Contact.custom_fields[key]. */
export interface CustomField {
  id: string
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'dropdown' | 'checkbox'
  options: string[]
  placeholder: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface NewCustomField {
  label: string
  type?: CustomField['type']
  options?: string[]
  placeholder?: string | null
}

/** A location-level custom *value* (GHL "Custom Values"): a named business
 *  constant the operator references as {{custom_values.<key>}} in templates and
 *  automations. The `key` is auto-slugged from the name once and then immutable,
 *  so a tag already placed in a template keeps resolving after a rename. */
export interface CustomValue {
  id: string
  location_id: string
  key: string
  name: string
  value: string
  position: number
  created_at: string
  updated_at: string
}

export interface NewCustomValue {
  name: string
  value?: string
}

/** The AI Agent's persona, owner instructions, and knowledge-base facts. Every
 *  field is optional — an unset field falls back to the agent's sane default at
 *  prompt-build time. Mirrors the server's AgentConfig. */
export interface AgentConfig {
  enabled?: boolean
  persona?: string
  instructions?: string
  facts?: string[]
}

/** How the AI Agent answers inbound messages. 'approve-first' (the default) drafts
 *  a reply for a human to approve and withholds every write tool; 'autonomous' lets
 *  the agent send and act with its tenant-scoped tools. This is the load-bearing
 *  safety control. */
export type ReplyMode = 'approve-first' | 'autonomous'

/** The full AI Agent settings view for a location (GHL "Conversation AI"). */
export interface AgentSettings {
  replyMode: ReplyMode
  agent: AgentConfig
}

/** A patch to the AI Agent settings — every field optional, touches only what it
 *  sends. The reply mode lives at the root; the rest are agent-config fields. */
export interface AgentSettingsPatch {
  replyMode?: ReplyMode
  enabled?: boolean
  persona?: string
  instructions?: string
  facts?: string[]
}

/** Which payment processor this location connected. OpenLevel never moves
 *  money itself — checkout links are minted inside the location's OWN
 *  Stripe/Square account and their processor charges the card. */
export type PaymentsProvider = 'stripe' | 'square' | 'none'

/** The Payments settings view plus the honest connection readout: `connected`
 *  is true only when the chosen processor's keys actually resolve server-side,
 *  and `reason` says what is missing when they don't. Credentials themselves
 *  are never sent to or stored by this API — they live in the vault by name. */
export interface PaymentsSettings {
  provider: PaymentsProvider
  squareLocationId: string | null
  connected: boolean
  reason?: string
}

export interface PaymentsSettingsPatch {
  provider?: PaymentsProvider
  squareLocationId?: string | null
}

/** Which outbound providers carry this location's campaigns (Module 49). */
export type EmailProvider = 'brevo' | 'none'
export type SmsProvider = 'twilio' | 'none'

/** Honest per-channel readout: connected only when the chosen provider's keys
 *  actually resolve server-side, with the refusal reason when they don't. */
export interface ChannelStatus {
  connected: boolean
  reason?: string
}

/** The Sending settings view: provider choices + sender identity, plus the
 *  per-channel connection readouts. Credentials are never sent through this
 *  API — they live in the vault by name. */
export interface SendingSettings {
  emailProvider: EmailProvider
  fromEmail: string | null
  fromName: string | null
  smsProvider: SmsProvider
  smsFrom: string | null
  email: ChannelStatus
  sms: ChannelStatus
}

export interface SendingSettingsPatch {
  emailProvider?: EmailProvider
  fromEmail?: string | null
  fromName?: string | null
  smsProvider?: SmsProvider
  smsFrom?: string | null
}

/** The Social settings view (Module 50/51): the channel ids this location
 *  publishes as, the Google Business Profile ids review sync reads from, plus
 *  an honest per-platform readout. The page/access tokens are never sent
 *  through this API — they live in the vault by name. */
export interface SocialSettings {
  facebookPageId: string | null
  instagramUserId: string | null
  linkedinAuthorUrn: string | null
  googleAccountId: string | null
  googleLocationId: string | null
  channels: {
    facebook: ChannelStatus
    instagram: ChannelStatus
    linkedin: ChannelStatus
    x: ChannelStatus
    google_business: ChannelStatus
  }
}

export interface SocialSettingsPatch {
  facebookPageId?: string | null
  instagramUserId?: string | null
  linkedinAuthorUrn?: string | null
  googleAccountId?: string | null
  googleLocationId?: string | null
}

/** Which voice provider carries this location's calls (Module 52). */
export type VoiceProviderChoice = 'twilio' | 'vapi' | 'none'

/** The Voice settings view: provider choice + non-secret numbers/ids, plus the
 *  honest connection readout — connected only when the chosen provider's keys
 *  actually resolve server-side. Credentials never travel through this API. */
export interface VoiceSettings {
  provider: VoiceProviderChoice
  fromNumber: string | null
  operatorNumber: string | null
  vapiAssistantId: string | null
  vapiPhoneNumberId: string | null
  connected: boolean
  reason?: string
}

export interface VoiceSettingsPatch {
  provider?: VoiceProviderChoice
  fromNumber?: string | null
  operatorNumber?: string | null
  vapiAssistantId?: string | null
  vapiPhoneNumberId?: string | null
}

/** One row of the call log (Module 52) — what the provider actually reported,
 *  mirrored in by the signature-verified webhook. */
export interface CallRow {
  id: string
  contact_id: string | null
  direction: string
  from_number: string | null
  to_number: string | null
  status: string
  duration_seconds: number | null
  recording_url: string | null
  transcript: string | null
  summary: string | null
  provider: string
  external_id: string | null
  created_at: string
}

/** Derived call KPIs — computed from the real rows on every read
 *  (call-math.ts), never a stored counter. */
export interface CallStats {
  total: number
  inbound: number
  outbound: number
  completed: number
  connectedRate: number
  avgDurationSeconds: number
}

/** What one platform's review sync really did (Module 51) — a real import/update
 *  count from the upsert, or the verbatim refusal reason. Never a fake zero. */
export type ReviewSyncResult =
  | { source: string; ok: true; imported: number; updated: number }
  | { source: string; ok: false; reason: string }

/** What actually happened to a blast: messages the provider accepted, contacts
 *  skipped (suppressed or unreachable), and provider failures. */
export interface CampaignDelivery {
  sent: number
  skipped: number
  failed: number
}

/** One distinct tag in a location with the number of contacts wearing it —
 *  the row the global Tags page lists. Derived server-side from contacts.tags,
 *  never a stored counter, so an unused tag simply stops appearing. */
export interface TagSummary {
  tag: string
  count: number
}

export interface Conversation {
  id: string
  contact_id: string | null
  channel: string | null
  provider: string | null
  external_id: string | null
  status: string
  assignee: string | null
  last_message_at: string | null
  created_at: string
}

export interface Message {
  id: string
  conversation_id: string | null
  contact_id: string | null
  direction: 'inbound' | 'outbound'
  channel: string | null
  body: string | null
  author_type: string | null
  author_id: string | null
  status: string
  created_at: string
}

/** One turn of the operator↔assistant chat (OpenLevel's "AI front door").
 *  'operator' is the human staff member; 'assistant' is the AI. The page sends the
 *  running history plus the new message and gets back the assistant's reply. */
export interface AssistantTurn {
  role: 'operator' | 'assistant'
  content: string
}

/** A change the assistant PREPARED for the operator to confirm. The chat turn only
 *  ever proposes; the operator taps Confirm and the page posts {verb, params} to
 *  /assistant/confirm — the single write path. `summary` is the plain-English line
 *  the card shows; `verb`/`params` are replayed verbatim to perform the change. */
export interface ProposedAction {
  id: string
  verb: string
  params: Record<string, unknown>
  summary: string
}

export interface TimelineEvent {
  id: string
  contact_id: string | null
  type: string
  ref_table: string | null
  ref_id: string | null
  payload: Record<string, unknown>
  occurred_at: string
}

/** A free-text note on a contact record (the GHL "Notes" panel). Pinned notes
 *  sort to the top; `author` is the operator who wrote it (null if unattributed). */
export interface ContactNote {
  id: string
  contact_id: string
  body: string
  author: string | null
  pinned: boolean
  created_at: string
  updated_at: string
}

/** An operator to-do on a contact record (the GHL "Tasks" panel). `due_at` is
 *  optional; `completed_at` is null while the task is open, a timestamp once done. */
export interface ContactTask {
  id: string
  contact_id: string
  title: string
  body: string | null
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

/** A task in the global worklist, carrying the name of the contact it hangs off. */
export interface ContactTaskWithContact extends ContactTask {
  contact_name: string | null
}

/** Live KPI counts for the global Tasks worklist, computed server-side from the
 *  same rows the list shows. */
export interface TaskSummary {
  open: number
  overdue: number
  dueToday: number
  upcoming: number
  completed: number
}

export type OpportunityStatus = 'open' | 'won' | 'lost' | 'abandoned'

export interface Stage {
  id: string
  pipeline_id: string
  name: string
  position: number
}

export interface Pipeline {
  id: string
  name: string
  position: number
  stages: Stage[]
}

export interface Opportunity {
  id: string
  pipeline_id: string
  stage_id: string
  contact_id: string | null
  name: string
  value_cents: number
  status: OpportunityStatus
  source: string | null
  assignee: string | null
  created_at: string
  updated_at: string
}

export interface NewOpportunity {
  pipelineId: string
  stageId: string
  name: string
  contactId?: string | null
  valueCents?: number
  source?: string | null
}

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

/** One weekly open window in the calendar's timezone (weekday 0=Sun, 'HH:MM'
 *  wall clock). Mirrors AvailabilityWindow in the server's lib/availability. */
export interface AvailabilityWindow {
  weekday: number
  start: string
  end: string
}

export interface Calendar {
  id: string
  name: string
  color: string
  duration_min: number
  position: number
  /** Public booking config — a calendar is only hosted once this is true. */
  booking_enabled: boolean
  /** Lowercase URL-safe slug for the public page; null until first set. */
  booking_slug: string | null
  /** IANA timezone all slots are computed + shown in (e.g. America/New_York). */
  timezone: string
  /** Extra minutes BETWEEN slot starts on top of duration (0 = back-to-back). */
  slot_interval_min: number
  /** Padding kept clear after each booking, in minutes. */
  buffer_min: number
  /** Minimum lead time before the earliest bookable slot, in minutes. */
  notice_min: number
  /** How many days ahead the page offers, from today. */
  rolling_days: number
  availability: AvailabilityWindow[]
  booking_headline: string | null
  booking_blurb: string | null
}

export interface NewCalendar {
  name: string
  color?: string
  durationMin?: number
  position?: number
}

/** Edit payload for a calendar — its name/color/duration AND its public-booking
 *  config. Omitted fields are left untouched; `bookingSlug: null` clears the
 *  slug (and so the public page). */
export interface CalendarPatch {
  name?: string
  color?: string
  durationMin?: number
  position?: number
  bookingEnabled?: boolean
  bookingSlug?: string | null
  timezone?: string
  slotIntervalMin?: number
  bufferMin?: number
  noticeMin?: number
  rollingDays?: number
  availability?: AvailabilityWindow[]
  bookingHeadline?: string | null
  bookingBlurb?: string | null
}

export interface Appointment {
  id: string
  calendar_id: string
  contact_id: string | null
  title: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  location_text: string | null
  notes: string | null
}

export interface NewAppointment {
  calendarId: string
  title: string
  startsAt: string
  endsAt: string
  contactId?: string | null
  locationText?: string | null
  notes?: string | null
}

export type CampaignChannel = 'sms' | 'email'
export type CampaignStatus = 'draft' | 'sent'

export interface Campaign {
  id: string
  name: string
  channel: string
  subject: string | null
  body: string
  audience_tag: string | null
  status: string
  recipient_count: number
  sent_count: number
  created_at: string
  updated_at: string
  sent_at: string | null
}

export interface NewCampaign {
  name: string
  channel: CampaignChannel
  subject?: string | null
  body: string
  audienceTag?: string | null
}

export type TemplateChannel = 'email' | 'sms'

/** A reusable email/SMS message template (the GHL "Templates" library). */
export interface Template {
  id: string
  name: string
  channel: string
  subject: string | null
  body: string
  created_at: string
  updated_at: string
}

export interface NewTemplate {
  name: string
  channel: TemplateChannel
  subject?: string | null
  body: string
}

export interface TemplatePatch {
  name?: string
  channel?: TemplateChannel
  subject?: string | null
  body?: string
}

export type TriggerType =
  | 'contact_created'
  | 'inbound_message'
  | 'appointment_booked'
  | 'opportunity_created'
  | 'trigger_link_clicked'
  | 'survey_submitted'
  | 'proposal_signed'
export type ActionType = 'send_sms' | 'send_email' | 'add_tag' | 'wait'
export type WorkflowStatus = 'draft' | 'live'

export interface Workflow {
  id: string
  name: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  status: string
  created_at: string
  updated_at: string
}

export interface WorkflowAction {
  id: string
  workflow_id: string
  position: number
  type: string
  config: Record<string, unknown>
  created_at: string
}

export interface NewWorkflow {
  name: string
  triggerType: TriggerType
  triggerConfig?: Record<string, unknown>
}

export interface WorkflowActionInput {
  type: ActionType
  config?: Record<string, unknown>
}

export type WorkflowRunStatus = 'running' | 'waiting' | 'completed' | 'failed'

export interface WorkflowRunStep {
  position: number
  type: string
  status: 'done' | 'skipped' | 'waiting' | 'failed'
  detail: string
}

export interface WorkflowRun {
  id: string
  workflow_id: string
  contact_id: string | null
  trigger_type: string
  status: WorkflowRunStatus
  steps: WorkflowRunStep[]
  started_at: string
  finished_at: string | null
}

export interface ReportingCountValue {
  count: number
  valueCents: number
}

export interface ReportingStage {
  id: string
  name: string
  count: number
  valueCents: number
}

export interface ReportingSummary {
  contacts: number
  openOpportunities: ReportingCountValue
  wonOpportunities: ReportingCountValue
  upcomingAppointments: number
  campaignsSent: number
  messagesSent: number
  pipeline: { id: string; name: string; stages: ReportingStage[] } | null
}

export type FunnelStatus = 'draft' | 'published'
export type FunnelStepType = 'opt_in' | 'thank_you' | 'sales'

export interface FunnelField {
  name: string
  label: string
  type?: string
  required?: boolean
}

export interface FunnelStepContent {
  headline?: string
  subhead?: string
  body?: string
  cta?: string
  tag?: string
  fields?: FunnelField[]
  [key: string]: unknown
}

export interface Funnel {
  id: string
  name: string
  slug: string
  status: string
  created_at: string
  updated_at: string
}

export interface FunnelListItem extends Funnel {
  step_count: number
}

export interface FunnelStep {
  id: string
  funnel_id: string
  position: number
  name: string
  type: string
  path: string
  content: FunnelStepContent
  submissions: number
  created_at: string
}

export interface NewFunnel {
  name: string
  slug: string
}

export interface NewFunnelStep {
  name: string
  type: FunnelStepType
  path: string
  content?: FunnelStepContent
  position?: number
}

export interface FunnelStepPatch {
  name?: string
  type?: FunnelStepType
  path?: string
  content?: FunnelStepContent
  position?: number
}

export type FormStatus = 'draft' | 'published'

export interface FormField {
  name: string
  label: string
  type?: string
  required?: boolean
}

export interface FormContent {
  headline?: string
  subhead?: string
  cta?: string
  tag?: string
  successMessage?: string
  fields?: FormField[]
  [key: string]: unknown
}

export interface Form {
  id: string
  name: string
  slug: string
  status: string
  content: FormContent
  /** Honest count of real stored submissions — the row's own counter column. */
  submissions: number
  created_at: string
  updated_at: string
}

export interface FormSubmission {
  id: string
  form_id: string
  contact_id: string | null
  /** The raw field map the visitor entered (all string values). */
  values: Record<string, unknown>
  created_at: string
}

export interface NewForm {
  name: string
  slug: string
}

export type SurveyStatus = 'draft' | 'published'

export interface SurveyField {
  name: string
  /** Operator-facing label; falls back to a humanized name when absent. */
  label?: string
  /** 'text' | 'email' | 'tel' | 'textarea' | 'select'. */
  type?: string
  required?: boolean
  /** Choices for a single-select dropdown field (type 'select'). */
  options?: string[]
}

export interface SurveyStep {
  id?: string
  title?: string
  subtitle?: string
  fields: SurveyField[]
}

export interface SurveyContent {
  headline?: string
  subhead?: string
  cta?: string
  tag?: string
  successMessage?: string
  /** Ordered multi-step structure — the survey's questions live here. */
  steps?: SurveyStep[]
  [key: string]: unknown
}

export interface Survey {
  id: string
  name: string
  slug: string
  status: string
  content: SurveyContent
  /** Honest count of real stored submissions — the row's own counter column. */
  submissions: number
  created_at: string
  updated_at: string
}

export interface SurveySubmission {
  id: string
  survey_id: string
  contact_id: string | null
  /** The raw field map the visitor entered across every step (string values). */
  values: Record<string, unknown>
  created_at: string
}

export interface NewSurvey {
  name: string
  slug: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

/** One billable line. `unit_amount` is in cents, like every money field. */
export interface InvoiceItem {
  description: string
  quantity: number
  unit_amount: number
}

export interface Invoice {
  id: string
  contact_id: string | null
  number: string
  status: string
  currency: string
  items: InvoiceItem[]
  notes: string | null
  issued_at: string | null
  due_at: string | null
  paid_at: string | null
  payment_method: string | null
  checkout_provider: string | null
  checkout_external_id: string | null
  checkout_url: string | null
  created_at: string
  updated_at: string
}

/** Edit payload for an invoice. Omitted fields are left untouched; `contactId:
 *  null` clears the bill-to. Totals are never sent — they derive from `items`. */
export interface InvoicePatch {
  contactId?: string | null
  items?: InvoiceItem[]
  notes?: string | null
  dueAt?: string | null
}

export type ProductType = 'one_time' | 'recurring'
export type RecurringInterval = 'day' | 'week' | 'month' | 'year'
export type ProductStatus = 'active' | 'archived'

/** A saved item in the location's product/service catalog (GHL "Payments ->
 *  Products"). `price_cents` is the default price in integer cents; a one_time
 *  product carries a null `recurring_interval`, a recurring one carries its
 *  cadence. Archiving retires a product from the picker without disturbing any
 *  document already built from it (documents copy their lines at build time). */
export interface Product {
  id: string
  location_id: string
  name: string
  description: string | null
  price_cents: number
  currency: string
  type: ProductType
  recurring_interval: RecurringInterval | null
  status: ProductStatus
  position: number
  created_at: string
  updated_at: string
}

/** Create payload for a catalog product. Price is in cents; an omitted price is
 *  a free $0 item. A recurring product takes an interval (defaults monthly
 *  server-side); a one_time product ignores any interval. */
export interface NewProduct {
  name: string
  description?: string
  priceCents?: number
  currency?: string
  type?: ProductType
  recurringInterval?: RecurringInterval
}

/** Edit payload for a catalog product. Omitted fields are untouched; `status`
 *  toggles active/archived. Switching type re-syncs the interval server-side, so
 *  a one_time product can never keep a stray cadence. */
export interface ProductPatch {
  name?: string
  description?: string
  priceCents?: number
  currency?: string
  type?: ProductType
  recurringInterval?: RecurringInterval
  status?: ProductStatus
  position?: number
}

export type SubscriptionStatus = 'active' | 'paused' | 'canceled'

/** A recurring commitment a contact is on (GHL "Payments -> Subscriptions").
 *  BOOKKEEPING ONLY: OpenLevel records that a contact is on a recurring
 *  arrangement and derives the schedule + MRR from the row — it never charges a
 *  card or moves money. The name, amount, currency and cadence are SNAPSHOT from
 *  the catalog product at start time (the column is `billing_interval`, never the
 *  reserved word interval), so editing or deleting that product never disturbs a
 *  live subscription. `canceled_at` is stamped only while canceled. */
export interface Subscription {
  id: string
  location_id: string
  contact_id: string | null
  product_id: string | null
  name: string
  amount_cents: number
  currency: string
  billing_interval: RecurringInterval
  status: SubscriptionStatus
  started_at: string
  canceled_at: string | null
  created_at: string
  updated_at: string
}

/** A subscription decorated with its DERIVED next renewal date — a real upcoming
 *  date while active, null while paused or canceled (nothing is scheduled to
 *  renew). The schedule is computed server-side (subscription-math.ts), never stored. */
export interface SubscriptionWithSchedule extends Subscription {
  next_renewal: string | null
}

/** The KPI band totals DERIVED server-side from the subscription rows: a count per
 *  status and the monthly recurring revenue in cents, summed over the ACTIVE rows
 *  only (each cadence normalised to a month) — never a stored, driftable figure. */
export interface SubscriptionSummary {
  active: number
  paused: number
  canceled: number
  mrr_cents: number
}

/** Start payload: a subscription can only begin from a recurring catalog product,
 *  so the client sends the product (and optionally who it is for and when it
 *  began) — never a free-hand amount. The price always snapshots from the catalog. */
export interface NewSubscription {
  productId: string
  contactId?: string
  startedAt?: string
}

/** Edit payload: lifecycle (pause/resume/cancel via `status`) plus light
 *  corrections. Name, amount and cadence are deliberately NOT editable — they are
 *  a snapshot, so changing them would quietly rewrite history. `contactId: null`
 *  clears the linked contact. */
export interface SubscriptionPatch {
  status?: SubscriptionStatus
  contactId?: string | null
  startedAt?: string
}

export type DiscountType = 'percent' | 'fixed'
export type CouponStatus = 'active' | 'archived'

/** A reusable discount code (GHL "Payments -> Coupons"). BOOKKEEPING ONLY: a
 *  coupon is a discount DEFINITION a later step can apply to an invoice's recorded
 *  total — defining or editing one never charges a card or moves money.
 *  `discount_value` is whole percent for a percent coupon or an integer cent amount
 *  for a fixed one. `times_redeemed` only ever advances when a code is actually
 *  applied, so the usage figure can never overstate reality. A null `max_redemptions`
 *  means unlimited; a null `expires_at` means it never expires. */
export interface Coupon {
  id: string
  location_id: string
  code: string
  description: string | null
  discount_type: DiscountType
  discount_value: number
  status: CouponStatus
  max_redemptions: number | null
  times_redeemed: number
  expires_at: string | null
  created_at: string
  updated_at: string
}

/** A coupon decorated with its DERIVED redeemable flag — true only while it is
 *  active, not past its expiry, and under its redemption cap. Computed server-side
 *  (coupon-math.ts), never stored, so an active-but-expired code reads honestly. */
export interface CouponWithRedeemable extends Coupon {
  redeemable: boolean
}

/** The KPI band totals DERIVED server-side from the coupon rows: how many are
 *  active, how many of those are actually redeemable right now, the total times
 *  every code has been applied, and how many are archived — never stored figures. */
export interface CouponSummary {
  active: number
  redeemable: number
  redemptions: number
  archived: number
}

/** Define payload: the operator-chosen code plus the discount. `discountValue` is
 *  whole percent (held to 1..100) or an integer cent amount. An omitted
 *  `discountType` defaults to percent; an omitted cap or expiry means unlimited /
 *  never. The code must be unique within the location (a clash is an honest 409). */
export interface NewCoupon {
  code: string
  description?: string | null
  discountType?: DiscountType
  discountValue: number
  maxRedemptions?: number | null
  expiresAt?: string | null
}

/** Edit payload: any field plus archive/restore via `status`. An absent key is
 *  left untouched; an explicit null clears the expiry or the cap. */
export interface CouponPatch {
  code?: string
  description?: string | null
  discountType?: DiscountType
  discountValue?: number
  status?: CouponStatus
  maxRedemptions?: number | null
  expiresAt?: string | null
}

/** One recorded payment on the Transactions ledger (Payments → Transactions). It
 *  is a PROJECTION of a paid invoice, never a separate money row: `amount_cents`
 *  is DERIVED server-side from that invoice's line items, so the ledger can never
 *  show a dollar the invoices don't justify. OpenLevel never charges a card — a
 *  row exists only because an operator recorded a payment. */
export interface Transaction {
  invoice_id: string
  invoice_number: string
  contact_id: string | null
  amount_cents: number
  currency: string
  method: string
  paid_at: string
}

/** One payment method's slice of the ledger, rolled up server-side. */
export interface MethodTotal {
  method: string
  count: number
  cents: number
}

/** The KPI band over the ledger, all DERIVED from the projected rows: how many
 *  payments, the all-time gross collected, the slice recorded this (UTC) month,
 *  and the per-method breakdown — never stored figures. */
export interface TransactionSummary {
  count: number
  grossCents: number
  thisMonthCents: number
  byMethod: MethodTotal[]
}

export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined'

/** One line on a proposal quote. `unit_amount` is in cents, like every money field. */
export interface ProposalItem {
  description: string
  quantity: number
  unit_amount: number
}

/** Proposal body: intro prose, an itemised quote, and terms. The dollar total is
 *  never stored — it derives from `line_items` (proposals-meta.ts), so it can't
 *  drift from the lines that justify it. */
export interface ProposalContent {
  intro?: string
  line_items?: ProposalItem[]
  terms?: string
  signer_role?: string
  [key: string]: unknown
}

export interface Proposal {
  id: string
  contact_id: string | null
  title: string
  slug: string
  status: string
  currency: string
  content: ProposalContent
  /** The recipient's typed signature — only ever set when they accept on the
   *  public page. Null until then; OpenLevel never forges or pre-fills it. */
  signer_name: string | null
  signed_at: string | null
  created_at: string
  updated_at: string
}

export interface NewProposal {
  title: string
  slug: string
  contactId?: string | null
}

/** Edit payload for a proposal. Omitted fields are left untouched; totals are
 *  never sent — they derive from `content.line_items`. */
export interface ProposalPatch {
  title?: string
  slug?: string
  contactId?: string | null
  currency?: string
  content?: ProposalContent
}

export type ReviewModerationStatus = 'published' | 'hidden'
export type ReviewRequestStatus = 'pending' | 'completed'

/** A single star review — immutable feedback; only `status` (moderation) changes.
 *  `external_id` is the platform's own review id when the row was mirrored in by
 *  review sync (Module 51); null for reviews left directly on the public page. */
export interface Review {
  id: string
  contact_id: string | null
  request_id: string | null
  rating: number
  body: string | null
  reviewer_name: string | null
  source: string
  status: string
  external_id: string | null
  created_at: string
}

/** An outbound ask for a review — mints a tokenized public link. */
export interface ReviewRequest {
  id: string
  contact_id: string | null
  channel: string
  token: string
  status: string
  sent_at: string | null
  completed_at: string | null
  created_at: string
}

export type StarBucket = 5 | 4 | 3 | 2 | 1

/** Reputation aggregates DERIVED from the review rows on the server (review-math.ts),
 *  never a stored, driftable number. An empty location is an honest zero. */
export interface ReviewStats {
  count: number
  average: number
  distribution: Record<StarBucket, number>
}

export type CourseStatus = 'draft' | 'published'
export type EnrollmentStatus = 'active' | 'completed'

export interface Course {
  id: string
  title: string
  slug: string
  description: string | null
  status: string
  created_at: string
  updated_at: string
}

/** Per-course rollup DERIVED on the server (course-math.ts) from real lesson
 *  completions — never stored. An empty course is an honest zero. */
export interface CourseProgressSummary {
  enrollments: number
  averagePercent: number
  completed: number
}

/** A course row as the list shows it: the course plus its derived lesson count
 *  and enrollment summary. */
export interface CourseListItem extends Course {
  lessonCount: number
  summary: CourseProgressSummary
}

export interface Lesson {
  id: string
  course_id: string
  position: number
  title: string
  content: string | null
  video_url: string | null
  created_at: string
}

export interface Enrollment {
  id: string
  course_id: string
  contact_id: string | null
  token: string
  status: string
  enrolled_at: string | null
  completed_at: string | null
  created_at: string
}

/** One enrollee's progress, DERIVED from their completions over the course's live
 *  lesson count — the same figure the student sees on the public player. */
export interface EnrollmentProgress {
  total: number
  completed: number
  percent: number
  complete: boolean
}

export interface EnrollmentWithProgress extends Enrollment {
  progress: EnrollmentProgress
  /** The tokenized public player link to send this student. */
  link: string
}

export interface CourseDetail {
  course: Course
  lessons: Lesson[]
  enrollments: EnrollmentWithProgress[]
}

export interface NewCourse {
  title: string
  slug?: string
  description?: string | null
  status?: CourseStatus
}

export interface CoursePatch {
  title?: string
  slug?: string
  description?: string | null
  status?: CourseStatus
}

export interface NewLesson {
  title: string
  content?: string | null
  videoUrl?: string | null
  position?: number
}

export interface LessonPatch {
  title?: string
  content?: string | null
  videoUrl?: string | null
  position?: number
}

export type BlogStatus = 'draft' | 'published'

export interface BlogPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  body: string | null
  cover_image_url: string | null
  author: string | null
  status: string
  /** Stamped on the FIRST publish, preserved across unpublish/re-publish. */
  published_at: string | null
  created_at: string
  updated_at: string
}

/** A post row as the operator sees it: the post plus its DERIVED read time
 *  (blog-math.ts, never stored) and the public link for the "View live" action. */
export interface BlogPostListItem extends BlogPost {
  /** Whole-minute read time derived from the body's real word count. */
  readingMinutes: number
  /** Public URL for this post (honestly 404s while the post is a draft). */
  link: string
}

export interface NewBlogPost {
  title: string
  slug?: string
  excerpt?: string | null
  body?: string | null
  coverImageUrl?: string | null
  author?: string | null
  status?: BlogStatus
}

export interface BlogPostPatch {
  title?: string
  slug?: string
  excerpt?: string | null
  body?: string | null
  coverImageUrl?: string | null
  author?: string | null
  status?: BlogStatus
}

export interface TriggerLink {
  id: string
  name: string
  slug: string
  destination_url: string
  created_at: string
  updated_at: string
}

/** A link row as the operator sees it: stats DERIVED from the real click rows
 *  (never a stored counter) plus the hosted short URL for the copy/open actions.
 *  `clicks` is the exact number of click rows, `contacts` is how many DISTINCT
 *  identified contacts opened it, `last_clicked_at` is the most recent open (null
 *  for a link nobody has opened). */
export interface TriggerLinkListItem extends TriggerLink {
  clicks: number
  contacts: number
  last_clicked_at: string | null
  /** Hosted short URL — visiting it records a click, then 302s to destination_url. */
  link: string
}

/** One row in a link's recent-click activity feed. A known opener shows by name;
 *  an anonymous open has a null contact (we never invent an identity for it). */
export interface TriggerLinkClick {
  id: string
  clicked_at: string
  contact_id: string | null
  contact_name: string | null
}

export interface NewTriggerLink {
  name: string
  slug?: string
  destinationUrl: string
}

export interface TriggerLinkPatch {
  name?: string
  slug?: string
  destinationUrl?: string
}

// ---- Communities ----
// A Skool-style group space: a community holds ordered channels, a member roster,
// and a pinned-first post feed. Every count the UI shows (members, posts, likes,
// comments, the most-active channel) is DERIVED server-side from real rows, never
// stored — an empty community is an honest zero.

export type CommunityStatus = 'draft' | 'published'
export type CommunityRole = 'member' | 'moderator' | 'admin'

export interface Community {
  id: string
  location_id: string
  name: string
  slug: string
  description: string | null
  status: CommunityStatus
  created_at: string
  updated_at: string
}

/** The derived figures a community card/header shows — each a real COUNT over the
 *  community's rows, plus the most-active channel (null when nothing's been posted). */
export interface CommunityRollup {
  members: number
  posts: number
  channelCount: number
  topChannel: string | null
}

/** A community row decorated with its rollup, as the list endpoint returns it. */
export interface CommunityListItem extends Community {
  rollup: CommunityRollup
}

export interface CommunityChannel {
  id: string
  location_id: string
  community_id: string
  position: number
  name: string
  slug: string
  created_at: string
}

/** A channel plus its real post count, as the detail endpoint returns it. */
export interface CommunityChannelWithCount extends CommunityChannel {
  postCount: number
}

export interface CommunityMember {
  id: string
  location_id: string
  community_id: string
  contact_id: string | null
  name: string
  email: string | null
  role: CommunityRole
  joined_at: string
  created_at: string
}

export interface CommunityComment {
  id: string
  location_id: string
  post_id: string
  member_id: string | null
  body: string
  created_at: string
}

/** A comment decorated with its author's name (null for a member-less comment). */
export interface CommunityCommentWithAuthor extends CommunityComment {
  authorName: string | null
}

export interface CommunityPost {
  id: string
  location_id: string
  community_id: string
  channel_id: string
  member_id: string | null
  title: string | null
  body: string
  pinned: boolean
  created_at: string
  updated_at: string
}

/** A post decorated with its channel/author names, real engagement counts, and the
 *  full comment thread — the shape the detail feed renders. */
export interface CommunityPostDetail extends CommunityPost {
  channelName: string | null
  authorName: string | null
  likes: number
  comments: number
  commentThread: CommunityCommentWithAuthor[]
}

/** GET /:id — the builder payload: the community, its ordered channels (each with a
 *  post count), its member roster, its pinned-first post feed, the derived rollup,
 *  and the public URL the "View live" action opens (only live once published). */
export interface CommunityDetail {
  community: Community
  channels: CommunityChannelWithCount[]
  members: CommunityMember[]
  posts: CommunityPostDetail[]
  rollup: CommunityRollup
  publicUrl: string
}

export interface NewCommunity {
  name: string
  slug?: string
  description?: string | null
  status?: CommunityStatus
}

export interface CommunityPatch {
  name?: string
  slug?: string
  description?: string | null
  status?: CommunityStatus
}

export interface NewCommunityChannel {
  name: string
  slug?: string
  position?: number
}

export interface CommunityChannelPatch {
  name?: string
  slug?: string
  position?: number
}

export interface NewCommunityMember {
  name: string
  email?: string | null
  contactId?: string | null
  role?: CommunityRole
}

export interface CommunityMemberPatch {
  name?: string
  email?: string | null
  role?: CommunityRole
}

export interface NewCommunityPost {
  channelId: string
  title?: string | null
  body: string
  memberId?: string | null
  pinned?: boolean
}

export interface CommunityPostPatch {
  title?: string | null
  body?: string
  pinned?: boolean
}

export interface NewCommunityComment {
  body: string
  memberId?: string | null
}

// A social account, a scheduled/published post, and the planner rollup. An account
// is honestly NOT connected until a real platform OAuth lands, so `connected`
// stays false; the scheduler and content calendar are fully real on their own.
// Publishing records a `published_at` in OpenLevel's own ledger only — no reach or
// engagement is ever stored or shown.
export type SocialPlatform =
  | 'facebook'
  | 'instagram'
  | 'google_business'
  | 'linkedin'
  | 'tiktok'
  | 'x'
  | 'youtube'
export type SocialPostStatus = 'draft' | 'scheduled' | 'published'

export interface SocialAccount {
  id: string
  location_id: string
  platform: SocialPlatform
  handle: string
  connected: boolean
  created_at: string
  updated_at: string
}

/** A post's target, resolved to the account's platform + handle (null if the
 *  account was since removed), carrying its real publish outcome once the post
 *  went out: published/failed, the failure detail, and the platform's post id. */
export interface SocialPostTargetView {
  accountId: string
  platform: SocialPlatform | null
  handle: string | null
  status: string | null
  detail: string | null
  externalId: string | null
}

/** The bare post row a write endpoint returns. */
export interface SocialPostRow {
  id: string
  location_id: string
  body: string
  media_url: string | null
  status: SocialPostStatus
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

/** A post decorated with its resolved targets, as the planner read returns it. */
export interface SocialPost extends SocialPostRow {
  targets: SocialPostTargetView[]
}

export interface SocialPlatformSummary {
  platform: SocialPlatform
  total: number
  connected: number
}

export interface SocialRollup {
  draft: number
  scheduled: number
  published: number
  total: number
  accounts: number
  connected: number
}

/** The whole planner in one read: accounts, a per-platform summary, every post
 *  (with targets), the upcoming scheduled queue, and a derived rollup. */
export interface SocialPlanner {
  accounts: SocialAccount[]
  platforms: SocialPlatformSummary[]
  posts: SocialPost[]
  queue: SocialPost[]
  rollup: SocialRollup
}

export interface NewSocialAccount {
  platform: SocialPlatform
  handle: string
}

export interface NewSocialPost {
  body: string
  mediaUrl?: string | null
  accountIds?: string[]
  scheduledAt?: string | null
}

export interface SocialPostPatch {
  body?: string
  mediaUrl?: string | null
  accountIds?: string[]
}

/** The honest connect result — connect re-verifies that the channel's ids in
 *  Settings > Social plus the location's vault key really build a working
 *  publisher; `ok:false` carries the reason and the account is never silently
 *  marked connected. */
export interface SocialConnectResult {
  ok: boolean
  reason?: string
  message?: string
  account: SocialAccount
}

/** One channel's real publish outcome for a post that went out. */
export interface SocialPublishOutcome {
  accountId: string
  platform: string
  status: 'published' | 'failed'
  detail: string | null
  externalId: string | null
}

/** The honest publish result: how many channels really accepted the post and
 *  each target's true outcome. Zero deliveries never reach here — the server
 *  answers 409 with the reasons instead. */
export interface SocialPublishResult {
  ok: true
  post: SocialPostRow
  delivery: { published: number; failed: number }
  outcomes: SocialPublishOutcome[]
}

// ---- Affiliate Manager ----
// A referral program, the affiliates promoting it, and the recorded sales they
// drove. Every figure the manager shows — clicks, referrals, sales volume,
// commission earned/paid/owed, conversion rate — is DERIVED server-side from real
// click + referral rows (affiliate-math.ts), never a stored counter, so an empty
// program is an honest zero. Two honesty rules carry through: a referral's
// commission is LOCKED at record time from the program rate (editing the rate
// never rewrites history), and "record payout" only marks unpaid referrals paid in
// OpenLevel's ledger — it moves no money, exactly like an invoice's record-payment.

export type AffiliateCommissionType = 'percent' | 'flat'
export type ReferralStatus = 'pending' | 'approved' | 'paid'

export interface AffiliateProgram {
  id: string
  location_id: string
  name: string
  status: string
  /** 'percent' → commission_value is a percentage (10 = 10%); 'flat' → cents (5000 = $50). */
  commission_type: string
  /** pg returns numeric as a string, so coerce with Number() before math. */
  commission_value: number | string
  landing_url: string
  created_at: string
  updated_at: string
}

/** An affiliate with stats DERIVED from its real click + referral rows. Money
 *  fields arrive as strings (pg bigint), so coerce with Number() before display. */
export interface AffiliateWithStats {
  id: string
  location_id: string
  program_id: string
  contact_id: string | null
  name: string
  email: string | null
  code: string
  status: string
  created_at: string
  updated_at: string
  clicks: number
  referrals: number
  sales_volume_cents: number | string
  commission_cents: number | string
  /** Approved & unpaid commission — what a payout would settle right now. */
  commission_approved_cents: number | string
  commission_paid_cents: number | string
  /** Hosted public referral URL — visiting it records a click then 302s to the landing. */
  ref_url: string
}

/** The program KPI band, summed from the per-affiliate stat rows server-side. */
export interface AffiliateRollup {
  affiliates: number
  activeAffiliates: number
  clicks: number
  referrals: number
  salesVolumeCents: number
  commissionCents: number
  /** Commission awaiting review — not owed until approved. */
  pendingCents: number
  paidCents: number
  /** Payable now: approved commission only (what payouts settle — GHL lifecycle). */
  owedCents: number
}

/** GET / — the whole manager in one read: the program (null until set up), every
 *  affiliate decorated with its referral link + derived stats, and the rollup. */
export interface AffiliateManager {
  program: AffiliateProgram | null
  affiliates: AffiliateWithStats[]
  rollup: AffiliateRollup
}

export interface AffiliateReferral {
  id: string
  location_id: string
  affiliate_id: string
  contact_id: string | null
  description: string | null
  amount_cents: number | string
  commission_cents: number | string
  status: string
  occurred_at: string
  paid_at: string | null
  created_at: string
}

/** A referral joined to the referred contact's name (null = no linked contact). */
export interface AffiliateReferralWithContact extends AffiliateReferral {
  contact_name: string | null
}

/** One row in an affiliate's referral-link click feed (null name = anonymous visit). */
export interface AffiliateClickWithContact {
  id: string
  clicked_at: string
  contact_id: string | null
  contact_name: string | null
}

/** The honest per-affiliate summary the detail header shows — every figure derived. */
export interface AffiliateSummary {
  referrals: number
  salesVolumeCents: number
  commissionCents: number
  /** Commission awaiting review — not owed until approved. */
  pendingCents: number
  paidCents: number
  /** Payable now: approved commission only — exactly what "Record payout" settles. */
  owedCents: number
  clicks: number
  /** Referrals per 100 clicks, to one decimal; 0 with no clicks, uncapped above 100. */
  conversionRate: number
}

/** GET /:id — one affiliate with its referral + click feeds and derived summary. */
export interface AffiliateDetail {
  affiliate: AffiliateWithStats
  referrals: AffiliateReferralWithContact[]
  clicks: AffiliateClickWithContact[]
  summary: AffiliateSummary
}

export interface NewAffiliateProgram {
  name: string
  commissionType?: AffiliateCommissionType
  /** Percentage when type is 'percent', cents when 'flat'. */
  commissionValue?: number
  landingUrl: string
  status?: string
}

export interface AffiliateProgramPatch {
  name?: string
  commissionType?: AffiliateCommissionType
  commissionValue?: number
  landingUrl?: string
  status?: string
}

export interface NewAffiliate {
  name: string
  email?: string | null
  code?: string
  contactId?: string | null
}

export interface AffiliatePatch {
  name?: string
  email?: string | null
  code?: string
  status?: string
  contactId?: string | null
}

export interface NewReferral {
  /** The sale this referral drove, in integer cents (the UI converts dollars). */
  amountCents: number
  description?: string | null
  contactId?: string | null
  occurredAt?: string | null
}

// ---- Endpoints ----

export const api = {
  login: (email: string, password: string) =>
    req<{ ok: true; operator: Operator }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => req<{ operator: Operator }>('/auth/me'),

  locations: () => req<{ locations: Location[] }>('/locations'),

  contacts: (loc: string) => req<{ contacts: Contact[] }>(`/loc/${loc}/contacts`),
  // Operator adds a contact by hand. A phone/email that already belongs to a
  // contact resolves to THAT record (no duplicate), so the caller navigates to
  // whatever comes back rather than assuming a brand-new row.
  createContact: (loc: string, input: { name?: string; phone?: string; email?: string }) =>
    req<{ ok: true; contact: Contact }>(`/loc/${loc}/contacts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  contact: (loc: string, id: string) =>
    req<{ contact: Contact; timeline: TimelineEvent[] }>(`/loc/${loc}/contacts/${id}`),
  // Archived (soft-deleted) contacts — the "Archived" view, newest-archived first.
  archivedContacts: (loc: string) =>
    req<{ contacts: Contact[] }>(`/loc/${loc}/contacts/archived`),
  // "Delete" a contact — a SOFT delete (archive). The contact drops out of the
  // book but is kept intact and restorable; nothing is physically removed.
  deleteContact: (loc: string, id: string) =>
    req<{ ok: true; contact: Contact }>(`/loc/${loc}/contacts/${id}`, { method: 'DELETE' }),
  // Restore an archived contact back into the book.
  restoreContact: (loc: string, id: string) =>
    req<{ ok: true; contact: Contact }>(`/loc/${loc}/contacts/${id}/restore`, { method: 'POST' }),
  // Set (or clear) the contact's US state — the per-state legal texting-hours
  // setting. Pass null to clear it back to "not set". This only stores the state;
  // the gateway is the legal authority that turns it into the allowed texting window.
  setContactState: (loc: string, id: string, state: string | null) =>
    req<{ ok: true; contact: Contact }>(`/loc/${loc}/contacts/${id}/state`, {
      method: 'PUT',
      body: JSON.stringify({ state }),
    }),
  contactNotes: (loc: string, contactId: string) =>
    req<{ notes: ContactNote[] }>(`/loc/${loc}/contacts/${contactId}/notes`),
  createContactNote: (loc: string, contactId: string, body: string, author?: string | null) =>
    req<{ ok: true; note: ContactNote }>(`/loc/${loc}/contacts/${contactId}/notes`, {
      method: 'POST',
      body: JSON.stringify(author ? { body, author } : { body }),
    }),
  updateContactNote: (
    loc: string,
    contactId: string,
    noteId: string,
    patch: { body?: string; pinned?: boolean },
  ) =>
    req<{ ok: true; note: ContactNote }>(`/loc/${loc}/contacts/${contactId}/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteContactNote: (loc: string, contactId: string, noteId: string) =>
    req<{ ok: true }>(`/loc/${loc}/contacts/${contactId}/notes/${noteId}`, { method: 'DELETE' }),

  contactTasks: (loc: string, contactId: string) =>
    req<{ tasks: ContactTask[] }>(`/loc/${loc}/contacts/${contactId}/tasks`),
  createContactTask: (
    loc: string,
    contactId: string,
    input: { title: string; body?: string | null; dueAt?: string | null },
  ) =>
    req<{ ok: true; task: ContactTask }>(`/loc/${loc}/contacts/${contactId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateContactTask: (
    loc: string,
    contactId: string,
    taskId: string,
    patch: { title?: string; body?: string | null; dueAt?: string | null; completed?: boolean },
  ) =>
    req<{ ok: true; task: ContactTask }>(`/loc/${loc}/contacts/${contactId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteContactTask: (loc: string, contactId: string, taskId: string) =>
    req<{ ok: true }>(`/loc/${loc}/contacts/${contactId}/tasks/${taskId}`, { method: 'DELETE' }),
  /** The cross-contact worklist: every task with its contact name + a live KPI summary. */
  tasks: (loc: string) =>
    req<{ tasks: ContactTaskWithContact[]; summary: TaskSummary }>(`/loc/${loc}/tasks`),

  // ---- Tags ----
  // The location-wide distinct-set view (with contact counts) plus rename/delete
  // across every contact, and the per-contact add/remove used by the tag editor.
  // Every path that carries a tag value encodeURIComponent's it, so a tag with a
  // space or slash survives the round trip (Hono decodes the path param).
  tags: (loc: string) => req<{ tags: TagSummary[] }>(`/loc/${loc}/tags`),
  renameTag: (loc: string, tag: string, name: string) =>
    req<{ ok: true; renamed: number }>(`/loc/${loc}/tags/${encodeURIComponent(tag)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteTag: (loc: string, tag: string) =>
    req<{ ok: true; removed: number }>(`/loc/${loc}/tags/${encodeURIComponent(tag)}`, {
      method: 'DELETE',
    }),
  addContactTag: (loc: string, contactId: string, tag: string) =>
    req<{ ok: true; contact: Contact }>(`/loc/${loc}/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    }),
  removeContactTag: (loc: string, contactId: string, tag: string) =>
    req<{ ok: true; contact: Contact }>(
      `/loc/${loc}/contacts/${contactId}/tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE' },
    ),

  // ---- Custom Fields ----
  // The location-wide custom-field *definitions* (the "Custom Fields" settings
  // area) plus the per-contact value write used by the contact record's editor.
  // A field's `key` is immutable once created, so relabeling never orphans the
  // values already stored on contacts under that key.
  customFields: (loc: string) => req<{ fields: CustomField[] }>(`/loc/${loc}/custom-fields`),
  createCustomField: (loc: string, input: NewCustomField) =>
    req<{ ok: true; field: CustomField }>(`/loc/${loc}/custom-fields`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCustomField: (
    loc: string,
    id: string,
    patch: Partial<Pick<CustomField, 'label' | 'type' | 'options' | 'placeholder' | 'position'>>,
  ) =>
    req<{ ok: true; field: CustomField }>(`/loc/${loc}/custom-fields/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCustomField: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/custom-fields/${id}`, { method: 'DELETE' }),
  /** Set (or, with null, clear) one custom-field value on a contact. The value is
   *  coerced server-side by the field's declared type. */
  setContactCustomField: (
    loc: string,
    contactId: string,
    key: string,
    value: string | number | boolean | null,
  ) =>
    req<{ ok: true; contact: Contact }>(
      `/loc/${loc}/contacts/${contactId}/custom-fields/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ value }) },
    ),

  // Custom *values* — location-level constants (business name, booking link, …)
  // spliced into templates and automations as {{custom_values.<key>}} merge tags.
  // The key is immutable once created, so a tag already placed keeps resolving.
  customValues: (loc: string) => req<{ values: CustomValue[] }>(`/loc/${loc}/custom-values`),
  createCustomValue: (loc: string, input: NewCustomValue) =>
    req<{ ok: true; value: CustomValue }>(`/loc/${loc}/custom-values`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCustomValue: (
    loc: string,
    id: string,
    patch: Partial<Pick<CustomValue, 'name' | 'value' | 'position'>>,
  ) =>
    req<{ ok: true; value: CustomValue }>(`/loc/${loc}/custom-values/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCustomValue: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/custom-values/${id}`, { method: 'DELETE' }),

  // AI Agent settings — the reply mode (the load-bearing safety control) plus the
  // agent's persona, owner instructions, and knowledge-base facts. The PATCH
  // touches only the fields it sends and echoes back the merged view.
  agentSettings: (loc: string) => req<AgentSettings>(`/loc/${loc}/settings/agent`),
  updateAgentSettings: (loc: string, patch: AgentSettingsPatch) =>
    req<{ ok: true } & AgentSettings>(`/loc/${loc}/settings/agent`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // Payments processor connection — the choice of processor plus the honest
  // server-side `connected` readout. API keys are never sent through here; they
  // live in the vault under `<slug>:stripe:secret_key` etc.
  paymentsSettings: (loc: string) => req<PaymentsSettings>(`/loc/${loc}/settings/payments`),
  updatePaymentsSettings: (loc: string, patch: PaymentsSettingsPatch) =>
    req<{ ok: true } & PaymentsSettings>(`/loc/${loc}/settings/payments`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // Campaign sending providers — Brevo email / Twilio SMS choice + sender
  // identity, with honest per-channel `connected` readouts. The provider keys
  // are never sent through here; they live in the vault by name.
  socialSettings: (loc: string) => req<SocialSettings>(`/loc/${loc}/settings/social`),
  updateSocialSettings: (loc: string, patch: SocialSettingsPatch) =>
    req<{ ok: true } & SocialSettings>(`/loc/${loc}/settings/social`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  sendingSettings: (loc: string) => req<SendingSettings>(`/loc/${loc}/settings/sending`),
  updateSendingSettings: (loc: string, patch: SendingSettingsPatch) =>
    req<{ ok: true } & SendingSettings>(`/loc/${loc}/settings/sending`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // Voice provider (Module 52) — Twilio click-to-call bridge or the Vapi AI
  // voice agent, running in the location's OWN account. Keys live in the vault
  // by name and are never sent through here.
  voiceSettings: (loc: string) => req<VoiceSettings>(`/loc/${loc}/settings/voice`),
  updateVoiceSettings: (loc: string, patch: VoiceSettingsPatch) =>
    req<{ ok: true } & VoiceSettings>(`/loc/${loc}/settings/voice`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** The call log + derived stats, newest first. */
  calls: (loc: string) => req<{ calls: CallRow[]; stats: CallStats }>(`/loc/${loc}/calls`),
  /** Click-to-call: ring a contact through the connected provider. Refusals
   *  surface as ApiError with the honest reason (409/422/502). */
  placeCall: (loc: string, contactId: string) =>
    req<{ ok: true; call: CallRow }>(`/loc/${loc}/calls`, {
      method: 'POST',
      body: JSON.stringify({ contactId }),
    }),

  /** The reusable email/SMS template library. */
  templates: (loc: string) => req<{ templates: Template[] }>(`/loc/${loc}/templates`),
  createTemplate: (loc: string, input: NewTemplate) =>
    req<{ ok: true; template: Template }>(`/loc/${loc}/templates`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTemplate: (loc: string, id: string, patch: TemplatePatch) =>
    req<{ ok: true; template: Template }>(`/loc/${loc}/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTemplate: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/templates/${id}`, { method: 'DELETE' }),

  conversations: (loc: string) => req<{ conversations: Conversation[] }>(`/loc/${loc}/conversations`),
  thread: (loc: string, id: string) =>
    req<{ conversation: Conversation; messages: Message[] }>(`/loc/${loc}/conversations/${id}`),
  sendMessage: (loc: string, id: string, body: string) =>
    req<{ ok: true; message: Message }>(`/loc/${loc}/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  draft: (loc: string, id: string) =>
    req<{ text: string }>(`/loc/${loc}/conversations/${id}/draft`, { method: 'POST' }),

  // The "AI front door": send the running operator↔assistant history plus the new
  // message; get back the assistant's reply AND any changes it PREPARED for the
  // operator to confirm (proposals). The send itself never mutates the CRM. 501
  // when no Claude client is configured server-side.
  assistantSend: (loc: string, history: AssistantTurn[], message: string) =>
    req<{ reply: string; proposals: ProposedAction[] }>(`/loc/${loc}/assistant/messages`, {
      method: 'POST',
      body: JSON.stringify({ history, message }),
    }),

  // Perform ONE prepared change — the single write path of the whole assistant. The
  // operator taps Confirm on a proposal card; we replay its {verb, params}. The
  // tenant is the URL's location, never the body, so a confirm can't cross accounts.
  // Returns the plain-English result line; throws ApiError (e.g. 400) on refusal.
  assistantConfirm: (loc: string, verb: string, params: Record<string, unknown>) =>
    req<{ message: string }>(`/loc/${loc}/assistant/confirm`, {
      method: 'POST',
      body: JSON.stringify({ verb, params }),
    }),

  pipelines: (loc: string) => req<{ pipelines: Pipeline[] }>(`/loc/${loc}/opportunities/pipelines`),

  // --- Pipeline + stage *structure* management (Settings -> Pipelines) -------
  // Distinct from the `pipelines` reader above (the kanban reads that one, served
  // by the opportunities route). These hit the dedicated /pipelines route and own
  // create/rename/delete of pipelines and their stages. A guarded delete can come
  // back 409 with a plain reason (the last pipeline or stage, or it still holds
  // opportunities); req() surfaces that text as ApiError.message so the settings
  // page can show the honest reason inline instead of a silent cascade.
  managePipelines: (loc: string) => req<{ pipelines: Pipeline[] }>(`/loc/${loc}/pipelines`),
  createPipeline: (loc: string, name: string) =>
    req<{ ok: true; pipeline: Pipeline }>(`/loc/${loc}/pipelines`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renamePipeline: (loc: string, id: string, name: string) =>
    req<{ ok: true; pipeline: Pipeline }>(`/loc/${loc}/pipelines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deletePipeline: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/pipelines/${id}`, { method: 'DELETE' }),
  addStage: (loc: string, pipelineId: string, name: string) =>
    req<{ ok: true; stage: Stage }>(`/loc/${loc}/pipelines/${pipelineId}/stages`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renameStage: (loc: string, stageId: string, name: string) =>
    req<{ ok: true; stage: Stage }>(`/loc/${loc}/pipelines/stages/${stageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  reorderStages: (loc: string, pipelineId: string, orderedIds: string[]) =>
    req<{ ok: true; stages: Stage[] }>(`/loc/${loc}/pipelines/${pipelineId}/stages-reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }),
  deleteStage: (loc: string, stageId: string) =>
    req<{ ok: true }>(`/loc/${loc}/pipelines/stages/${stageId}`, { method: 'DELETE' }),

  opportunities: (loc: string, pipelineId: string) =>
    req<{ opportunities: Opportunity[] }>(
      `/loc/${loc}/opportunities?pipelineId=${encodeURIComponent(pipelineId)}`,
    ),
  createOpportunity: (loc: string, input: NewOpportunity) =>
    req<{ ok: true; opportunity: Opportunity }>(`/loc/${loc}/opportunities`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  moveOpportunity: (loc: string, id: string, stageId: string) =>
    req<{ ok: true; opportunity: Opportunity }>(`/loc/${loc}/opportunities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stageId }),
    }),
  setOpportunityStatus: (loc: string, id: string, status: OpportunityStatus) =>
    req<{ ok: true; opportunity: Opportunity }>(`/loc/${loc}/opportunities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  calendars: (loc: string) => req<{ calendars: Calendar[] }>(`/loc/${loc}/calendars`),
  createCalendar: (loc: string, input: NewCalendar) =>
    req<{ ok: true; calendar: Calendar }>(`/loc/${loc}/calendars`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCalendar: (loc: string, id: string, patch: CalendarPatch) =>
    req<{ ok: true; calendar: Calendar }>(`/loc/${loc}/calendars/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  appointments: (loc: string, from?: string, to?: string) => {
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    const q = qs.toString()
    return req<{ appointments: Appointment[] }>(
      `/loc/${loc}/calendars/appointments${q ? `?${q}` : ''}`,
    )
  },
  createAppointment: (loc: string, input: NewAppointment) =>
    req<{ ok: true; appointment: Appointment }>(`/loc/${loc}/calendars/appointments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  rescheduleAppointment: (loc: string, id: string, startsAt: string, endsAt: string) =>
    req<{ ok: true; appointment: Appointment }>(`/loc/${loc}/calendars/appointments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ startsAt, endsAt }),
    }),
  setAppointmentStatus: (loc: string, id: string, status: AppointmentStatus) =>
    req<{ ok: true; appointment: Appointment }>(`/loc/${loc}/calendars/appointments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  campaigns: (loc: string) => req<{ campaigns: Campaign[] }>(`/loc/${loc}/campaigns`),
  createCampaign: (loc: string, input: NewCampaign) =>
    req<{ ok: true; campaign: Campaign }>(`/loc/${loc}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  sendCampaign: (loc: string, id: string) =>
    req<{ ok: true; campaign: Campaign; delivery: CampaignDelivery }>(
      `/loc/${loc}/campaigns/${id}/send`,
      { method: 'POST' },
    ),

  workflows: (loc: string) => req<{ workflows: Workflow[] }>(`/loc/${loc}/workflows`),
  workflow: (loc: string, id: string) =>
    req<{ workflow: Workflow; actions: WorkflowAction[] }>(`/loc/${loc}/workflows/${id}`),
  createWorkflow: (loc: string, input: NewWorkflow) =>
    req<{ ok: true; workflow: Workflow }>(`/loc/${loc}/workflows`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWorkflow: (loc: string, id: string, patch: Partial<NewWorkflow> & { status?: WorkflowStatus }) =>
    req<{ ok: true; workflow: Workflow }>(`/loc/${loc}/workflows/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  replaceWorkflowActions: (loc: string, id: string, actions: WorkflowActionInput[]) =>
    req<{ ok: true; actions: WorkflowAction[] }>(`/loc/${loc}/workflows/${id}/actions`, {
      method: 'PUT',
      body: JSON.stringify({ actions }),
    }),
  testRunWorkflow: (loc: string, id: string, contactId: string | null) =>
    req<{ ok: true; run: WorkflowRun }>(`/loc/${loc}/workflows/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ contactId }),
    }),
  workflowRuns: (loc: string, id: string) =>
    req<{ runs: WorkflowRun[] }>(`/loc/${loc}/workflows/${id}/runs`),

  reporting: (loc: string) => req<{ summary: ReportingSummary }>(`/loc/${loc}/reporting`),

  funnels: (loc: string) => req<{ funnels: FunnelListItem[] }>(`/loc/${loc}/funnels`),
  funnel: (loc: string, id: string) =>
    req<{ funnel: Funnel; steps: FunnelStep[] }>(`/loc/${loc}/funnels/${id}`),
  createFunnel: (loc: string, input: NewFunnel) =>
    req<{ ok: true; funnel: Funnel; steps: FunnelStep[] }>(`/loc/${loc}/funnels`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateFunnel: (
    loc: string,
    id: string,
    patch: Partial<NewFunnel> & { status?: FunnelStatus },
  ) =>
    req<{ ok: true; funnel: Funnel }>(`/loc/${loc}/funnels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  addFunnelStep: (loc: string, id: string, input: NewFunnelStep) =>
    req<{ ok: true; step: FunnelStep }>(`/loc/${loc}/funnels/${id}/steps`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateFunnelStep: (loc: string, id: string, stepId: string, patch: FunnelStepPatch) =>
    req<{ ok: true; step: FunnelStep }>(`/loc/${loc}/funnels/${id}/steps/${stepId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  forms: (loc: string) => req<{ forms: Form[] }>(`/loc/${loc}/forms`),
  form: (loc: string, id: string) =>
    req<{ form: Form; submissions: FormSubmission[] }>(`/loc/${loc}/forms/${id}`),
  createForm: (loc: string, input: NewForm) =>
    req<{ ok: true; form: Form }>(`/loc/${loc}/forms`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateForm: (
    loc: string,
    id: string,
    patch: Partial<NewForm> & { status?: FormStatus; content?: FormContent },
  ) =>
    req<{ ok: true; form: Form }>(`/loc/${loc}/forms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  surveys: (loc: string) => req<{ surveys: Survey[] }>(`/loc/${loc}/surveys`),
  survey: (loc: string, id: string) =>
    req<{ survey: Survey; submissions: SurveySubmission[] }>(`/loc/${loc}/surveys/${id}`),
  createSurvey: (loc: string, input: NewSurvey) =>
    req<{ ok: true; survey: Survey }>(`/loc/${loc}/surveys`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSurvey: (
    loc: string,
    id: string,
    patch: Partial<NewSurvey> & { status?: SurveyStatus; content?: SurveyContent },
  ) =>
    req<{ ok: true; survey: Survey }>(`/loc/${loc}/surveys/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  invoices: (loc: string) => req<{ invoices: Invoice[] }>(`/loc/${loc}/invoices`),
  invoice: (loc: string, id: string) => req<{ invoice: Invoice }>(`/loc/${loc}/invoices/${id}`),
  createInvoice: (loc: string, input: InvoicePatch = {}) =>
    req<{ ok: true; invoice: Invoice }>(`/loc/${loc}/invoices`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateInvoice: (loc: string, id: string, patch: InvoicePatch) =>
    req<{ ok: true; invoice: Invoice }>(`/loc/${loc}/invoices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  sendInvoice: (loc: string, id: string) =>
    req<{ ok: true; invoice: Invoice }>(`/loc/${loc}/invoices/${id}/send`, { method: 'POST' }),
  recordInvoicePayment: (loc: string, id: string, method: string) =>
    req<{ ok: true; invoice: Invoice }>(`/loc/${loc}/invoices/${id}/record-payment`, {
      method: 'POST',
      body: JSON.stringify({ method }),
    }),
  voidInvoice: (loc: string, id: string) =>
    req<{ ok: true; invoice: Invoice }>(`/loc/${loc}/invoices/${id}/void`, { method: 'POST' }),
  /** Mint a hosted checkout link for the invoice inside the location's OWN
   *  Stripe/Square account. 409 carries the honest reason when no processor is
   *  connected or the invoice is already settled. */
  createCheckoutLink: (loc: string, id: string) =>
    req<{ ok: true; invoice: Invoice; checkoutUrl: string }>(
      `/loc/${loc}/invoices/${id}/checkout-link`,
      { method: 'POST' },
    ),

  // ---- Product catalog (Payments -> Products) ----
  products: (loc: string) => req<{ products: Product[] }>(`/loc/${loc}/products`),
  product: (loc: string, id: string) => req<{ product: Product }>(`/loc/${loc}/products/${id}`),
  createProduct: (loc: string, input: NewProduct) =>
    req<{ ok: true; product: Product }>(`/loc/${loc}/products`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProduct: (loc: string, id: string, patch: ProductPatch) =>
    req<{ ok: true; product: Product }>(`/loc/${loc}/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteProduct: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/products/${id}`, { method: 'DELETE' }),

  // ---- Subscriptions (Payments -> Subscriptions) ----
  // The recurring-commitment ledger. BOOKKEEPING ONLY — it records that a contact
  // is on a recurring arrangement and derives the schedule + MRR from the rows; it
  // never charges a card or moves money. A subscription can only be started from a
  // recurring catalog product, so its price is always one the operator actually set.
  subscriptions: (loc: string) =>
    req<{ subscriptions: SubscriptionWithSchedule[]; summary: SubscriptionSummary }>(
      `/loc/${loc}/subscriptions`,
    ),
  createSubscription: (loc: string, input: NewSubscription) =>
    req<{ ok: true; subscription: Subscription }>(`/loc/${loc}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSubscription: (loc: string, id: string, patch: SubscriptionPatch) =>
    req<{ ok: true; subscription: Subscription }>(`/loc/${loc}/subscriptions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteSubscription: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/subscriptions/${id}`, { method: 'DELETE' }),

  // ---- Coupons (Payments -> Coupons) ----
  // The discount-code book. BOOKKEEPING ONLY — a coupon is a reusable discount
  // DEFINITION a later step can apply to an invoice's recorded total; defining or
  // editing one never charges a card or moves money. The `redeemable` flag on each
  // row and the summary totals are DERIVED server-side, so they cannot overstate use.
  coupons: (loc: string) =>
    req<{ coupons: CouponWithRedeemable[]; summary: CouponSummary }>(`/loc/${loc}/coupons`),
  createCoupon: (loc: string, input: NewCoupon) =>
    req<{ ok: true; coupon: Coupon }>(`/loc/${loc}/coupons`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCoupon: (loc: string, id: string, patch: CouponPatch) =>
    req<{ ok: true; coupon: Coupon }>(`/loc/${loc}/coupons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCoupon: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/coupons/${id}`, { method: 'DELETE' }),

  // The Transactions ledger. READ-ONLY by design — every row is a paid invoice
  // projected into a payment, with its amount DERIVED from that invoice's line
  // items. There is no create/charge call here because OpenLevel never moves
  // money; a transaction exists only because record-payment marked an invoice
  // paid. The summary is rolled up server-side from those same rows.
  transactions: (loc: string) =>
    req<{ transactions: Transaction[]; summary: TransactionSummary }>(`/loc/${loc}/transactions`),

  proposals: (loc: string) => req<{ proposals: Proposal[] }>(`/loc/${loc}/proposals`),
  proposal: (loc: string, id: string) =>
    req<{ proposal: Proposal }>(`/loc/${loc}/proposals/${id}`),
  createProposal: (loc: string, input: NewProposal) =>
    req<{ ok: true; proposal: Proposal }>(`/loc/${loc}/proposals`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProposal: (loc: string, id: string, patch: ProposalPatch) =>
    req<{ ok: true; proposal: Proposal }>(`/loc/${loc}/proposals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  sendProposal: (loc: string, id: string) =>
    req<{ ok: true; proposal: Proposal }>(`/loc/${loc}/proposals/${id}/send`, { method: 'POST' }),

  reviews: (loc: string) =>
    req<{ reviews: Review[]; requests: ReviewRequest[]; stats: ReviewStats }>(`/loc/${loc}/reviews`),
  requestReview: (loc: string, contactId: string | null) =>
    req<{ ok: true; request: ReviewRequest; link: string }>(`/loc/${loc}/reviews/request`, {
      method: 'POST',
      body: JSON.stringify(contactId ? { contactId } : {}),
    }),
  setReviewStatus: (loc: string, id: string, status: ReviewModerationStatus) =>
    req<{ ok: true; review: Review }>(`/loc/${loc}/reviews/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  syncReviews: (loc: string) =>
    req<{ ok: true; results: ReviewSyncResult[] }>(`/loc/${loc}/reviews/sync`, { method: 'POST' }),
  reviewSyncStatus: (loc: string) =>
    req<Record<string, ChannelStatus>>(`/loc/${loc}/reviews/sync/status`),

  courses: (loc: string) => req<{ courses: CourseListItem[] }>(`/loc/${loc}/courses`),
  course: (loc: string, id: string) => req<CourseDetail>(`/loc/${loc}/courses/${id}`),
  createCourse: (loc: string, input: NewCourse) =>
    req<{ ok: true; course: CourseListItem }>(`/loc/${loc}/courses`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCourse: (loc: string, id: string, patch: CoursePatch) =>
    req<{ ok: true; course: Course }>(`/loc/${loc}/courses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCourse: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/courses/${id}`, { method: 'DELETE' }),
  addLesson: (loc: string, id: string, input: NewLesson) =>
    req<{ ok: true; lesson: Lesson }>(`/loc/${loc}/courses/${id}/lessons`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateLesson: (loc: string, id: string, lessonId: string, patch: LessonPatch) =>
    req<{ ok: true; lesson: Lesson }>(`/loc/${loc}/courses/${id}/lessons/${lessonId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteLesson: (loc: string, id: string, lessonId: string) =>
    req<{ ok: true }>(`/loc/${loc}/courses/${id}/lessons/${lessonId}`, { method: 'DELETE' }),
  enrollContact: (loc: string, id: string, contactId: string | null) =>
    req<{ ok: true; enrollment: Enrollment; link: string }>(`/loc/${loc}/courses/${id}/enroll`, {
      method: 'POST',
      body: JSON.stringify(contactId ? { contactId } : {}),
    }),
  removeEnrollment: (loc: string, id: string, enrollId: string) =>
    req<{ ok: true }>(`/loc/${loc}/courses/${id}/enrollments/${enrollId}`, { method: 'DELETE' }),

  blogPosts: (loc: string) => req<{ posts: BlogPostListItem[] }>(`/loc/${loc}/blog`),
  blogPost: (loc: string, id: string) => req<{ post: BlogPostListItem }>(`/loc/${loc}/blog/${id}`),
  createBlogPost: (loc: string, input: NewBlogPost) =>
    req<{ ok: true; post: BlogPostListItem }>(`/loc/${loc}/blog`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateBlogPost: (loc: string, id: string, patch: BlogPostPatch) =>
    req<{ ok: true; post: BlogPostListItem }>(`/loc/${loc}/blog/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteBlogPost: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/blog/${id}`, { method: 'DELETE' }),

  triggerLinks: (loc: string) =>
    req<{ links: TriggerLinkListItem[] }>(`/loc/${loc}/trigger-links`),
  triggerLink: (loc: string, id: string) =>
    req<{ link: TriggerLinkListItem; clicks: TriggerLinkClick[] }>(
      `/loc/${loc}/trigger-links/${id}`,
    ),
  createTriggerLink: (loc: string, input: NewTriggerLink) =>
    req<{ ok: true; link: TriggerLinkListItem }>(`/loc/${loc}/trigger-links`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTriggerLink: (loc: string, id: string, patch: TriggerLinkPatch) =>
    req<{ ok: true; link: TriggerLinkListItem }>(`/loc/${loc}/trigger-links/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTriggerLink: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/trigger-links/${id}`, { method: 'DELETE' }),

  // ---- Communities ----
  communities: (loc: string) =>
    req<{ communities: CommunityListItem[] }>(`/loc/${loc}/communities`),
  community: (loc: string, id: string) =>
    req<CommunityDetail>(`/loc/${loc}/communities/${id}`),
  createCommunity: (loc: string, input: NewCommunity) =>
    req<{ ok: true; community: CommunityListItem }>(`/loc/${loc}/communities`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCommunity: (loc: string, id: string, patch: CommunityPatch) =>
    req<{ ok: true; community: Community }>(`/loc/${loc}/communities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCommunity: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/communities/${id}`, { method: 'DELETE' }),

  addCommunityChannel: (loc: string, id: string, input: NewCommunityChannel) =>
    req<{ ok: true; channel: CommunityChannelWithCount }>(
      `/loc/${loc}/communities/${id}/channels`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  updateCommunityChannel: (
    loc: string,
    id: string,
    channelId: string,
    patch: CommunityChannelPatch,
  ) =>
    req<{ ok: true; channel: CommunityChannel }>(
      `/loc/${loc}/communities/${id}/channels/${channelId}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),
  deleteCommunityChannel: (loc: string, id: string, channelId: string) =>
    req<{ ok: true }>(`/loc/${loc}/communities/${id}/channels/${channelId}`, {
      method: 'DELETE',
    }),

  addCommunityMember: (loc: string, id: string, input: NewCommunityMember) =>
    req<{ ok: true; member: CommunityMember }>(`/loc/${loc}/communities/${id}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCommunityMember: (
    loc: string,
    id: string,
    memberId: string,
    patch: CommunityMemberPatch,
  ) =>
    req<{ ok: true; member: CommunityMember }>(
      `/loc/${loc}/communities/${id}/members/${memberId}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),
  deleteCommunityMember: (loc: string, id: string, memberId: string) =>
    req<{ ok: true }>(`/loc/${loc}/communities/${id}/members/${memberId}`, {
      method: 'DELETE',
    }),

  addCommunityPost: (loc: string, id: string, input: NewCommunityPost) =>
    req<{ ok: true; post: CommunityPost }>(`/loc/${loc}/communities/${id}/posts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCommunityPost: (loc: string, id: string, postId: string, patch: CommunityPostPatch) =>
    req<{ ok: true; post: CommunityPost }>(`/loc/${loc}/communities/${id}/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  pinCommunityPost: (loc: string, id: string, postId: string, pinned: boolean) =>
    req<{ ok: true; post: CommunityPost }>(
      `/loc/${loc}/communities/${id}/posts/${postId}/pin`,
      { method: 'POST', body: JSON.stringify({ pinned }) },
    ),
  deleteCommunityPost: (loc: string, id: string, postId: string) =>
    req<{ ok: true }>(`/loc/${loc}/communities/${id}/posts/${postId}`, { method: 'DELETE' }),

  addCommunityComment: (loc: string, id: string, postId: string, input: NewCommunityComment) =>
    req<{ ok: true; comment: CommunityComment }>(
      `/loc/${loc}/communities/${id}/posts/${postId}/comments`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  deleteCommunityComment: (loc: string, id: string, postId: string, commentId: string) =>
    req<{ ok: true }>(
      `/loc/${loc}/communities/${id}/posts/${postId}/comments/${commentId}`,
      { method: 'DELETE' },
    ),

  // ---- Social Planner ----
  social: (loc: string) => req<SocialPlanner>(`/loc/${loc}/social`),
  addSocialAccount: (loc: string, input: NewSocialAccount) =>
    req<{ ok: true; account: SocialAccount }>(`/loc/${loc}/social/accounts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSocialAccount: (loc: string, accountId: string, patch: { handle?: string }) =>
    req<{ ok: true; account: SocialAccount }>(`/loc/${loc}/social/accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  // Honest connect: verifies the channel's ids + vault key really build a
  // working publisher; the flag follows the truth in both directions.
  connectSocialAccount: (loc: string, accountId: string) =>
    req<SocialConnectResult>(`/loc/${loc}/social/accounts/${accountId}/connect`, {
      method: 'POST',
    }),
  deleteSocialAccount: (loc: string, accountId: string) =>
    req<{ ok: true }>(`/loc/${loc}/social/accounts/${accountId}`, { method: 'DELETE' }),

  createSocialPost: (loc: string, input: NewSocialPost) =>
    req<{ ok: true; post: SocialPostRow }>(`/loc/${loc}/social/posts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSocialPost: (loc: string, postId: string, patch: SocialPostPatch) =>
    req<{ ok: true; post: SocialPostRow }>(`/loc/${loc}/social/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  scheduleSocialPost: (loc: string, postId: string, scheduledAt: string, accountIds?: string[]) =>
    req<{ ok: true; post: SocialPostRow }>(`/loc/${loc}/social/posts/${postId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduledAt, accountIds }),
    }),
  // Honest publish: the post REALLY goes out through the location's own
  // channels; zero deliveries answer 409 with the reasons and the post stays put.
  publishSocialPost: (loc: string, postId: string) =>
    req<SocialPublishResult>(`/loc/${loc}/social/posts/${postId}/publish`, {
      method: 'POST',
    }),
  deleteSocialPost: (loc: string, postId: string) =>
    req<{ ok: true }>(`/loc/${loc}/social/posts/${postId}`, { method: 'DELETE' }),

  // ---- Affiliate Manager ----
  affiliates: (loc: string) => req<AffiliateManager>(`/loc/${loc}/affiliates`),
  affiliate: (loc: string, id: string) => req<AffiliateDetail>(`/loc/${loc}/affiliates/${id}`),
  createAffiliateProgram: (loc: string, input: NewAffiliateProgram) =>
    req<{ ok: true; program: AffiliateProgram }>(`/loc/${loc}/affiliates/program`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAffiliateProgram: (
    loc: string,
    programId: string,
    patch: AffiliateProgramPatch,
  ) =>
    req<{ ok: true; program: AffiliateProgram }>(`/loc/${loc}/affiliates/program/${programId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  createAffiliate: (loc: string, input: NewAffiliate) =>
    req<{ ok: true; affiliate: AffiliateWithStats }>(`/loc/${loc}/affiliates`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAffiliate: (loc: string, id: string, patch: AffiliatePatch) =>
    req<{ ok: true; affiliate: AffiliateWithStats }>(`/loc/${loc}/affiliates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteAffiliate: (loc: string, id: string) =>
    req<{ ok: true }>(`/loc/${loc}/affiliates/${id}`, { method: 'DELETE' }),
  // Record a sale an affiliate drove. Commission is LOCKED server-side from the
  // program rate — the client sends only the sale amount, never the commission.
  recordReferral: (loc: string, id: string, input: NewReferral) =>
    req<{ ok: true; referral: AffiliateReferral }>(`/loc/${loc}/affiliates/${id}/referrals`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  setReferralStatus: (loc: string, id: string, refId: string, status: ReferralStatus) =>
    req<{ ok: true; referral: AffiliateReferral }>(
      `/loc/${loc}/affiliates/${id}/referrals/${refId}`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    ),
  // Record a payout: mark every unpaid referral paid in our ledger. BOOKKEEPING
  // ONLY — moves no money, exactly like an invoice's record-payment.
  affiliatePayout: (loc: string, id: string) =>
    req<{ ok: true; settledCount: number; paidCents: number }>(
      `/loc/${loc}/affiliates/${id}/payout`,
      { method: 'POST' },
    ),
}
