# OpenLevel per-state legal texting-hours — Design

**Date:** 2026-06-19
**Status:** Approved by Admin ("you're good to proceed"). Advisor-reviewed.

## Problem (plain English)

The text-send rail already blocks texts outside 8am–9pm, but it only knows ONE
clock: the gateway's own (Arizona / America/Phoenix). Admin's leads are in
**Arizona** and **North Carolina**. North Carolina is Eastern time, 2–3 hours
ahead of Arizona. So a text fired at 9:30pm North-Carolina-time (illegal, past
the 9pm cutoff) reads as only 6:30pm in Arizona and would sail through a
Phoenix-only check. The legal window MUST be computed in the *contact's* state
clock, not the gateway's.

## Verified legal facts

Federal TCPA floor: **8:00am–9:00pm local** at the called party, upper bound
exclusive. States may be stricter; both of Admin's are exactly the floor.

| State | Hours (local) | IANA timezone | DST | Source |
|---|---|---|---|---|
| Arizona (AZ) | 8am–9pm | America/Phoenix | no | AZ AG / state telemarketing compliance |
| North Carolina (NC) | 8am–9pm | America/New_York | yes | N.C. Gen. Stat. § 75-102 |

Both share 8–9pm; only the timezone differs. **Not legal advice** — the hours
table is best-effort; Admin / a compliance person should confirm, especially
before adding any new state.

## Locked architecture (advisor-reviewed)

1. **The gateway is the legal authority.** The window decision lives where the
   send actually happens (`nerve-survey` gateway `POST /text/send`), NOT
   duplicated in OpenLevel. OpenLevel passes the contact's `state`; the gateway
   computes the window and is the final, single gate. (No second engine — avoids
   drift where the two could disagree.)
2. **Block on unknown state.** If `state` is blank or not a pinned state, the
   gateway REFUSES with a new reason `unknown_state`. It does NOT assume Arizona.
   (Arizona is the latest-evening mainland zone; assuming it for an unknown
   contact is exactly what would let a too-late North Carolina text through.)
3. **Pinned states only, v1.** AZ + NC, with verified timezone + hours. Any
   other or blank state is blocked with an honest "set the state first" message.
   Adding a state later is a one-line table edit. We do NOT claim 50-state
   coverage we have not verified.
4. **DST-aware, IANA timezones.** The local hour is computed via
   `Intl.DateTimeFormat({ timeZone })` — never hardcoded UTC offsets, which would
   silently break North Carolina across daylight-saving.

## Data flow

`contact.state` (2-letter) → OpenLevel send path → rail payload
`{ e164, body, nonce, state }` → gateway `POST /text/send` →
`legalTextWindow(state, now)` → allow / `outside_window` / `unknown_state` →
OpenLevel renders honest operator copy.

## Engine contract

```ts
export type WindowReason = 'inside' | 'outside_window' | 'unknown_state'
export interface LegalTextWindow {
  allowed: boolean
  reason: WindowReason
  state: string        // normalized uppercase 2-letter, or '' if unparseable
  tz: string | null    // IANA timezone if the state is pinned, else null
}
export function legalTextWindow(state: string | null | undefined, now: Date): LegalTextWindow
```

Normalize: trim + uppercase; accept the 2-letter code and the full state name
("ARIZONA"→AZ, "NORTH CAROLINA"→NC) as a safety net for lead data. Unknown →
`{ allowed:false, reason:'unknown_state', state:'', tz:null }`.

## File map

GATEWAY (`.claude/worktrees/nerve-survey`):
- NEW `server/lib/legal-text-window.ts` (+ `.test.ts`) — the pure engine.
- MOD `server/routes/text-send.ts` — parse `state`, call engine, add
  `unknown_state` to `SendTextResult`.
- MOD `server/routes/text-send.test.ts` — `state` in payloads + per-state tests.

OPENLEVEL (`projects/openlevel`):
- MOD `db/schema.sql` — idempotent `ALTER TABLE contacts ADD COLUMN state text`.
- MOD `server/repos/contacts-repo.ts` (+ test) — `state` on `Contact`;
  `setState`; carry `state` through `upsertByMatch` for future auto-fill.
- MOD `server/routes/contacts.ts` (+ test) — `PUT /:id/state`.
- MOD `server/lib/send-text-rail.ts` (+ test) — include `state` in the payload;
  add `unknown_state` to `KNOWN_REASONS`.
- MOD the send path (operator-tools / assistant) — thread `contact.state` in.
- MOD the reason→copy mapping — honest copy for `unknown_state` + `outside_window`.
- MOD contact detail UI — a State dropdown (Arizona, North Carolina, Not set).
- MOD `changelog.ts` — What's New entry (installer-safe wording).

## Test list (TDD, red first)

Engine (UTC-anchored instants so the test is independent of the runner's clock):
- AZ allowed midday; AZ blocked at 9pm-AZ (exclusive); AZ allowed 8pm-AZ; AZ
  blocked before 8am-AZ.
- AZ no-DST: 8:30pm-AZ allowed in BOTH June and January (same UTC offset).
- NC blocked at 9pm-NC in BOTH summer (EDT) and winter (EST) — DST-aware.
- NC allowed at 8pm-NC summer + winter.
- CROSS-TZ: one UTC instant that is 9:30pm NC (blocked) AND 6:30pm AZ (allowed)
  — proves per-state matters. (`Date.UTC(2026,5,20,1,30)`.)
- Unknown / blank / unmapped state → blocked (`unknown_state`), even midday.
- Alias tolerance: "az", "Arizona", "north carolina" normalize.

Route:
- state present + inside → sends; state present + outside → `outside_window`;
  missing/blank state → `unknown_state`, before any claim or send.

Rail:
- payload carries `state`; `unknown_state` is a known reason → honest copy.

## Deploy (migrate-first, same discipline as soft-delete)

1. Sync `schema.sql` to the prod bind-mount, then
   `docker exec openlevel-api sh -c 'cd /app && npx tsx db/migrate.ts'` so the
   `state` column exists BEFORE any code reads it.
2. Deploy the gateway (overlay) — engine + route.
3. Deploy OpenLevel api (sync `.ts` + recreate) + web (swap `dist`).
4. Verify in the soft-delete 3-layer style: in-container engine proof (AZ vs NC
   vs unknown), the route blocking through the real public URL, NO real
   illegal-hour send.
5. Do NOT flip the AssistantPage disclaimer (task #9) — still gated on a proven
   real end-to-end send to Admin's own contact.

