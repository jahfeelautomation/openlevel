-- OpenLevel schema (slice 1). Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS locations (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  client_slug text,
  branding    jsonb DEFAULT '{}',
  settings    jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operators (
  id            text PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  name          text,
  role          text NOT NULL DEFAULT 'owner',
  password_hash text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operator_locations (
  operator_id text REFERENCES operators(id) ON DELETE CASCADE,
  location_id text REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (operator_id, location_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id            text PRIMARY KEY,
  location_id   text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name          text,
  first_name    text,
  last_name     text,
  phones        text[] DEFAULT '{}',
  emails        text[] DEFAULT '{}',
  tags          text[] DEFAULT '{}',
  custom_fields jsonb DEFAULT '{}',
  source        text,
  external_ids  jsonb DEFAULT '{}',
  match_key     text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_match_key
  ON contacts(location_id, match_key) WHERE match_key IS NOT NULL;
-- Soft-delete (archive). The operator's "Delete" control stamps archived_at
-- instead of hard-deleting, because a contact carries notes/tasks/timeline
-- (ON DELETE CASCADE) and conversations/opportunities (ON DELETE SET NULL) a
-- real delete would silently destroy. archived_at NULL = live (in the book);
-- a timestamp = archived (hidden, restorable). Nothing is physically removed.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- Partial index: list/count/search/segments all filter archived_at IS NULL, so
-- index the live rows for those hot reads; the Archived view is rare.
CREATE INDEX IF NOT EXISTS contacts_live ON contacts(location_id) WHERE archived_at IS NULL;
-- Per-state legal texting hours. The contact's US state (2-letter code) pins
-- which legal window the gateway enforces when sending a text: 8am-9pm in THAT
-- state's own timezone, DST-aware. NULL = not set, which the gateway refuses as
-- unknown_state rather than guessing a timezone (an Arizona guess would wave a
-- too-late North-Carolina text through). Bryan's leads are AZ + NC today.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS state text;

-- Operator-defined custom field *definitions* (the GHL "Custom Fields" settings
-- area). Each row is a field the operator added to their contact records: a
-- stable `key` (slug, never changes once created), a display `label`, a `type`
-- that drives the input control, and `options` for dropdowns. The per-contact
-- *values* live in contacts.custom_fields jsonb keyed by this `key` — definitions
-- here, values there.
CREATE TABLE IF NOT EXISTS custom_fields (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  key         text NOT NULL,
  label       text NOT NULL,
  type        text NOT NULL DEFAULT 'text',
  options     jsonb NOT NULL DEFAULT '[]',
  placeholder text,
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_key
  ON custom_fields(location_id, key);
CREATE INDEX IF NOT EXISTS custom_fields_by_location
  ON custom_fields(location_id, position);

-- Custom *values* are location-level constants the operator defines once
-- (business name, booking link, support phone) and references as merge tags
-- like {{custom_values.business_name}} in templates, emails, and automations.
-- Unlike custom_fields (per-contact data), there is exactly one value per
-- location per key. The `key` is slugified from the name once and never changes,
-- so a token already placed in a template keeps resolving after a rename.
CREATE TABLE IF NOT EXISTS custom_values (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  value       text NOT NULL DEFAULT '',
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_values_key
  ON custom_values(location_id, key);
CREATE INDEX IF NOT EXISTS custom_values_by_location
  ON custom_values(location_id, position);

CREATE TABLE IF NOT EXISTS channel_links (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  inbox_id    text NOT NULL,
  config      jsonb DEFAULT '{}',
  UNIQUE (provider, inbox_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id              text PRIMARY KEY,
  location_id     text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id      text REFERENCES contacts(id) ON DELETE SET NULL,
  channel         text,
  provider        text,
  external_id     text,
  status          text DEFAULT 'open',
  assignee        text,
  last_message_at timestamptz,
  created_at      timestamptz DEFAULT now()
);
-- Dedupe a provider's conversation *within its tenant*, not globally. Two
-- federated Chatwoot instances can hand out the same conversation id; a global
-- UNIQUE(provider, external_id) would wrongly reject the second tenant's
-- conversation, so the key carries location_id. It also backs the atomic
-- INSERT ... ON CONFLICT upsert in ConversationsRepo.upsertByExternal.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_provider_external
  ON conversations(location_id, provider, external_id);

CREATE TABLE IF NOT EXISTS messages (
  id              text PRIMARY KEY,
  location_id     text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  conversation_id text REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id      text REFERENCES contacts(id) ON DELETE SET NULL,
  direction       text NOT NULL,
  channel         text,
  provider        text,
  external_id     text,
  body            text,
  attachments     jsonb DEFAULT '[]',
  author_type     text,
  author_id       text,
  status          text DEFAULT 'sent',
  created_at      timestamptz DEFAULT now()
);
-- Inbound dedupe is per-tenant for the same reason as conversations above: a
-- global UNIQUE(provider, external_id) would let one tenant's message id silently
-- swallow another tenant's inbound. Backs the ON CONFLICT DO NOTHING guard in
-- MessagesRepo.insertInbound.
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_external
  ON messages(location_id, provider, external_id);

CREATE TABLE IF NOT EXISTS timeline_events (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id  text REFERENCES contacts(id) ON DELETE CASCADE,
  type        text NOT NULL,
  ref_table   text,
  ref_id      text,
  payload     jsonb DEFAULT '{}',
  occurred_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timeline_by_contact
  ON timeline_events(location_id, contact_id, occurred_at DESC);

-- Contact notes (slice 21): free-text notes an operator pins to a contact
-- record. Pinned notes float to the top; within a pin group, newest first.

CREATE TABLE IF NOT EXISTS contact_notes (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id  text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body        text NOT NULL,
  author      text,
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_notes_by_contact
  ON contact_notes(location_id, contact_id, pinned DESC, created_at DESC);

-- Contact tasks (slice 22): an operator to-do attached to a contact. due_at is
-- optional; completed_at NULL means open, a timestamp means done. Two indexes:
-- one for a single contact's task panel, one for the cross-contact worklist.
-- Open tasks sort before done, soonest due first.

CREATE TABLE IF NOT EXISTS contact_tasks (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id   text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title        text NOT NULL,
  body         text,
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_tasks_by_contact
  ON contact_tasks(location_id, contact_id, completed_at, due_at);
CREATE INDEX IF NOT EXISTS contact_tasks_by_location
  ON contact_tasks(location_id, completed_at, due_at);

-- Opportunities (slice 2): pipelines -> ordered stages -> opportunity cards.

CREATE TABLE IF NOT EXISTS pipelines (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipelines_by_location
  ON pipelines(location_id, position);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  pipeline_id text NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stages_by_pipeline
  ON pipeline_stages(location_id, pipeline_id, position);

CREATE TABLE IF NOT EXISTS opportunities (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  pipeline_id text NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id    text NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  contact_id  text REFERENCES contacts(id) ON DELETE SET NULL,
  name        text NOT NULL,
  value_cents bigint DEFAULT 0,
  status      text NOT NULL DEFAULT 'open',
  source      text,
  assignee    text,
  position    int DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opps_by_stage
  ON opportunities(location_id, pipeline_id, stage_id, position);

-- Calendars (slice 3): named calendars -> appointments booked against them.

CREATE TABLE IF NOT EXISTS calendars (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT 'indigo',
  duration_min int NOT NULL DEFAULT 30,
  position     int DEFAULT 0,
  -- Public booking page config. A calendar with booking_enabled + a slug is
  -- reachable at /api/public/booking/:loc/:slug, where a visitor self-schedules
  -- against the weekly `availability` windows (an array of {weekday,start,end}
  -- wall-clock ranges interpreted in `timezone`). slot_interval_min 0 means
  -- "step by duration_min". notice_min is the minimum lead time; rolling_days is
  -- how far ahead the page offers dates.
  booking_enabled   boolean NOT NULL DEFAULT false,
  booking_slug      text,
  timezone          text NOT NULL DEFAULT 'America/New_York',
  slot_interval_min int NOT NULL DEFAULT 0,
  buffer_min        int NOT NULL DEFAULT 0,
  notice_min        int NOT NULL DEFAULT 120,
  rolling_days      int NOT NULL DEFAULT 14,
  availability      jsonb NOT NULL DEFAULT '[]',
  booking_headline  text,
  booking_blurb     text,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendars_by_location
  ON calendars(location_id, position);
-- A booking slug is unique per location (the public lookup is location-scoped).
CREATE UNIQUE INDEX IF NOT EXISTS calendars_booking_slug
  ON calendars(location_id, booking_slug) WHERE booking_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS appointments (
  id            text PRIMARY KEY,
  location_id   text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  calendar_id   text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  contact_id    text REFERENCES contacts(id) ON DELETE SET NULL,
  title         text NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled',
  location_text text,
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointments_by_time
  ON appointments(location_id, starts_at);
-- One LIVE appointment per calendar per exact start instant. This is the
-- database-level guarantee behind the public booking widget's double-book guard:
-- two visitors who race for the same time both pass the in-request slot snapshot
-- (neither has written yet), but only one INSERT can land -- the second fails
-- with a unique violation the route turns into an honest "slot taken". A
-- cancelled appointment frees its slot, so the uniqueness is partial on status.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_no_double_book
  ON appointments(calendar_id, starts_at) WHERE status <> 'cancelled';

-- Marketing (slice 4): one-off SMS/email campaigns -> per-recipient rows.

CREATE TABLE IF NOT EXISTS campaigns (
  id              text PRIMARY KEY,
  location_id     text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  channel         text NOT NULL DEFAULT 'sms',
  subject         text,
  body            text NOT NULL,
  audience_tag    text,
  status          text NOT NULL DEFAULT 'draft',
  recipient_count int NOT NULL DEFAULT 0,
  sent_count      int NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX IF NOT EXISTS campaigns_by_location
  ON campaigns(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id  text REFERENCES contacts(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'sent',
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recipients_by_campaign
  ON campaign_recipients(location_id, campaign_id);

-- Templates (slice 23): the reusable email/SMS message library. Named, channel-
-- typed snippets with merge fields, dropped into campaigns and automation steps.
-- subject is email-only (NULL for SMS). No per-recipient state — these are just
-- saved drafts an operator reaches for.
CREATE TABLE IF NOT EXISTS templates (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  channel     text NOT NULL DEFAULT 'email',
  subject     text,
  body        text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_by_location
  ON templates(location_id, channel, created_at DESC);

-- Automations (slice 5): a workflow has one trigger + an ordered list of action
-- steps. This slice ships the builder/definition only; the runner is next.
CREATE TABLE IF NOT EXISTS workflows (
  id             text PRIMARY KEY,
  location_id    text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name           text NOT NULL,
  trigger_type   text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'draft',
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflows_by_location
  ON workflows(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position    int NOT NULL DEFAULT 0,
  type        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS actions_by_workflow
  ON workflow_actions(location_id, workflow_id, position);

-- One row per workflow enrollment (workflow x contact x trigger occurrence).
-- The runner writes this: it is the honest execution record the UI shows. status
-- moves running -> waiting (paused on a wait step) -> completed | failed. steps is
-- an append-only log of per-action results: [{position,type,status,detail}].
CREATE TABLE IF NOT EXISTS workflow_runs (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  workflow_id  text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id   text REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_type text NOT NULL,
  status       text NOT NULL DEFAULT 'running',
  steps        jsonb NOT NULL DEFAULT '[]',
  started_at   timestamptz DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS runs_by_workflow
  ON workflow_runs(location_id, workflow_id, started_at DESC);

-- Sites & Funnels (slice 8): a funnel is an ordered set of hosted pages (steps).
-- The opt_in step's public form captures a lead -> contact -> contact_created.
CREATE TABLE IF NOT EXISTS funnels (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS funnels_slug
  ON funnels(location_id, slug);

CREATE TABLE IF NOT EXISTS funnel_steps (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  funnel_id   text NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  position    int NOT NULL DEFAULT 0,
  name        text NOT NULL,
  type        text NOT NULL,
  path        text NOT NULL,
  content     jsonb NOT NULL DEFAULT '{}',
  submissions int NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS steps_by_funnel
  ON funnel_steps(location_id, funnel_id, position);

-- Forms & Surveys (slice 9): a standalone, single-page lead-capture form. Unlike
-- a funnel step (which only COUNTS submissions), a form keeps every submission's
-- field values in form_submissions for an operator-facing submissions viewer.
-- `content` holds {headline, subhead, cta, tag, successMessage, fields:[...]}.
CREATE TABLE IF NOT EXISTS forms (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',
  content     jsonb NOT NULL DEFAULT '{}',
  submissions int NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forms_slug
  ON forms(location_id, slug);

CREATE TABLE IF NOT EXISTS form_submissions (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  form_id     text NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  contact_id  text REFERENCES contacts(id) ON DELETE SET NULL,
  values      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_by_form
  ON form_submissions(location_id, form_id, created_at DESC);

-- Payments / Invoices (slice 10): an invoice billed to a contact. Line items live
-- in `items` jsonb ([{description, quantity, unit_amount}], amounts in cents); the
-- total is DERIVED from items in the app, never stored, so it can't drift from the
-- lines. status moves draft -> sent -> paid (or void). Recording a payment is
-- operator bookkeeping (mark-as-paid) — OpenLevel never charges a card or moves
-- money; it only writes down what already happened.
CREATE TABLE IF NOT EXISTS invoices (
  id             text PRIMARY KEY,
  location_id    text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id     text REFERENCES contacts(id) ON DELETE SET NULL,
  number         text NOT NULL,
  status         text NOT NULL DEFAULT 'draft',
  currency       text NOT NULL DEFAULT 'usd',
  items          jsonb NOT NULL DEFAULT '[]',
  notes          text,
  issued_at      timestamptz,
  due_at         timestamptz,
  paid_at        timestamptz,
  payment_method text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number
  ON invoices(location_id, number);
CREATE INDEX IF NOT EXISTS invoices_by_location
  ON invoices(location_id, created_at DESC);

-- Module 48: hosted checkout (pay-by-link). The location connects its OWN
-- Stripe/Square account; we mint a checkout link inside that account and store
-- the processor-side correlation id here so the payment webhook can find the
-- invoice (Stripe round-trips our metadata; Square only gives us its order id).
-- ALTER + IF NOT EXISTS so existing databases upgrade in place — migrate.ts
-- just replays this file.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_provider text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_external_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_url text;
CREATE INDEX IF NOT EXISTS invoices_by_checkout_external
  ON invoices(location_id, checkout_external_id);

-- Reputation / Reviews (slice 11): the review-collection loop. An operator issues
-- a review_request to a contact — a tokenized public link — and the customer opens
-- it and leaves a star rating + comment, captured as a review. The headline
-- average is DERIVED in the app from the real review rows (see review-math.ts),
-- never stored, so the figure can't drift from the reviews that justify it and
-- can't be silently inflated. `rating` is constrained 1–5 at the DB. A review's
-- `status` is moderation only (hide spam/abuse from a future public widget); it
-- does NOT change the true average the operator sees. OpenLevel never writes a
-- fake review — an empty table is an honest zero.
CREATE TABLE IF NOT EXISTS review_requests (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id   text REFERENCES contacts(id) ON DELETE SET NULL,
  channel      text NOT NULL DEFAULT 'sms',
  token        text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  sent_at      timestamptz,
  completed_at timestamptz,
  created_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS review_requests_token
  ON review_requests(token);
CREATE INDEX IF NOT EXISTS review_requests_by_location
  ON review_requests(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id            text PRIMARY KEY,
  location_id   text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id    text REFERENCES contacts(id) ON DELETE SET NULL,
  request_id    text REFERENCES review_requests(id) ON DELETE SET NULL,
  rating        int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          text,
  reviewer_name text,
  source        text NOT NULL DEFAULT 'direct',
  status        text NOT NULL DEFAULT 'published',
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_by_location
  ON reviews(location_id, created_at DESC);

-- Module 51: reviews imported from Google Business Profile / the Facebook Page
-- carry the platform's OWN id so a re-sync updates in place instead of
-- duplicating. Direct reviews keep external_id NULL, so the partial unique
-- index never constrains them. (ALTER + IF NOT EXISTS so existing databases
-- upgrade in place — migrate.ts just replays this file.)
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_external_dedup
  ON reviews(location_id, source, external_id) WHERE external_id IS NOT NULL;

-- Memberships / Courses (slice 12): a course is a published body of lessons a
-- contact is enrolled into and works through. A `lesson` is one ordered unit
-- (text + optional video). An `enrollment` ties a contact to a course and mints a
-- tokenized public link to the course player; a `lesson_completion` is the one
-- honest fact we record — "this enrollee finished this lesson". Progress (the
-- "62% complete" figure) is DERIVED in the app from completions over the course's
-- real lesson count (see course-math.ts), never stored, so it can't drift from
-- what was actually finished and can't be inflated. UNIQUE(enrollment_id,
-- lesson_id) makes "mark complete" idempotent — re-marking never double-counts.
-- An enrollment with no completions is an honest 0%, not a guess.
CREATE TABLE IF NOT EXISTS courses (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  title       text NOT NULL,
  slug        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'draft',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS courses_slug
  ON courses(location_id, slug);
CREATE INDEX IF NOT EXISTS courses_by_location
  ON courses(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lessons (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  course_id   text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position    int NOT NULL DEFAULT 0,
  title       text NOT NULL,
  content     text,
  video_url   text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lessons_by_course
  ON lessons(location_id, course_id, position);

CREATE TABLE IF NOT EXISTS enrollments (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  course_id    text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  contact_id   text REFERENCES contacts(id) ON DELETE SET NULL,
  token        text NOT NULL,
  status       text NOT NULL DEFAULT 'active',
  enrolled_at  timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_token
  ON enrollments(token);
CREATE INDEX IF NOT EXISTS enrollments_by_course
  ON enrollments(location_id, course_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lesson_completions (
  id            text PRIMARY KEY,
  location_id   text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  enrollment_id text NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id     text NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_completions_unique
  ON lesson_completions(enrollment_id, lesson_id);
CREATE INDEX IF NOT EXISTS lesson_completions_by_enrollment
  ON lesson_completions(location_id, enrollment_id);

-- Blog (slice 13): a location's published writing. A post is a draft until the
-- operator publishes it; only published posts are ever served on the public,
-- branded blog. `published_at` is stamped the first time a post goes live and is
-- preserved across unpublish/re-publish, so a post's "posted on" date never lies
-- about when it actually appeared. The "5 min read" shown on a post is NOT stored
-- here — it is DERIVED from the body's real word count in blog-math.ts, so it
-- can't drift from the words it describes and can't be padded. An empty blog is an
-- honest zero. UNIQUE(location_id, slug) keeps the public URL collision-free.
CREATE TABLE IF NOT EXISTS blog_posts (
  id              text PRIMARY KEY,
  location_id     text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  slug            text NOT NULL,
  excerpt         text,
  body            text,
  cover_image_url text,
  author          text,
  status          text NOT NULL DEFAULT 'draft',
  published_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_slug
  ON blog_posts(location_id, slug);
CREATE INDEX IF NOT EXISTS blog_posts_by_location
  ON blog_posts(location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blog_posts_published
  ON blog_posts(location_id, published_at DESC);

-- Trigger Links (slice 14): a location's trackable short links. The operator names
-- a link to a destination URL; OpenLevel hosts a short link that 302-redirects to
-- the destination and records the click. The stats a link shows — total clicks,
-- how many DISTINCT contacts clicked, and when it was last clicked — are NOT stored
-- on the link row: each click is its own row in trigger_link_clicks, and the figures
-- are DERIVED by aggregating those real rows (see TriggerLinksRepo.listWithStats),
-- so a count can never drift from the clicks that justify it and can't be silently
-- inflated. An unclicked link is an honest zero. A click attributed to a contact
-- (the link was opened with ?c=<contactId>) additionally fires the
-- `trigger_link_clicked` workflow trigger, so a real click can start an automation.
-- UNIQUE(location_id, slug) keeps the short URL collision-free.
CREATE TABLE IF NOT EXISTS trigger_links (
  id              text PRIMARY KEY,
  location_id     text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  destination_url text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trigger_links_slug
  ON trigger_links(location_id, slug);
CREATE INDEX IF NOT EXISTS trigger_links_by_location
  ON trigger_links(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trigger_link_clicks (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  link_id     text NOT NULL REFERENCES trigger_links(id) ON DELETE CASCADE,
  contact_id  text REFERENCES contacts(id) ON DELETE SET NULL,
  clicked_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trigger_link_clicks_by_link
  ON trigger_link_clicks(location_id, link_id, clicked_at DESC);

-- Surveys (slice 15): a multi-step lead-capture survey. Like a form it keeps every
-- submission's field values in survey_submissions for an operator-facing viewer,
-- but its `content` holds an ordered `steps:[{id,title,subtitle?,fields:[...]}]` so
-- a visitor answers a few questions at a time behind a progress bar, rather than on
-- one page. The honest `submissions` counter and the stored rows are DERIVED from
-- real completions — an unanswered survey is an honest zero, never a guess. A
-- completed submission additionally fires the `survey_submitted` workflow trigger,
-- so finishing a survey can start an automation. UNIQUE(location_id, slug) keeps the
-- public URL collision-free.
CREATE TABLE IF NOT EXISTS surveys (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',
  content     jsonb NOT NULL DEFAULT '{}',
  submissions int NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS surveys_slug
  ON surveys(location_id, slug);

CREATE TABLE IF NOT EXISTS survey_submissions (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  survey_id   text NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  contact_id  text REFERENCES contacts(id) ON DELETE SET NULL,
  values      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_submissions_by_survey
  ON survey_submissions(location_id, survey_id, created_at DESC);

-- Proposals & estimates (slice 16): a signable sales document billed to a contact.
-- The document body (intro prose, line items, terms) lives in `content` jsonb
-- ({intro, line_items:[{description,quantity,unit_amount}] in cents, terms}); the
-- dollar total is DERIVED from line_items in the app (see proposal-math.ts), never
-- stored, so the amount the client signs for can't drift from the lines that justify
-- it. status moves draft -> sent -> viewed -> signed (or declined). A signature is
-- the one honest fact we capture: the typed signer_name + signed_at, recorded once
-- when the recipient accepts on the public page — OpenLevel never forges one, so an
-- unsigned proposal reads as an honest "awaiting signature". Signing additionally
-- fires the `proposal_signed` workflow trigger, so an accepted proposal can start an
-- automation. UNIQUE(location_id, slug) keeps the public URL collision-free.
CREATE TABLE IF NOT EXISTS proposals (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id  text REFERENCES contacts(id) ON DELETE SET NULL,
  title       text NOT NULL,
  slug        text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',
  currency    text NOT NULL DEFAULT 'usd',
  content     jsonb NOT NULL DEFAULT '{}',
  signer_name text,
  signed_at   timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_slug
  ON proposals(location_id, slug);
CREATE INDEX IF NOT EXISTS proposals_by_location
  ON proposals(location_id, created_at DESC);

-- Communities (slice 17): a location's group space — a Skool/Circle-style
-- community where members post in channels, comment, and like. A community is a
-- draft until the operator publishes it; only a published community is served on
-- the public, branded feed. Everything a community shows — its member count, its
-- post count, and a post's like/comment counts — is NOT stored on any row:
-- members, posts, comments and likes are each their own real rows, and the
-- figures are DERIVED by aggregating them (community-math.ts + repo COUNTs), so a
-- count can never drift from the rows that justify it and can't be padded. An
-- empty community is an honest zero. UNIQUE(location_id, slug) keeps the public
-- URL collision-free; a like is UNIQUE per (post, member) so it can't be double
-- counted.
CREATE TABLE IF NOT EXISTS communities (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'draft',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS communities_slug
  ON communities(location_id, slug);
CREATE INDEX IF NOT EXISTS communities_by_location
  ON communities(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_channels (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  community_id text NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  position     int NOT NULL DEFAULT 0,
  name         text NOT NULL,
  slug         text NOT NULL,
  created_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_channels_slug
  ON community_channels(community_id, slug);
CREATE INDEX IF NOT EXISTS community_channels_by_community
  ON community_channels(location_id, community_id, position);

CREATE TABLE IF NOT EXISTS community_members (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  community_id text NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  contact_id   text REFERENCES contacts(id) ON DELETE SET NULL,
  name         text NOT NULL,
  email        text,
  role         text NOT NULL DEFAULT 'member',
  joined_at    timestamptz DEFAULT now(),
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_members_by_community
  ON community_members(location_id, community_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS community_posts (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  community_id text NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel_id   text NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  member_id    text REFERENCES community_members(id) ON DELETE SET NULL,
  title        text,
  body         text NOT NULL,
  pinned       boolean NOT NULL DEFAULT false,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_posts_by_channel
  ON community_posts(location_id, channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_posts_by_community
  ON community_posts(location_id, community_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_comments (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  post_id     text NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  member_id   text REFERENCES community_members(id) ON DELETE SET NULL,
  body        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_comments_by_post
  ON community_comments(location_id, post_id, created_at);

CREATE TABLE IF NOT EXISTS community_post_likes (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  post_id     text NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  member_id   text NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_post_likes_unique
  ON community_post_likes(post_id, member_id);
CREATE INDEX IF NOT EXISTS community_post_likes_by_post
  ON community_post_likes(location_id, post_id);

-- ── Social Planner ──────────────────────────────────────────────────────────
-- Plan, schedule and publish social posts through the LOCATION's own platform
-- credentials (page token, IG account, LinkedIn author, X token — resolved by
-- name from the vault, never stored here). `connected` stays honest: it flips
-- true only when the resolver actually builds a working publisher. A post
-- composes once and fans out to many accounts via social_post_targets; each
-- target records its REAL outcome (published with the provider's post id, or
-- failed with the reason). No reach or engagement is ever stored — OpenLevel
-- never fabricates an analytics surface.
CREATE TABLE IF NOT EXISTS social_accounts (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  platform    text NOT NULL,
  handle      text NOT NULL,
  connected   boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_accounts_by_location
  ON social_accounts(location_id, created_at);

CREATE TABLE IF NOT EXISTS social_posts (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_posts_by_location
  ON social_posts(location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_posts_by_schedule
  ON social_posts(location_id, status, scheduled_at);
-- Hosted image attached to the post (IG requires one; FB posts it as a photo).
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS media_url text;

CREATE TABLE IF NOT EXISTS social_post_targets (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  post_id     text NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  account_id  text NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_post_targets_unique
  ON social_post_targets(post_id, account_id);
CREATE INDEX IF NOT EXISTS social_post_targets_by_post
  ON social_post_targets(location_id, post_id);
-- Per-channel REAL outcome of a publish: 'published' | 'failed', the honest
-- failure reason, and the provider's id for the live post.
ALTER TABLE social_post_targets ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE social_post_targets ADD COLUMN IF NOT EXISTS detail text;
ALTER TABLE social_post_targets ADD COLUMN IF NOT EXISTS external_id text;

-- ── Affiliate Manager ───────────────────────────────────────────────────────
-- A referral program: affiliates promote the business with a personal referral
-- link and earn a commission on the sales they drive. The mechanics reuse the
-- trigger-link pattern — each affiliate's link 302-redirects to the program's
-- landing URL and records an open in affiliate_clicks. A sale an affiliate drove
-- is an affiliate_referrals row carrying the sale amount (cents) and the
-- commission (cents) LOCKED at the program's rate the moment it is recorded, so
-- what is owed can never drift if the rate later changes. Every figure the
-- manager shows — clicks, referrals, sales volume, commission earned/paid/owed —
-- is DERIVED by aggregating these real rows (affiliate-math.ts / correlated
-- COUNTs), never a stored counter, so a total can't be inflated and a brand-new
-- affiliate is an honest zero. Marking a referral PAID is operator bookkeeping:
-- OpenLevel records that a payout happened and never moves money itself. Money
-- is integer cents throughout. UNIQUE(location_id, code) keeps every referral URL
-- collision-free within a location.
CREATE TABLE IF NOT EXISTS affiliate_programs (
  id               text PRIMARY KEY,
  location_id      text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  commission_type  text NOT NULL DEFAULT 'percent',
  commission_value numeric NOT NULL DEFAULT 0,
  landing_url      text NOT NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_programs_by_location
  ON affiliate_programs(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS affiliates (
  id          text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  program_id  text NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  contact_id  text REFERENCES contacts(id) ON DELETE SET NULL,
  name        text NOT NULL,
  email       text,
  code        text NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliates_code_unique
  ON affiliates(location_id, code);
CREATE INDEX IF NOT EXISTS affiliates_by_program
  ON affiliates(location_id, program_id, created_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id           text PRIMARY KEY,
  location_id  text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  affiliate_id text NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  contact_id   text REFERENCES contacts(id) ON DELETE SET NULL,
  clicked_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_clicks_by_affiliate
  ON affiliate_clicks(location_id, affiliate_id, clicked_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_referrals (
  id               text PRIMARY KEY,
  location_id      text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  affiliate_id     text NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  contact_id       text REFERENCES contacts(id) ON DELETE SET NULL,
  description      text,
  amount_cents     bigint NOT NULL DEFAULT 0,
  commission_cents bigint NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending',
  occurred_at      timestamptz DEFAULT now(),
  paid_at          timestamptz,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_referrals_by_affiliate
  ON affiliate_referrals(location_id, affiliate_id, occurred_at DESC);

-- ── Products catalog (GHL Payments -> Products) ──────────────────────────────
-- A reusable catalog of the products and services a location sells, so invoices
-- and proposals can be built from saved items instead of retyping a price every
-- time. `price_cents` is the default price in integer cents (money is always
-- cents here); `currency` defaults usd. A product is either a one_time charge or
-- a recurring subscription — when recurring, `recurring_interval` (day|week|
-- month|year) sets the billing period, and it is NULL for a one_time product.
-- `status` is active or archived: archiving retires a product from the picker
-- without deleting it, and because an invoice or proposal copies the line's text
-- and amount at the moment it is built, deleting a product never alters a
-- document already created from it. Catalog order is the operator's chosen
-- `position`; an empty catalog is an honest zero.
CREATE TABLE IF NOT EXISTS products (
  id                 text PRIMARY KEY,
  location_id        text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name               text NOT NULL,
  description        text,
  price_cents        bigint NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'usd',
  type               text NOT NULL DEFAULT 'one_time',
  recurring_interval text,
  status             text NOT NULL DEFAULT 'active',
  position           int NOT NULL DEFAULT 0,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_by_location
  ON products(location_id, position, created_at);

-- Payments / Subscriptions (slice 30): a recurring commitment a contact is on —
-- GHL "Payments -> Subscriptions". This is a bookkeeping ledger, NOT a biller:
-- OpenLevel never charges a card or moves money, it only records that a recurring
-- arrangement exists and computes its schedule and MRR. `name`, `amount_cents`,
-- `currency` and `billing_interval` are SNAPSHOT off the product at create time
-- (the column is `billing_interval`, never the reserved word `interval`), so
-- renaming, repricing or deleting that product later never disturbs a live
-- subscription. `status` moves active -> paused -> active or -> canceled;
-- `canceled_at` is stamped only while canceled and cleared on reactivation, so a
-- live row never carries a cancel date. The next renewal date and MRR are DERIVED
-- in the app (see subscription-math.ts), never stored, so a figure shown can't
-- drift from the row that justifies it. An empty book is an honest zero.
CREATE TABLE IF NOT EXISTS subscriptions (
  id               text PRIMARY KEY,
  location_id      text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id       text REFERENCES contacts(id) ON DELETE SET NULL,
  product_id       text REFERENCES products(id) ON DELETE SET NULL,
  name             text NOT NULL,
  amount_cents     bigint NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT 'usd',
  billing_interval text NOT NULL DEFAULT 'month',
  status           text NOT NULL DEFAULT 'active',
  started_at       timestamptz NOT NULL DEFAULT now(),
  canceled_at      timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_by_location
  ON subscriptions(location_id, created_at DESC);

-- Payments / Coupons (slice 31): a reusable discount DEFINITION — GHL "Payments
-- -> Coupons". This is bookkeeping, NOT a biller: a coupon never charges a card,
-- it only describes a discount that a later module can apply to an invoice's
-- recorded total. `code` is what a customer types and is unique per location,
-- stored already normalised (whitespace stripped, upper-cased) so a lookup is
-- case-insensitive and two coupons can't collide on casing. `discount_type` is
-- percent or fixed: for percent, `discount_value` is whole percent (1..100); for
-- fixed it is an integer cent amount. `max_redemptions` caps how many times the
-- coupon may be applied (NULL = unlimited) and `times_redeemed` is the honest
-- running counter, only ever moved by a real redemption. `expires_at` is an
-- optional cutoff (NULL = never expires). `status` is active or archived:
-- archiving retires a code from use without deleting its history. Whether a
-- coupon is actually redeemable right now is DERIVED in coupon-math.ts from
-- status + expiry + cap, never stored, so it can't drift. An empty book is an
-- honest zero.
CREATE TABLE IF NOT EXISTS coupons (
  id              text PRIMARY KEY,
  location_id     text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  description     text,
  discount_type   text NOT NULL DEFAULT 'percent',
  discount_value  bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'active',
  max_redemptions int,
  times_redeemed  int NOT NULL DEFAULT 0,
  expires_at      timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_per_location
  ON coupons(location_id, code);
CREATE INDEX IF NOT EXISTS coupons_by_location
  ON coupons(location_id, created_at DESC);

-- Module 52: the call log. Rows arrive two ways — `create` when this app
-- places an outbound call through the location's own voice provider (Twilio
-- bridge call or Vapi AI call), and the provider's status webhooks, which
-- upsert by (location_id, provider, external_id) so a re-delivered or
-- out-of-order event updates in place instead of duplicating. Calls the
-- provider reports that we never placed (e.g. a Vapi inbound call) insert
-- honestly. duration/transcript/summary/recording are exactly what the
-- provider said happened — never invented here. An empty log is an honest
-- zero.
CREATE TABLE IF NOT EXISTS calls (
  id               text PRIMARY KEY,
  location_id      text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  contact_id       text REFERENCES contacts(id) ON DELETE SET NULL,
  direction        text NOT NULL DEFAULT 'outbound',
  from_number      text,
  to_number        text,
  status           text NOT NULL DEFAULT 'queued',
  duration_seconds int,
  recording_url    text,
  transcript       text,
  summary          text,
  provider         text NOT NULL,
  external_id      text,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calls_by_location
  ON calls(location_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS calls_external_dedup
  ON calls(location_id, provider, external_id) WHERE external_id IS NOT NULL;

-- Mobile App Push Tokens (slice 53): Stores device push tokens for Expo notifications
CREATE TABLE IF NOT EXISTS push_tokens (
  id          text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token       text NOT NULL,
  platform    text, -- 'ios' | 'android' | 'web'
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_unique
  ON push_tokens(token);
CREATE INDEX IF NOT EXISTS push_tokens_by_operator
  ON push_tokens(operator_id);
