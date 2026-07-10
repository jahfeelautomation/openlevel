# OpenLevel Automations (Workflow Builder) — Design

**Slice 5.** A GHL-style workflow builder: each workflow has one **trigger** and an
ordered list of **action steps**, shown as a vertical flow (trigger node →
connectors → step nodes → "Add step"). This slice ships the **builder** — define,
edit, and toggle workflows. The **execution engine** that actually fires them on
real events is the next slice (5-runner); this slice does not pretend workflows
are running, so it shows **no enrollment/run stats** — only the definition and a
Draft/Live status.

## Why split builder from runner

GHL's builder and its run analytics are separate surfaces. Building the
definition layer first gives an honest, screenshot-able, fully-tested module
without claiming execution we haven't wired. "We never lie in user-facing copy"
(CLAUDE.md): a Draft/Live badge is a status, not a claim that anything fired.

## Data model (`db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS workflows (
  id text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',   -- 'draft' | 'live'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflows_by_location ON workflows(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS actions_by_workflow ON workflow_actions(location_id, workflow_id, position);
```

## Vocabulary (shared, in `server/lib/automation-vocab.ts` + mirrored in web)

**Triggers** (what starts a workflow):
- `contact_created` — "New contact created"
- `inbound_message` — "Inbound message received"
- `appointment_booked` — "Appointment booked"
- `opportunity_created` — "Opportunity created"

**Actions** (what a step does):
- `send_sms` — config `{ body }`
- `send_email` — config `{ subject, body }`
- `add_tag` — config `{ tag }`
- `wait` — config `{ minutes }`

The server keeps these as plain string columns (no enum migration churn); the
route validates `trigger_type`/`type` against the vocab arrays with Zod.

## Repos

`WorkflowsRepo extends LocationScopedRepo`:
- `list()` → `scopedSelect('SELECT * FROM workflows ORDER BY created_at DESC')`
- `get(id)` → `scopedSelect('… WHERE id=$2', [id])[0]`
- `create({ name, triggerType, triggerConfig? })` → `scopedWrite` INSERT
  (id, location_id, name, trigger_type, trigger_config) → returns row (status defaults 'draft')
- `update(id, { name?, status?, triggerType?, triggerConfig? })` → dynamic SET of
  only the provided columns + `updated_at=now()`, `WHERE location_id=$1 AND id=$last`.
  Returns the updated row or undefined (→ 404).

`WorkflowActionsRepo extends LocationScopedRepo`:
- `listByWorkflow(workflowId)` → `scopedSelect('… WHERE workflow_id=$2 ORDER BY position', [workflowId])`
- `replaceAll(workflowId, actions)` → delete existing for that workflow, then a
  single multi-row insert (same `($n,$1,$2,…)` pattern as CampaignRecipientsRepo,
  reusing $1=location, $2=workflow). Empty list = just the delete. Returns inserted rows.

`replaceAll` models the builder's "Save steps" as one atomic swap — simplest
honest model for an ordered list edited client-side.

## Route `server/routes/workflows.ts` → `/api/loc/:loc/workflows`

- `GET /` → `{ workflows }`
- `GET /:id` → `{ workflow, actions }`; 404 if workflow missing
- `POST /` (Zod: name≥1, triggerType ∈ TRIGGERS, triggerConfig? object) → 201 `{ workflow }`
- `PATCH /:id` (Zod: name?, status ∈ {draft,live}?, triggerType?, triggerConfig?) →
  `{ workflow }`; 404 if missing; 400 if body empty
- `PUT /:id/actions` (Zod: `{ actions: Array<{ type ∈ ACTIONS, config? object }> }`) →
  loads workflow first (404 if missing), `replaceAll`, returns `{ actions }`

Mounted alongside the others in `index.ts`, behind `operatorAuth` + `locationAccess`.

## UI

`src/features/automations/AutomationsPage.tsx` — two-pane (mirrors Calendars):
- **Left rail:** "New workflow" + a scroll list of workflow rows (name, trigger
  label, "N steps", Draft/Live pill). Selecting one loads its builder.
- **Main:** the **builder** for the selected workflow:
  - Header: editable-looking name, Draft/Live **toggle** (PATCH status), step count.
  - **Vertical flow:** a **TriggerNode** card ("When: <trigger label>") → vertical
    connector line → one **StepNode** per action (icon, type label, one-line config
    summary, remove ✕) → "Add step" button. Connectors are simple 2px slate lines
    centered under each node for the GHL canvas feel.
  - Edits to the step list are local; a **Save steps** button PUTs `/actions`.
    Adding a step opens **AddStepDialog**.
- Empty state when no workflow selected / none exist.

`NewWorkflowDialog` — name + trigger `<select>` → POST, then select the new one.
`AddStepDialog` — action-type `<select>` that swaps the config fields
(send_sms: body textarea; send_email: subject + body; add_tag: tag input;
wait: minutes number). Returns the new step to the builder (appended locally).

`src/lib/api.ts` — `Workflow`, `WorkflowAction`, `NewWorkflow`, `WorkflowActionInput`,
`TriggerType`, `ActionType` + endpoints `workflows`, `workflow`, `createWorkflow`,
`updateWorkflow`, `replaceWorkflowActions`.

`App.tsx` — `<Route path="automations">`; `AppShell.tsx` — drop `soon` from
the Automations nav item.

## Seed (`db/seed.ts`)

Two workflows on `loc_jamal`:
1. **"New lead welcome"** — trigger `contact_created`, status **live**, steps:
   `add_tag {tag:'lead'}` → `send_sms {body:'Hi {{first_name}}, thanks for reaching out — I'll be in touch shortly about your property.'}`
2. **"Appointment confirmation"** — trigger `appointment_booked`, status **draft**, steps:
   `send_sms {body:'You're booked! See you then — reply here if anything changes.'}`

## Testing

- `workflows-repo.test.ts` — list/get scoping; create sets location $1 + draft default;
  update builds dynamic SET with only provided cols (params order); update no-op guard.
- `workflow-actions-repo.test.ts` — replaceAll issues a delete then a multi-row
  insert reusing $1/$2 (assert the value groups + params); empty list = delete only;
  listByWorkflow scoping.
- `workflows.test.ts` — GET / scoped; POST 201 + invalid trigger 400 + empty name 400;
  GET /:id 200 + 404; PATCH status 200 + invalid status 400 + empty body 400 + 404;
  PUT /:id/actions replaces (200) + invalid action type 400 + 404 missing workflow.

## Out of scope (this slice)

Execution/runner (next slice), branching/conditions, drag-reorder (steps append +
remove only this slice), wait scheduling semantics (stored, not yet scheduled),
analytics/run history, templates. The vocab is intentionally small but real.
