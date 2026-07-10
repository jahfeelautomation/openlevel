# OpenLevel — local run (no Docker)

OpenLevel is the self-hosted GoHighLevel replacement: a multi-tenant operator
workbench. This doc gets the whole thing running on a laptop with **no Docker,
no Postgres, no network** — so you can see the UI and walk the
login → inbox → thread → AI-draft flow end to end.

## How the offline run works

- **Database:** `server/dev-server.ts` boots an in-process Postgres
  (`@electric-sql/pglite`, WASM, in-memory). The real `db/schema.sql` is applied
  verbatim, so the dev DB is schema-identical to production Postgres — only the
  driver differs (`PgliteDatabase` vs `PgDatabase`, both behind the same
  `Database` interface).
- **Seed:** `db/seed.ts` creates one sub-account (`Alex — Cash Offers`), one
  operator login, a Chatwoot channel link, and three conversations with message
  history. Idempotent — re-running is a no-op if any location exists.
- **AI + Chatwoot are stubbed in dev:** the dev server injects a canned Claude
  draft and a no-op Chatwoot sender, plus dummy per-client secrets, so nothing
  reaches a real API. The production path (`createAnthropicClient`,
  `sendChatwootMessage`, Vaultwarden-backed secrets) is unchanged — see
  `server/index.ts`.

> The in-memory DB resets every time `dev:local` restarts. That's intended for
> dev/screenshots. For a persistent local DB, run `npm run migrate && npm run
> seed` against a real Postgres and use `npm run dev:server` instead.

## Run it

Two terminals, from `projects/openlevel/`:

```bash
npm install            # first time only
npm run dev:local      # backend  -> http://localhost:8790  (pglite + seed)
npm run dev            # frontend -> http://localhost:5273  (Vite, proxies /api)
```

Open **http://localhost:5273** and sign in:

| Field | Value |
|---|---|
| Email | `admin@acmecorp.com` |
| Password | `openlevel` |

## What you can do

1. **Conversations** (lands here) — three-pane inbox: conversation list, the
   selected thread + composer, and a contact side-panel. Open *Taylor Reed* to
   see an inbound + an outbound message.
2. **Draft from agent** — in an open thread, click it. The approve-first AI
   reply lands in the composer for you to edit and send (read-only — it persists
   nothing until you hit Send). In dev this is the stubbed draft; in prod it
   calls the client's own Anthropic key on Haiku (D-44).
3. **Contacts** — searchable list, contact profile, activity timeline.
4. **Sub-account switcher** (top-left) — the tenant scope every page reads from.
   Modules tagged **SOON** are the GHL roadmap (pipelines, calendars, marketing,
   automations, sites/funnels, reporting), not yet built.

## Tests, typecheck, screenshots

```bash
npm test               # vitest (co-located *.test.ts)
npm run typecheck      # tsc --noEmit
npm run shoot          # headless-Chrome screenshots -> .claude/screenshots/
```

`npm run shoot` (`scripts/shoot.mjs`) drives the installed Chrome through the
real login flow and writes `openlevel-{login,inbox,thread,ai-draft,contacts}-<date>.png`.
It needs both dev servers running and Chrome at the default Windows install path
(edit `CHROME` in the script otherwise). This is the repeatable artifact for the
"no screenshots, no commit" rule.


