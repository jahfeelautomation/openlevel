# OpenLevel — Opportunities (slice 2) design

**Goal:** GHL-grade Opportunities: pipelines with ordered stages and a kanban
board of opportunity cards you can drag between stages, scoped per location.

**Why:** Opportunities/pipelines are GHL's core CRM surface — the thing JF and
clients use to track deals (cash offers, jobs) from lead to won/lost.

## Scope (this slice)

In:
- **Pipelines** — a location has ≥1 pipeline, each with ordered stages. Seeded
  with a sensible default; no pipeline-builder UI yet (stages are seed/API-defined).
- **Opportunities** — card with: name, contact (optional FK), pipeline, stage,
  monetary value (cents), status (`open`/`won`/`lost`/`abandoned`), source,
  assignee, timestamps. CRUD: create, list-by-pipeline, move stage, set status,
  update fields.
- **Kanban board UI** — columns = stages; cards = open opportunities; native
  HTML5 drag-drop to move a card to another stage (persists via API); per-column
  count + summed value; pipeline switcher; "Add opportunity" dialog; won/lost
  shown as muted.

Out (YAGNI / later slices): pipeline CRUD UI, automations on stage-change,
custom fields on opportunities, forecasting/reporting, bulk actions.

## Data (additive to `db/schema.sql`, all `location_id`-scoped)

- `pipelines(id, location_id, name, position, created_at)`
- `pipeline_stages(id, location_id, pipeline_id, name, position, created_at)`
- `opportunities(id, location_id, pipeline_id, stage_id, contact_id, name,
  value_cents int default 0, status text default 'open', source, assignee,
  created_at, updated_at)` + index on `(location_id, pipeline_id, stage_id)`.

## Server (follow slice-1 patterns exactly)

- `repos/pipelines-repo.ts` — `LocationScopedRepo`. `listWithStages()` returns
  pipelines each with their ordered stages; `get(id)`.
- `repos/opportunities-repo.ts` — `LocationScopedRepo`. `listByPipeline(pid)`,
  `create(input)`, `move(id, stageId)`, `setStatus(id, status)`, `update(id, patch)`,
  `get(id)`. Writes set `location_id` explicitly; reads use `scopedSelect`.
- `routes/opportunities.ts` — mounted at `/api/loc/:loc/opportunities` behind
  `operatorAuth` + `locationAccess`. `GET /pipelines` (pipelines+stages),
  `GET /?pipelineId=` (opportunities for a pipeline), `POST /` (create),
  `PATCH /:id` (move/status/fields), `GET /:id`.
- Mount in `server/index.ts`. Seed a default pipeline ("Cash Offer Pipeline":
  New Lead → Contacted → Offer Made → Under Contract → Won/Lost) + 3 demo
  opportunities tied to the existing seed contacts in `db/seed.ts`.

## Frontend

- `lib/api.ts` — `Pipeline`, `Stage`, `Opportunity` types + endpoints
  (`pipelines`, `opportunities`, `createOpportunity`, `moveOpportunity`,
  `setOpportunityStatus`).
- `features/opportunities/OpportunitiesPage.tsx` — board orchestrator (pipeline
  switcher, columns, DnD, value sums, Add dialog).
- `features/opportunities/OpportunityCard.tsx` — draggable card (name, contact,
  value, status pill).
- `features/opportunities/NewOpportunityDialog.tsx` — create form.
- `App.tsx` route `opportunities`; flip `/opportunities` nav item live (drop `soon`).

## Testing

Co-located `*.test.ts` with `FakeDatabase` for repos/routes (assert tenancy:
`location_id` first param on every query; move/create set it explicitly). Verify
the board live with `npm run shoot` (add an `opportunities` shot) before commit.
