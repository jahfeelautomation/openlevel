# OpenLevel Architecture V2.1 — Corrected Implementation Specification

- **Deliverable for:** `docs/plans/plan6.1_review.md` (consolidated adversarial
  review of plan6), implementing its §7 amendments and §4 Steps 0–4.
- **Inputs inspected:** `docs/plans/prompt5.md`, `docs/plans/v2.1_review.md`
  (C1–C6/M1–M18 verified present: 24 finding headings),
  `docs/plans/plan6_review.md` (attached Muse + DeepSeek reviews),
  `docs/plans/plan6.md` + `docs/plans/plan6_amended.md`,
  `docs/architecture/OPENLEVEL_DBOS_FLY_NEON_ARCHITECTURE_V2.md` (carried
  forward; stays byte-identical), V1 (stays byte-identical).
- **Checkout:** branch `master`, commit `2634f8c`
  (`2634f8cd0eaccfdc9d589fad3fc967fd1b3ba0bb`), investigated 2026-11-14.
- **Method note:** no Node.js toolchain or `node_modules` here; nothing
  executed. `executed-test` provenance appears zero times in this pass by
  construction. Counts use fixed-string exact enumeration with commands
  stated. SDK clone (`dbos-transact-ts` @ `e94db66`) supplemental only.
- **External sources:** official docs only, accessed 2026-11-14
  (Appendix S). TypeScript docs for TypeScript claims.
- **Paths** relative to the git root. Successor statement: this document
  supersedes V2 for implementation; V2 is retained immutably for audit
  history (no pointer edit per §6 finding 6).

## Labels

- **[observed]** — seen in the checkout by source inspection.
- **[counted]** — produced by a reproducible command stated alongside.
- **[official-doc]** — supported by cited official documentation.
- **[executed-test]** — proven by a test run (zero uses this pass).
- **[assumption]** — default needing confirmation or measurement.
- **[unknown]** — evidence unavailable; owner or later measurement decides.
- **[Recommendation]** / **[Needs approval]** / **[Proposed]** as before.

## 1. Executive recommendation and architecture verdict

**Verdict: V2's direction is approved; this V2.1 closes the load-bearing
gaps. Implementable for the technical core; commercial launch waits on
named owner gates.**

V2.1 keeps the V2 §7 direction verbatim in substance: Hono + `DBOSClient`
web, one fixed-ID worker, one Neon database, transactional enqueue, DBOS-only
durability, agency billing with an AI wallet, BYO messaging at launch. What
changes: the atomic-enqueue handler is now an explicit contract (not prose);
fencing is a Fly-lifecycle procedure (not a config comment); wallet and
replay are state machines with caps and crash tests (not policies); economics
are calculated placeholders (not formulas); traceability covers the named
MVP surface (not representative groups).

Production-state status is **[unknown]**: no evidence of live production
state was found in the repository (zero deploy artifacts, demo fixtures,
laptop-only docs), but repository evidence cannot prove that an external
production database does not exist. Strategy A (clean start) is therefore
**conditional on written owner confirmation**; until received, all
destructive steps are gated. This corrects V2 §1/§3/§15 wording per M10.

Five-question verdict (unchanged in substance, tightened in wording):
contracts that matter hold; isolation is enforceable via validated context,
partitions, and deferred RLS; durability rests on a now-specified
executor/version story; one operator runs one app, one DB, one dashboard;
economics are calculable but unvalidated — the wallet makes unprofitability
loud, not impossible.

## 2. Product strategy, target customer, scope and non-goals (C6)

**[Recommendation — owner approval pending]** Beachhead: residential
roofing contractors, US Sun Belt, 2–10 crews, buying speed-to-lead.
Painful workflow: storm/restoration lead arrives (form, call, referral)
→ instant SMS response → qualification → booked inspection → follow-up
sequence. Why switch: first-response time is the measurable outcome,
and the wedge reuses existing booking + follow-up + AI-draft flows
rather than demanding a platform migration. Alternative kept warm:
real-estate investor lead buyers (matches the repo seed); the owner
picks one before acquisition spend. Schema comments and seed fixtures
are explicitly NOT market proof — geography follows the pilot decision.

Paid-pilot hypothesis **[assumption — unvalidated]**: 30-day pilot,
bounded price band $199–$399/mo + prepaid AI credits, includes 1
sub-account, speed-to-lead automation, AI drafts (approve-first only),
weekly outcome report; excludes white-label, API, additional seats.
Acquisition experiments (each falsifiable): (1) roofing-consultant
referrals — close 2 of 10 intros in 6 weeks or retire; (2) niche
community — 5% reply-to-demo rate over 200 touches or retire;
(3) direct outbound to recent-permit pullers — 2% demo rate or retire.
WTP bar: 10 paid pilots at a stated price; surveys do not count.
Switching-cost story: snapshots export the working automation so the
agency owns its playbook; leaving costs rebuilding follow-up elsewhere,
not data hostage (export from day one).

Canonical capability dispositions (16 rows; unit = capability row —
reconciles V2 §2 vs Appendix R per M9):

| # | Capability | Disposition |
|---|---|---|
| 1–5 | Lead capture/forms/funnels, CRM, conversations, booking, landing pages | Retain + harden (wedge) |
| 6–9 | Campaigns, automation, AI replies, voice/calls | Improve (metered, gated sends) |
| 10–13 | Reviews, social, affiliates, analytics | Deferred (code retained unpromoted) |
| 14–15 | Courses, communities | Retired from launch scope (2 distinct rows) |
| 16 | Snapshots/templates | New (wedge distribution asset) |

Launch journeys (7, distinct from rows): capture → CRM → inbox →
booking → follow-up automation → AI engagement → snapshot reuse.
Non-goals carried from V2 (no GHL parity, no visual builder, no
per-tenant DBs, no multi-region, no custom admin UI pre-Conductor,
no DBOS Cloud — dated 2026-11-14 observation per M18).

## 3. Verified repository and production-state inventory

### 3.1 Counts (fixed-string, re-verified this pass)

| Measure | Value | Method |
|---|---|---|
| Non-test TS files | 228 **[counted]** | `find … -name '*.ts' ! -name '*.test.ts' \| wc -l` |
| Test files | 182 **[counted]** | `find … -name '*.test.ts' \| wc -l` |
| Endpoint registrations | 230 observed under this enumeration **[counted]** | `grep -rn -F` of 5 method literals, `--exclude='*.test.ts'` → 28/84/40/75/3; full file:line list in working notes (M16: "observed registrations", not bare "exact") |
| Schema tables | 58 **[counted]** | `grep -c -F 'CREATE TABLE' db/schema.sql` |
| Tests using real Postgres | 0 files found **[observed-negative]** | `grep -rl -F -e 'new Pool(' -e 'PgDatabase('` on `*.test.ts`; method covers `pg` Pool and the app wrapper only — other clients would need their own search (M16) |
| Operator `role` enforcement | none found **[observed-negative]** | `grep -rn -F 'role ==='` hits are chat-message roles; `auth.ts` echoes `role` in JSON |

V1/V2 findings carried (spot re-confirmed): pg-boss retry constants,
log-only sends, `setTimeout`+`unref` waits, send-then-persist, the
Chatwoot dedupe-before-enqueue hole, Square random-suffix key, missing
Stripe header, no registration/provisioning, env-name secrets.

New this pass: `workflow_runs(id, location_id, workflow_id, contact_id,
trigger_type, status, steps, started_at, finished_at)` —
**no wake-timestamp, no step timestamps, no resume-position columns**
**[observed]** (`db/schema.sql`, CREATE TABLE block; methods
`create/appendStep/finish/get` in `server/repos/workflow-runs-repo.ts:33-77`).
Due times are therefore **not reconstructible** → M10 notify-only.
Federation **[observed]** (`server/lib/federation-types.ts:1-24`,
`server/routes/federation.ts:142-197`): the Acme Hub gateway wire
contract — the hub calls each app's `/federation/{capabilities,today,
turn,confirm}`; kept as a defined term (not removed).

### 3.2 Live-state status → **[unknown], Strategy A conditional**

Evidence weigh-in unchanged from V2 (read-only; no prod contact):
nothing in the repo demonstrates live customers, prod data, or running
jobs — and nothing here can disprove an external production database.
Per prompt5 §3 and M10, the status is **[unknown]**, Strategy A applies
**only after written owner confirmation of "no live customer state"**;
until then every destructive step is gated. Strategy B stays condensed
(§15) for use if confirmation fails.

## 4. Agency, account, location and tenant model

Carried from V2 with RLS corrected: `agencies` + `agency_members`
(owner/admin/member, enforced) + `locations.agency_id`; agency owns
billing, wallet, white-label, snapshots; locations own domain rows and
carved quotas; `agency_id` + `location_id` validated workflow arguments;
partition key `location_id` with agency-level caps as second limiter.

RLS is **explicitly deferred, not demonstrated** (review §2.4): V2's
pooling-compatibility sentence is relabeled **[unknown]** (practitioner
sources only — does not meet the official-source bar). RLS is NOT
enabled at launch. Gated Phase 3 pilot requires: an official
PostgreSQL/Neon evidence note plus tests across ordinary queries, DBOS
transactional datasource calls, worker connections, and pooled
connections; documented privileged-role bypass (`migrator`, table
owners) with runtime paths proven not to use them. No pilot, no RLS.

## 5. Target runtime and deployment architecture

Carried from V2 (one app/image/`fly.toml`, two groups, one Neon DB,
client-only web, one fixed-ID worker) with the region corrected per M2:
`iad` is **not** justified by seed comments. Region selection is a
commercial-first procedure: (1) owner confirms first-pilot geography
(§2 pending); (2) pick the Fly region nearest that geography with
required features; (3) pair the nearest supported Neon region; record
latency, residency, and provider-region notes. Tentative US default
holds only until step 1 completes. Singapore enters only on SEA
evidence. Machine plan unchanged: web 2× 1x/512MB autostop-off,
worker 1× 1x/1GB via `fly scale count`, SIGTERM/120s.

## 6. pg-boss versus DBOS evaluation

V2's table and DBOS-only recommendation stand, with two M5 additions.
pg-boss grouping comparison (fair statement): pg-boss v12 documents
per-queue worker concurrency and singleton-key throttling, but none of
the verified references describe a partition-key primitive with
per-partition concurrency/rate limits equivalent to DBOS partitioned
queues — so per-tenant fairness in pg-boss would be hand-built
(sharded queues or application-side caps), while DBOS provides it
natively. Fairness test (M5): noisy tenant at 10× median load vs. three
quiet tenants; required property — no quiet tenant's p95 queue-wait
exceeds 2× its solo baseline while the noisy tenant stays within its
partition cap. Cost per 10k/100k executions per engine: formulas plus
placeholder results in §13 (no measured claim).

## 7. DBOS workflows, transactions, queues and delayed work

### 7.1 Atomic enqueue handler contract (C2, B1)

**[Recommendation]** `enqueueInTransaction` is kept — atomicity is the
property that matters. Re-verified this pass against the official TS
client reference (accessed 2026-11-14): `workflowIDReusePolicy` defaults
to `'return-existing'`; `enqueueInTransaction` takes the same options as
`enqueue` **except `duplicationPolicy: 'return-existing'` is unsupported
(throws)**. The two policies are distinct mechanisms: workflow-ID reuse
governs an existing `workflowID`; queue duplicationPolicy governs
`deduplicationID` collisions. Because the reference's displayed
`ClientEnqueueOptions` interface omits `workflowIDReusePolicy` while the
prose documents it, V2.1 requires a compile check against the exact
pinned `@dbos-inc/dbos-sdk` version plus a real-Postgres runtime test
before relying on the option — its validity is **[unknown]** until then.

Normative handler (all triggers: webhooks, public forms, bookings,
operator actions):

```
1. Derive stable business key K from the AUTHENTICATED event/submission
   (provider + account/tenant binding + provider event id). Never take
   tenant identity from untrusted payload fields.
2. BEGIN on a DBOS-system-database connection (direct endpoint).
3. INSERT business_event(K, tenant ids, payload hash, workflow_id UUID)
   ON CONFLICT (K) DO NOTHING RETURNING *.
4. If row inserted: perform business mutation; call enqueueInTransaction
   on the same connection with workflowID = stored UUID and explicit
   workflowIDReusePolicy 'return-existing' (pending compile check; if
   the pinned SDK rejects it, omit the option and rely on step 3 as the
   sole dedup gate — never switch to plain enqueue() for dedup).
5. If row existed: NO new enqueue. Read stored workflow status; return
   the existing operation response (200 + status, not an error).
6. COMMIT. On any failure: ROLLBACK both. Never acknowledge before commit.
```

Concurrency proof required: two simultaneous same-K submissions yield
one business row (unique constraint serializes), one workflow ID, one
execution; the loser returns the existing status with zero new provider
calls. Retention rule: idempotency rows/tombstones live for the
provider-retry horizon + product duplicate window (e.g. payments 30d+
per Stripe's window — see §8 table), independent of DBOS workflow-history
retention (30d/90d). After tombstone expiry a repeated event is defined
as NEW (documented per trigger); never accidental.

Acceptance tests: concurrent-duplicate race; duplicate after completion;
duplicate after workflow-history deletion (tombstone still converges);
duplicate after tombstone expiry (defined-as-new behavior observed).

### 7.2 Transactional datasources (scope caveat per M18)

V2's surgical adoption stands (ledger, markers, payment/invoice
transitions, non-replayable projections). Explicit scope correction:
the datasource guarantee covers **database effects plus the recorded
completion marker** — it does not make external provider calls
exactly-once. Any step mixing a provider call with a transactional op
must follow the §8 attempt protocol; the marker proves the DB write
happened once, never that the provider acted once.

### 7.3 Decomposition rules

Carried from V2 unchanged: fan-out in workflow code; decomposed agent
turns with the 5-round bound; IDs-plus-bounded-metadata arguments.

### 7.4 Waits: journey lifecycle (M4) + sleep rule removed

Delayed continuations remain the default. Minimum journey record
(writer: the segment workflow before completing):
`{journey_id (UUID, unique), location_id, contact_id, workflow_id,
definition_version, segment_position, due_at (timestamptz), state
(active|cancelled|completed|expired), consent_snapshot_ref,
continuation_workflow_id}`. Lifecycle: cancel by journey ID cancels
both the domain row and the DELAYED workflow (via DBOS cancel);
reschedule updates `due_at` + `setWorkflowDelay`; expiry past
`max_delay` (90 days **[assumption]**, enforced, not advisory)
completes as expired with tenant-visible reason; resume revalidates
tenant/contact/consent/definition and treats stale continuations as
cancel-with-reason, never silent drops. Scale benchmarks at
10k/50k/100k parked journeys are **later scale gates** (procedure +
pass criteria: dispatch lag p95 <60s, storage linear, no queue
contention) — not run here, not claimed.

The fixed `<15min` sleep rule is **removed** (M18: no measured basis).
`DBOS.sleep()` is allowed only for named sub-minute operational pauses
(chunk pacing, short backoff between batch segments); every customer
wait uses continuations. If a use case needs longer sleeps, it must
bring a benchmark.

### 7.5 Schedules, bulk, queues (M5/M6)

Schedules and chunked campaign/import design carried from V2. Queue
concurrency numerics are **unconfigured until measured** (M6): no
starting values are blessed. Derivation formula per queue at tuning
time: `limit = min(memory_bound, connection_bound / peak_concurrent,
provider_rpm_bound, entitlement_bound)`, measured against backlog age,
task duration, retries, and saturation — then fixed in config-as-code.
Fairness property under test (M5): the §6 noisy-tenant criterion.

## 8. Provider operations, idempotency and recovery (C5, B3)

Operation vs. attempt hierarchy (normative): one stable `operation_id`
per business intent (agent turn, outbound message, payment) owning
tenant IDs, purpose, budget ceiling, billing state, terminal result;
zero or more `attempt` rows each with `attempt_id`, sequence, provider,
request fingerprint (hash of the exact bytes sent), idempotency key
where supported, timestamps, provider request/object IDs, usage, and
outcome. Attempt states: `prepared → dispatching → succeeded | failed |
uncertain`. Replay **inspects persisted attempt state first**: a
`dispatching` attempt older than its lease without proof of non-dispatch
becomes `uncertain` (quarantine), never auto-retried; only `failed`
with no provider contact may retry, consuming run budget.

| Provider | Mechanism + key window | Guarantee (honest wording) |
|---|---|---|
| Stripe | `Idempotency-Key`, v1 retention ≥24h (official docs) | Provider-enforced within window; same key + same body only |
| Square | `idempotency_key`, same-key safe reattempt (official docs) | Provider-enforced within window |
| Twilio | No send idempotency; SID + StatusCallback reconcile | At-most-once dispatch + reconcile; duplicates possible on blind retry, hence quarantine |
| Brevo | `IdempotencyKey`, 15-min TTL (official changelog) | Provider-enforced within 15 min; reconcile after |
| Anthropic | No documented key | Best-effort bounded retry; spend-capped, never correctness-claimed |
| Vapi | No key on call creation (OpenAPI analyses) | Manual recovery for uncertain live calls |
| Chatwoot | No idempotency/lookup documented | App dedup via sent-marker; uncertain → quarantine |
| Social | No documented keys | App dedup via per-target rows; republish `failed` only |

Purged wording: unqualified exactly-once claims for external sends
appear nowhere in V2.1 as guarantees (prior draft phrasing removed);
internal DB mutations may still claim exactly-once only with the named
datasource mechanism. Chatwoot: per-location secrets
+ server-side inbox registry retained as launch requirements; hosting
status **[unknown]** until owner confirms (M3); secret-in-query deprecated
with a migration window.

## 9. Neon database and privilege model (M1, M12)

One project/database, `app` + `dbos` schemas (carried). Per-pool budget
(all pools separate; sizes explicit, never SDK-defaulted):

| Pool | Endpoint | Max size | Machines | Peak backends/clients |
|---|---|---|---|---|
| Hono app reads | pooled | 10/Machine | 2 web | 20 pooled clients |
| Web txn (`enqueueInTransaction`) | direct | 2/Machine | 2 web | 4 direct |
| Web DBOSClient pool | direct | 4/Machine explicit (review cites documented default 10 — **not independently confirmed** from excerpts available; explicit size makes the default moot) | 2 web | 8 direct |
| Worker DBOS system pool | direct | 10 explicit | 1 worker | 10 direct |
| Worker datasource pool | direct | 8 explicit | 1 worker | 8 direct |
| Migrator/admin one-shot | direct | 3 | — | 3 direct |
| **Totals** | | | | **33 direct + 20 pooled** |

Headroom rule: peak direct must stay under 70% of the provisioned
compute's `max_connections`; the `SHOW max_connections` procedure runs
at provisioning time (no Neon access here — procedure specified, result
pending, honestly labeled). Scale-to-zero OFF on production.

Migration tool (M12): **dbmate**, minimum v2.28.0 (confirmed released
across registries; exact version + digest pinned in the Dockerfile at
implementation — version reports conflict past that floor, so no higher
exact pin is claimed here). Invocation `dbmate --env-var DATABASE_URL
migrate` from `release_command` (single Machine → no lock race;
advisory lock wrapper retained as belt-and-braces); rollback via
`dbmate down` per recorded backout file; order: app migrations →
DBOS schema step → version assertion.

Grant matrix: `migrator` owns DDL on `app`, executes the DBOS schema
step; `app` (single shared runtime role — deliberate simplification,
threat-modeled: a compromised web/worker has the other's DML, accepted
at single-tenant-team scale; split when compliance or a second worker
demands it) holds DML on `app` tables/sequences, `USAGE` on `dbos`
schema, and explicit DML on `transaction_completion` (+ required
DBOS runtime tables per the datasource docs — enumerated at
implementation, never blanket schema grants, never DDL);
`readonly` holds `SELECT` for admin/metrics (real consumer: staging
verification + owner dashboards — retained with purpose).

## 10. Fly deployment, process groups and versioning (C3, M7, B2)

Build/image carried from V2 (`tsc` emit, DBOS unbundled, one `ROLE`
entrypoint). Worker identity: `DBOS__VMID=worker-1` set **only** in the
worker boot wrapper (validated pre-init; boot fails closed without
sysdb connectivity); the app-wide `[env]` VMID from V2's sketch is
removed. Deployment: `rolling` strategy (verified semantics: Machines
replaced one at a time; for the single worker this is stop-then-start —
re-verified via official Fly deploy docs 2026-11-14); `max_unavailable`
does not apply meaningfully at count 1, so the procedure adds an
operator-verified variant: stop worker → confirm Machine `stopped` →
start replacement → confirm heartbeat + recovery of pending workflows →
declare healthy. Never canary/bluegreen/`immediate` for this group.
Rollback preserves executor ID + compatible app version. Graceful
shutdown: stop dequeueing on SIGTERM → bounded in-flight steps reach
safe points → persist uncertain attempts → close pools → exit within
120s `kill_timeout`; DB loss makes the worker unhealthy and halts new
side effects (fail closed, never uncoordinated execution).

Forced-replacement proof gate (Phase 0): kill the worker Machine
mid-workflow and mid-provider-call; assert exactly one active
`worker-1`, correct recovery, no blind external repeat. Clean restart
is explicitly insufficient.

Versioning taxonomy (M7): **no patch** — changes that alter neither the
durable step sequence nor the meaning of recorded results (copy, pure
compute, additive logging); **patch required** — added/removed/reordered/
conditional steps for possibly-running workflows, old paths retained,
`deprecatePatch()` only after affected executions drain; **new
version/workflow required** — incompatible arg/result shapes or
irreconcilable semantics. Helper edits are NOT automatically safe: any
helper changing durable operations is a workflow-compatibility change.
Every workflow change gets patch review + a recovery test.

## 11. Security and disaster recovery (M13, M14, M18)

V2's credential direction (AES-GCM columns, key IDs, rotation, OAuth,
redaction, audit) stands, with the trust boundary now explicit (M14):
**only the worker/provider-adapter path may decrypt** outbound-call
credentials; web OAuth callbacks encrypt-and-store tokens and never
return plaintext to general application paths; ciphertext binds
tenant+provider via AES-GCM additional authenticated data; every
decrypt/rotate/revoke is audit-logged; tenant-crossing access has a
dedicated negative test. Narrow exception (documented with threat
implications): web may decrypt transiently inside the OAuth refresh
handler when the provider requires secret-in-request refresh — no
caching of plaintext outside that handler.

Message-send invariants (M13, mandatory before every irreversible send
regardless of BYO): consent on file + opt-out/DND re-check + quiet
hours in the contact timezone + sender authorization for the tenant +
duplicate suppression (operation UUID). Each send stores evidence +
timestamps explaining why it was allowed. First-vertical note: the
roofing beachhead avoids health-data compliance; a med-spa pivot would
reopen this section (owner decision).

Corrections (M18): Neon-outage "degraded reads" means cached/static
content only — DB-backed reads/writes/enqueues fail with a retryable
service error, never silently; federation is the defined Acme Hub
gateway contract (§3), rate-limited as its own surface; datasource
scope caveat per §7.2. Whole-system recovery spec, RPO/RTO-as-approval,
and threat deltas carried from V2.

## 12. Commercial onboarding, billing, metering and entitlements (C4, M15, B3)

Hybrid model carried (BYO messaging/voice, platform AI wallet). Wallet
state machines (normative): reservation `reserved → settled | refunded |
expired`; provider attempts per §8. Caps per run/turn: **USD ceiling in
integer micro-units** + max input tokens + max output tokens + max
provider attempts, priced off a versioned model-price table. Unknown
outcomes consume attempt budget and quarantine the reservation — never
auto-refund, never auto-retry. Sweeper: every 5 min, `FOR UPDATE SKIP
LOCKED` per reservation row, transitions only provably-undispatched or
provider-reconciled records to expired/refunded; operator-visible
quarantine otherwise. Wallet row locks live only inside the short
reserve/settle transactions — never across a network/model call.

Crash tests (C4 acceptance): (1) crash after reservation, before
dispatch → refunded/expired, zero provider calls, customer balance
exact; (2) crash after durable `dispatching` write, provider contact
unknown → uncertain, no blind retry, spend within caps; (3) provider
charged, crash before settlement → recovery inspects attempt first, no
duplicate, billing/COGS reconciliation explicit; (4) crash after
settlement, before completion → unique settlement keys prevent
double-settle/double-charge. Concurrent-turn exhaustion test: N turns
racing one wallet serialize on the row lock; losers fail closed with
insufficient-funds, never negative balance.

Subscription lifecycle (M15): trial → active → past-due (grace 7 days,
existing runs finish, new AI reservations blocked at grace end) →
suspended → cancelled; dunning emails at fixed cadence; chargeback/
refund via Stripe webhooks with idempotent reconciliation (webhook
event IDs deduped); auto-recharge failure pages the owner and freezes
new reservations at wallet zero; top-ups reconcile on webhook, never on
client claim. Failed payment never corrupts ledger exactness: money
movement and entitlement changes are separate transactional records.

## 13. Unit economics, profitability and scaling scenarios (C1, B4)

All inputs below are **[assumption]** illustrative placeholders except
cited list prices; nothing here is measured or WTP-validated. Fixed
stack carried: ≈$45–100/mo (labeled: 2 web + 1 worker Fly ≈$14,
Neon always-on 0.25–1 CU ≈$19–77, Sentry-class tooling ≈$10;
branches/egress excluded until measured; recheck at purchase).

Placeholder inputs: 4 locations/agency; 25 AI turns/location/day;
3k in / 800 out avg tokens; mix 80% Haiku ($0.10/$0.50) + 20% Sonnet
($2/$10); subscription $249/agency/mo (hypothesis, not evidence);
usage margin $15/agency; Stripe 2.9%+30¢ (US online card — geography
caveat: PH/EU rates differ); support 0.25 hr/agency/mo @ $50; churn
5%/mo; CAC $150. AI cost/turn = $0.00336 → $10.08/agency/mo.

| Agencies | MRR | AI COGS | Infra | Stripe | Support | Contribution | Margin |
|---|---|---|---|---|---|---|---|
| 10 | $2,640 | $101 | $70 | $75 | $125 | $2,269 | 86% |
| 50 | $13,200 | $504 | $85 | $376 | $625 | $11,610 | 88% |
| 100 | $26,400 | $1,008 | $110 | $752 | $1,250 | $23,280 | 88% |
| 500 | $132,000 | $5,040 | $400* | $3,761 | $6,250 | $116,549 | 88% |
| 1000 | $264,000 | $10,080 | $800* | $7,522 | $12,500 | $233,098 | 88% |

*Includes Conductor $99 + larger Neon at scale (placeholder step).
Break-even ≈ 1 agency on fixed costs — fixed infra is not the risk.
Sensitivity: 24/7 tail (one location, 500 Sonnet turns/day ≈ $210/mo)
exceeds a lone agency's AI budget → wallet hard-stop fires; without
the wallet, one tail erases one agency's margin. Low-usage and
high-churn cases scale linearly; support at 1 hr/agency halves margin
at 10 agencies — support efficiency is the second risk after AI tail.

Checkpoints (multipliers placeholder, measured?=No): turn 12,
automation 8, recipient 3, import batch 50. At 10 ckpts/execution:
10k exec → 100k ckpts (free); 1M exec → 10M ckpts → 9M over × $50/M =
$450/mo; 10M exec → $4,950/mo overage. Finding: Conductor quota, not
base fee, is the scale cost to watch — measure real multipliers in
Phase 2. Cost/10k/100k executions: DBOS = ckpts×rate + infra share;
pg-boss = job-rows×storage + infra share; both formulas with the same
placeholder inputs (pg-boss lower at trivial workloads, DBOS wins
wherever recovery/versioning/fairness would otherwise be custom code —
design judgment, not measurement).

## 14. Observability, support and Day 2 operations (M11)

Stack carried (Fly logs/metrics + Sentry + Conductor-at-trigger, no
custom admin UI). Worker liveness is separate from web `/health`: the
worker emits a heartbeat row (executor ID, queue depth polled, sysdb
latency, timestamp) every 30s; alert on heartbeat older than 3 min
(stale-heartbeat page — a `started` Machine with a dead worker is the
failure this catches). Provisional paging thresholds + runbook actions
(all **[assumption]** until load-tested): error-budget burn >2% 5xx
over 10 min → freeze deploys, inspect Sentry; backlog growth with idle
worker (depth rising 15 min while dequeues = 0) → fencing runbook;
stuck workflows (no checkpoint progress >30 min, non-DELAYED) →
inspect, resume/fork/cancel; DB saturation (>80% of budgeted backends
5 min) → shed bulk queue, page; wallet-settlement failures (any
failed settle) → freeze AI reservations, reconcile ledger. Dashboards
for the rest (p95, tokens/cost, messaging volume, reservation errors).

Launch operator policy: `resumeWorkflow` (transient + attempts-exceeded
after fix), `forkWorkflow` (fixed code, restart-from-step),
`cancelWorkflow` (+ notify). `rewindWorkflow` is **not permitted at
launch** — no tested datasource-specific rewind procedure exists; revisit
only with a procedure + test. Retention tiers carried from V2.

## 15. Migration/cutover strategy (M10)

Strategy A conditional (§3). Item 7 verdict: **notify-only, no automatic
adoption** — `workflow_runs` persists no wake timestamp, no step
timestamps, and no resume position **[observed]** (§3.1), so due times
are not reconstructible; any adoption script would guess. Procedure if
a prod DB is ever connected: list `waiting` runs, notify owning
locations with run context, mark honestly, let tenants re-trigger.
All other items N/A with the §3 evidence (no observable jobs/state).
Strategy B condensed procedure carried for use only if owner
confirmation fails. Clean-start sequence and rollback carried from V2.

## 16. Test and acceptance strategy

V2's 7 critical gates + secondary list carried, with two additions.
**Phase 0 prototype gates (blocking implementation of the corresponding
path):** (P1) C2 handler prototype — concurrent-duplicate race on real
Postgres proving one business row, one workflow, existing-status
response; (P2) C3 fencing prototype — forced Machine replacement
mid-workflow and mid-provider-call proving single active executor, no
blind repeat; (P3) C4/C5 safety tests — the 4 wallet crash tests plus
provider-uncertain quarantine proof. Design-only validation is
explicitly NOT complete validation. Secondary additions: missing
partition key fails loudly (never silent stall); reservation
exactly-once under replay; versioning taxonomy conformance per
workflow change. Environments unchanged (Testcontainers/Neon-branch
for DBOS; PGlite for app tiers); no green claims until suites run.

## 17. Phased implementation roadmap (M8)

**Phase 0 — Baseline + prototypes (S).** Deliverables: toolchain,
honest test baseline, staging (Neon branch + Fly app), P1/P2/P3
prototype gates green, Strategy A sign-off. Dependencies: owner access
grants. Acceptance: 7 gates designed + prototypes passing on staging.
Value: de-risked core. Cost: staging infra only. Burden: setup week.
Rollback: delete staging. DoD: signed Strategy A + green prototypes.

**Phase 1A — Agency + billing foundation (M).** Agencies, members,
roles, `agency_id` backfill, Stripe lifecycle + dunning, entitlements,
ledger + wallet + caps, plan gates. Acceptance: signup→subscribe→fund→
gate tests; dunning/wallet crash tests. Value: chargeable. Cost: Stripe
fees on trials. Burden: billing on-call. Rollback: feature flags off,
trial mode. DoD: money moves correctly or not at all.

**Phase 1B — Provider onboarding + credentials (M).** Encrypted columns,
OAuth connect/refresh/revoke, consent registry, onboarding health
checks, tenant setup flow. Acceptance: credential lifecycle + negative
tenant-crossing tests. Value: self-serve connect. Rollback: disable
connectors. DoD: owner-independent onboarding works.

**Phase 2 — Durable core (L).** DBOSClient path, worker, txn enqueue,
datasource adoption, agent + automation WFs, continuations, provider
safety, patching, heartbeat/alerts. Acceptance: 7 gates + secondary
suite green on staging. Value: reliable automation. Rollback: pg-boss
paths retained until gates pass. DoD: staging proves every gate.

**Phase 3 — Expansion (continuous).** Campaigns, imports, snapshots,
white-label, digests, RLS pilot, Conductor/second worker on triggers.
Each item ships with its own tests; nothing here gates launch.

## 18. ADRs, risks, assumptions and owner decisions

V2's nine ADRs stand with three amended records: ADR-5 (single worker)
now names Fly-lifecycle fencing + the proof gate; ADR-6 (patching)
adopts the §10 taxonomy + review rule; ADR-9 (hybrid) is unchanged in
direction with wallet mechanics pointing at §12. Risks carried from V2
plus: (6) pinned-SDK interface omits the reuse option → compile gate
owns it; (7) single-worker availability window during deploys → brief
pause accepted, Conductor trigger defined.

Owner decisions with states (all **[Needs approval]**, none received):
Strategy A confirmation — pending (gates destructive steps); first
vertical + price band (§2) — pending (gates acquisition spend, not
drafting/technical spikes); region — pending (gates provisioning);
Chatwoot hosting — **[unknown]** (gates webhook deployment costing);
managed-messaging liability — deferred to tier decision; RPO/RTO —
pending (gates DR claims); Conductor purchase — at §10 trigger;
Chatwoot-retire timing — post-launch. Sign-offs record here with role
and date when received; no names invented.

## Appendix R. Eighteen required recommendations (updated)

Full register (self-contained; V2's answers revised where V2.1 changed them):

1. **Is DBOS right?** Yes — durable journeys, agent turns, schedules,
   bulk (§6). Alt: improved pg-boss. Uncertainty: checkpoint cost.
2. **What does DBOS do that pg-boss can't?** Checkpointed recovery,
   DELAYED continuations at scale, patching, partitioned fairness —
   without custom code (§6).
3. **Simplest architecture keeping DBOS power?** §5: client-only web,
   one worker, one DB, txn enqueue. No outbox, pump, DLQ tables,
   flags, or custom admin.
4. **Does web need DBOS runtime?** No — `DBOSClient` only (§7.1).
5. **Txn enqueue vs. outbox?** Txn enqueue wins (§7.1); outbox only on
   future multi-consumer need.
6. **Which ops need transactional datasource?** Ledger, markers,
   payment/invoice transitions, non-replayable projections (§7.2).
7. **Long-delay strategy?** `delaySeconds` continuations with the §7.4
   journey lifecycle; sleep only for named sub-minute pauses.
8. **One-worker recovery?** Fixed `DBOS__VMID`, worker-only scope,
   rolling stop-then-start, verified fencing procedure (§10).
9. **When Conductor?** Second worker or ~1M checkpoints/mo; $99/mo
   math in §10/§13.
10. **Versioning?** Pinned version + `patch()` discipline with the
    §10 no-patch/patch/new-version taxonomy and review rule.
11. **Machines/connections at launch?** 2 web + 1 worker; 33 direct
    + 20 pooled with per-pool table (§9).
12. **Signup-to-value path?** Signup → provision → subscribe → fund
    wallet → connect → onboard (§12); dunning + lifecycle in §12.
13. **Who pays AI/SMS/email/voice?** Platform AI wallet; BYO messaging
    (§12); managed messaging later, owner-approved.
14. **Margin protection?** Reserve/settle ledger, caps, hard stops,
    80% warnings, plan gates (§12); formulas in §13.
15. **Preserve/improve/defer/retire?** Canonical 16-row table + 7
    launch journeys, units defined (§2).
16. **Build first for revenue?** Phase 1A/1B commercial core —
    billable before DBOS cutover (§17).
17. **Top one-operator risks?** Uncertain-send duplicates, hidden red
    baseline, API drift, single-worker availability, pricing drift (§18).
18. **Break-even?** Calculated placeholders: ≈1 agency on fixed costs;
    risk is tail-driven, wallet-gated (§13).

Delta summary vs V2's register: items 7, 8, 10, 11, 15, 18 revised
as above; all others confirmed unchanged.

## Appendix T. MVP traceability (launch-critical + cross-cutting)

Scope rule (review §2.5): full rows for the MVP surface below; all
other routes grouped as retained-unpromoted/deferred/retired per §2
(no 230-row pre-implementation audit; the 230 file:line inventory is
retained in working notes for the later audit artifact).

| Surface | Routes (file:line from inventory) | V2.1 behavior | Acceptance |
|---|---|---|---|
| Auth | `auth.ts:52,76,81` login/logout/me | Unchanged + agency membership | 401/403 matrix green |
| Agency/location access | `locations.ts` list + middleware | `agency_id` checks enforced | Cross-agency 403/404 |
| Lead capture | public forms/funnels/trigger-links POST paths | Unchanged + §7.1 txn enqueue | Duplicate POST converges |
| Inbox/webhook | `webhooks-chatwoot.ts` POST `/` | Same index + txn enqueue | Kill-after-persist still enqueues |
| Booking | `public-booking.ts` POST paths | Unchanged guards + txn event | Double-book → honest taken |
| Follow-up automation | `workflows.ts:59-119` CRUD/run/runs | Rebuilt on continuations | Due-time resume across deploy |
| Agent reply | jobs `agent-reply` + conversations POST | Decomposed turn + wallet gate | Draft zero-call; no duplicate autonomous send |
| Campaigns | `campaigns.ts:38-59` incl. send | **[CHANGE]** 202 + chunked WF | Same terminal outcomes |
| Billing/wallet | new billing routes | §12 machines | Crash-test quartet green |
| Credentials/consent | new + settings routes | §11 boundary + invariants | Negative crossing tests green |
| Money boundaries | invoices/checkout-link POST paths | Versioned idempotency keys | Retry replays same link |
| Cross-cutting | middleware + repos | Validated WF context | Forgery rejected under concurrency |

## Appendix L. Evidence ledger (provenance per M16)

Snapshot: `master` @ `2634f8c`; status `M .gitignore` + untracked
`deepwiki.md`, `docs/plans/`, `docs/architecture/`; V2.1 target absent.
`executed-test` count this pass: **zero** (no toolchain; stated, not implied).

| Source file | Symbol | Observed behavior | Tests | Provenance | Implication |
|---|---|---|---|---|---|
| `server/index.ts:239-301` | `bootstrap` | Couples pool + pg-boss + HTTP | `index.test.ts` (unrun) | observed | Split web/worker |
| `server/jobs/boss.ts:27-38` | retry consts | 4/5s/backoff/300s; batch 1 | `boss.test.ts` (unrun) | observed | Retry baseline |
| `server/jobs/workflow-runner.ts:52-63` | `defaultSchedule` | `setTimeout`+`unref` waits | runner tests (unrun) | observed | Continuations |
| `server/jobs/workflow-runner.ts:116-137` | `executeAction` | SMS/email log-only | runner tests (unrun) | observed | Gated real sends |
| `server/lib/outbound.ts:62-88` | `sendOutboundMessage` | Send-then-persist | outbound tests (unrun) | observed | Attempt protocol |
| `server/routes/webhooks-chatwoot.ts:70-99` | POST `/` | Dedupe-before-enqueue hole | webhook tests (unrun) | observed | §7.1 handler |
| `server/repos/base-repo.ts:17-43` | `LocationScopedRepo` | Ctor guard + regex scoping | 53 repo tests (unrun) | observed | Keep + datasource |
| `db/schema.sql` wf_runs block | table def | No wake/step timestamps | none | observed | M10 notify-only |
| `db/schema.sql:3-11` | `locations` | `client_slug` nullable, non-unique | seed only | observed | Agency replaces grouping |
| `server/lib/federation-types.ts:1-24` | wire contract | Hub gateway `/federation/*` | federation tests (unrun) | observed | Defined term |
| repo-wide | endpoint count | 230 (28/84/40/75/3) | n/a | counted (fixed-string cmd §3) | MVP matrix scope |
| repo-wide | table count | 58 CREATE TABLE | n/a | counted (`grep -c -F`) | Disposition scope |
| repo-wide | deploy files | none found | n/a (absence) | observed-negative (ls+find) | Strategy A evidence |
| TS client reference | reuse policies | default return-existing; txn excludes duplicationPolicy | n/a | official-doc (2026-11-14) | §7.1 contract |
| Fly deploy docs | rolling/canary/bluegreen/immediate | one-at-a-time vs alongside vs all-at-once | n/a | official-doc (2026-11-14) | §10 fencing |
| Fly restart policy | machine restart guide | cited by review; not independently excerpted | n/a | unknown (re-verify at implementation) | §10 procedure input |
| DBOSClient pool default | "documented 10" (review claim) | not confirmed in available excerpts | n/a | unknown (explicit sizes moot it) | §9 budget note |

## Appendix S. Sources (accessed 2026-11-14 unless noted)

V2's source list carried in full (DBOS TS client/queues/methods/
workflows-steps/management/schedules/upgrading/recovery/checklist/
5.0-notes, `llms.txt`, dbos-pricing, pg-boss docs, Neon pricing +
usage + branch-restore, Fly pricing + workers + availability, Stripe,
Square, Twilio, Brevo, Chatwoot, Vapi, social secondaries, Anthropic
secondary). New/strengthened this pass: TS client reference
`workflowIDReusePolicy` default + `enqueueInTransaction` option
exclusion (re-verified); official Fly deploy-strategy semantics
(rolling/canary/bluegreen/immediate); Fly restart-policy guide
(review-cited, re-verify); dbmate registries (floor v2.28.0).

## Appendix C. Config sketch and runbooks (corrected)

```toml
# fly.toml essentials — VMID worker-only via boot wrapper, never [env]
app = "openlevel"
[processes]
  web = "ROLE=web node dist/boot.js"
  worker = "ROLE=worker node dist/boot-wrapper.js"  # sets+validates DBOS__VMID, fails closed
[deploy]
  strategy = "rolling"  # one-at-a-time; single worker => stop-then-start
  release_command = "node scripts/release.mjs"
[http_service]
  internal_port = 8790
  auto_stop_machines = "off"
  [[http_service.checks]]
    path = "/health"
kill_signal = "SIGTERM"
kill_timeout = "120s"
```

§7.1 handler pseudocode: BEGIN (direct sysdb) → INSERT business_event
`ON CONFLICT DO NOTHING RETURNING` → if new: mutate + `enqueueInTransaction`
(stored UUID, explicit reuse policy pending compile check) → else read
existing status → COMMIT/ROLLBACK. Runbooks: stuck WF (inspect →
resume/fork/cancel); uncertain send (`outbound_operations` → provider
lookup → mark/quarantine); fencing (stop worker → verify `stopped` →
start same-ID replacement → confirm heartbeat + recovery → healthy).

## Appendix G. Author self-audit, rejection register, final report

**Scorecard self-audit** (source: local `docs/plans/v2.1_review.md`,
§5 rows; graded by the author 2026-11-14 — self-audit, not independent
approval): C1 closed-by-design (placeholders calculated, §13);
C2 closed-by-design pending compile/runtime proof (procedure + tests
in §7.1/§16); C3 closed-by-design pending fencing drill (§10/§16);
C4/C5 closed-by-design pending crash-test execution (§§8, 12, 16);
C6 designed, owner-pending (§2); M1 designed, limit-pending (§9);
M2 procedure + owner-pending; M3 unknown + owner-pending; M4 lifecycle
designed, benchmarks gated; M5 property + test designed; M6 formulas,
unconfigured; M7 taxonomy + rule; M8 split with full fields; M9
reconciled (16 rows + 7 journeys); M10 notify-only on schema evidence;
M11 thresholds + policy provisional; M12 tool + grants pinned/specified;
M13/M14 boundary + invariants; M15 lifecycle; M16 provenance applied;
M17 this register + report; M18 swept (§§2, 4, 7, 9, 11, 13, 14).

**Rejection/qualification register:** outbox pump → rejected (§7.1,
atomic txn suffices); hybrid pg-boss/DBOS → rejected (§6, unmeasured
benefit vs. dual ops); custom DLQ/admin UI → rejected (§14, DBOS-native
+ Conductor path); per-tenant cutover flags → rejected (clean start,
§15); queue `duplicationPolicy: return-existing` in txn → rejected as
unsupported, distinguished from workflow-ID reuse (§7.1); Fly
`immediate` as fence → rejected (§10, rolling + verified procedure).

**12-item final report:** (1) verdict: V2 direction approved, V2.1
closes load-bearing gaps to design-complete; (2) target = §5 + §10;
(3) key deltas = §7.1 handler, §10 fencing, §§8/12 state machines,
§13 calculated model, §2 vertical, §17 split; (4) official-doc findings
= reuse-policy distinction, rolling semantics, pool/grant specifics;
(5) dispositions = 16-row table (§2); (6) wedge = roofing beachhead,
owner-pending (§2); (7) agency + hybrid billing (§§4, 12); (8) break-even
≈1 agency fixed, tail-gated (§13); (9) owner approvals = §18 list, none
received; (10) blockers = compile check, prototypes, owner batch;
(11) tests unexecuted by construction, designed with criteria (§16);
(12) this document at `docs/architecture/OPENLEVEL_DBOS_FLY_NEON_ARCHITECTURE_V2_1.md`.
