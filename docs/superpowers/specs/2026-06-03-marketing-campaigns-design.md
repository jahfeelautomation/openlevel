# OpenLevel Slice 4 — Marketing (Campaigns) Design

**Goal:** A GHL-style Marketing module: compose a one-off SMS/email campaign to an
audience (all contacts or a tag segment), send it, and see per-campaign status +
recipient/sent counts. Built end-to-end (schema → repos → route → UI), TDD,
multi-tenant, same polish bar as Conversations/Opportunities/Calendars.

## Data model (append to `db/schema.sql`)

```sql
CREATE TABLE campaigns (
  id text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'sms',          -- 'sms' | 'email'
  subject text,                                 -- email only
  body text NOT NULL,                           -- supports {{first_name}} / {{name}} merge fields
  audience_tag text,                            -- null = all contacts; else contacts carrying this tag
  status text NOT NULL DEFAULT 'draft',         -- 'draft' | 'sent'
  recipient_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX campaigns_by_location ON campaigns(location_id, created_at DESC);

CREATE TABLE campaign_recipients (
  id text PRIMARY KEY,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'sent',          -- 'sent' | 'failed'
  created_at timestamptz DEFAULT now()
);
CREATE INDEX recipients_by_campaign ON campaign_recipients(location_id, campaign_id);
```

## Repos

- `CampaignsRepo` (LocationScopedRepo): `list()`, `get(id)`, `create(input)`
  (draft), `markSent(id, recipientCount, sentCount)`.
- `CampaignRecipientsRepo`: `bulkInsert(campaignId, contactIds)` — one multi-row
  INSERT, status 'sent'; `listByCampaign(campaignId)`.
- `ContactsRepo.listByTag(tag)` — `WHERE $2 = ANY(tags)` (pg text[] membership).

## Route (`/api/loc/:loc/campaigns`, behind operatorAuth + locationAccess)

- `GET /` → `{ campaigns }` (newest first).
- `GET /:id` → `{ campaign, recipients }` (404 if not in location).
- `POST /` (zValidator) → create draft → 201 `{ campaign }`. Schema: name min1,
  channel enum, subject nullable, body min1, audienceTag nullable.
- `POST /:id/send` → load campaign (404 if missing); resolve audience
  (audience_tag ? listByTag : list); 400 if no recipients; bulkInsert recipients;
  markSent(id, n, n); return `{ ok, campaign }`. Dev has no carrier, so "send" =
  record recipients + flip status (honest for a self-hosted dev build, mirrors the
  stubbed Chatwoot sender). Real carrier delivery is out-of-scope this slice.

## UI (`src/features/marketing/`)

- `MarketingPage`: header (count + "New campaign"); card/list of campaigns, each
  showing name, channel badge (SMS/Email), status badge (Draft amber / Sent
  green), audience label ("All contacts" or "#tag"), "x of y sent", relative
  created time. Draft rows show a **Send** button (confirm → POST send → reload).
  Empty state.
- `NewCampaignDialog`: name; channel toggle (SMS/Email); subject (email only);
  body textarea with a merge-field hint ({{first_name}}); audience select
  (All contacts + each known tag) with a live "Will send to N contacts" preview
  computed from loaded contacts. On create → draft appears in the list.
- api client: `campaigns(loc)`, `campaign(loc,id)`, `createCampaign`, `sendCampaign`.
- Route `marketing` in App.tsx; flip `/marketing` nav live in AppShell.

## Seed

Two demo campaigns on the Jamal tenant: one **sent** ("May cash-offer blast", SMS,
all contacts, 3/3) and one **draft** ("Spring seller check-in", email, tag
`seller`). Tag a couple of seed contacts `seller` so audience filtering shows real
numbers.

## Out of scope (future slices)

Scheduled/recurring sends, real carrier/email delivery, drip sequences
(that's Automations), open/click tracking, per-recipient timeline events,
unsubscribe handling.
