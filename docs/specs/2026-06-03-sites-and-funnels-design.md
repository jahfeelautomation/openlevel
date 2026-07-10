# Sites & Funnels — Design (OpenLevel Slice 8)

**Goal:** GHL-parity funnel / landing-page builder. A funnel is an ordered
sequence of hosted pages (steps). The opt-in step captures a lead through a
**public** form that creates/links a contact and fires the `contact_created`
workflow trigger — closing the capture → automation loop the runner (Slice 7)
made real.

**Scope (YAGNI).** NOT a drag-drop pixel editor. Each step is a *structured*
page rendered from a `content` jsonb blob (headline, subhead, form fields, CTA,
body). No custom domains — pages are served under `/api/public/f/:loc/:slug/:path`.
No A/B split. No analytics beyond a real submission count (honest: we never show
a conversion rate we didn't measure).

## Data

```
funnels(
  id, location_id, name, slug, status('draft'|'published'),
  created_at, updated_at
)  UNIQUE(location_id, slug)

funnel_steps(
  id, location_id, funnel_id, position,
  name, type('opt_in'|'thank_you'|'sales'), path,
  content jsonb,            -- {headline, subhead, body, cta, fields:[{name,label,type,required}], tag}
  submissions int,          -- real counter, bumped on each public submit
  created_at
)  INDEX(location_id, funnel_id, position)
```

A step's `content.fields` drive both the rendered form and submit validation.
`content.tag` (optional) is applied to the contact on capture. Only `opt_in`
steps accept submissions.

## Repos (tenancy-guarded, TDD)

- **FunnelsRepo**: `list`, `get(id)`, `getBySlug(slug)`, `create({name,slug,status?})`,
  `update(id,{name?,slug?})`, `setStatus(id,status)`.
- **FunnelStepsRepo**: `listByFunnel(funnelId)`, `get(id)`, `getByPath(funnelId,path)`,
  `create({funnelId,name,type,path,content,position})`, `update(id,patch)`,
  `incrementSubmissions(id)`.

`getBySlug` / `getByPath` use `scopedSelect` so they stay location-bound even on
the public path (the route passes the URL `:loc`).

## Routes

**Operator (behind operatorAuth + locationAccess)** — `/api/loc/:loc/funnels`:
- `GET /` → funnels list (each with step count)
- `GET /:id` → funnel + ordered steps
- `POST /` → create funnel (auto-seeds an opt-in + thank-you step)
- `PATCH /:id` → rename / change slug / publish-unpublish
- `POST /:id/steps` → add step
- `PATCH /:id/steps/:stepId` → edit step content
- `GET /:id/steps/:stepId/submissions` *(not needed v1 — count is on the step)*

**Public (NO auth, mounted before the `/api/loc` auth boundary)** —
`/api/public/f`:
- `GET /:loc/:slug` → published funnel + steps (404 if missing/unpublished) — feeds preview + future hosting
- `POST /:loc/:slug/:path/submit` → validate required fields → `ContactsRepo.upsertByMatch({name,phone,email}, 'funnel:<slug>')` → `addTag` if `content.tag` → `incrementSubmissions` → timeline event → `dispatch({contact_created})` → `{ ok, contactId, next }` where `next` = path of the following step.

The public submit is the only unauthenticated write in the app; it is
deliberately narrow (one contact upsert + one tag + one event) and never trusts
a field the step didn't declare.

## UI (replaces the `soon` nav stub at `/sites`)

`SitesPage`: three-pane, GHL polish bar.
- **Left**: funnel list (name, status pill, step count). "New funnel" button.
- **Center**: the selected funnel's steps as a vertical flow (icon per type,
  path, submission count), each selectable; "Add step".
- **Right**: step editor (headline / subhead / CTA / fields) **and** a live,
  device-framed preview that renders exactly what the public page renders.

## Seed

"Sell your house fast" funnel, **published**, slug `sell-fast`, 2 steps:
1. `opt_in` path `get-offer` — headline "Sell your house fast — no repairs, no fees",
   fields full_name/email/phone, CTA "Get my cash offer", tag `lead`.
2. `thank_you` path `thanks` — "You're in. We'll text you a cash offer shortly."

Because the seed welcome workflow triggers on `contact_created`, submitting the
seeded funnel in dev runs that workflow for real (tag + SMS logged).

## Honesty

- Submission count is a real DB counter, never invented.
- Preview renders the same component the public page renders — no mock copy.
- No conversion %, no fake visitor numbers.
