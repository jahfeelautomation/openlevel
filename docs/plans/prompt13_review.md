# Independent Adversarial Code Review — OpenLevel Phase 0 Closeout

Review assignment: `docs/plans/prompt13.md`. Reviewer: independent (not the implementation agent).
Subject: branch `phase0/automated-testing`, reported HEAD `dd40238`, 15 modified uncommitted files
(`git diff --stat HEAD`: +790/−104), untracked evidence under `phase0/evidence/`, reports under
`docs/plans/`. Review mode: read-only; no commits, no pushes, no DB operations, no `.env` access,
no evidence deletion. Redaction grep (prompt11 §B-4) applied to this file before publication.

---

## A. Executive verdict

**FIX BEFORE PUSH**

One MAJOR defect is convincingly demonstrated from installed dependency source plus this
repository's own test fixtures: **the loopback-only port-binding check in the new container
identity verification can never pass on the Testcontainers path** — Testcontainers 12.2.1
publishes `5432` with no `HostIp` (Docker binds `0.0.0.0`), and `container-identity.ts:321-325`
rejects anything that is not `127.0.0.1`/`::1`. The first CI integration run would therefore die
at the identity check with `host binding 0.0.0.0:… is not loopback-only` — a *new* root cause —
leaving CI-CONTAINER red, and the underlying security requirement ("the PostgreSQL port is bound
only to loopback", prompt13 §3) unmet in container mode. The remediation is ~8 lines (§H).

The provenance chain itself (Priority 1's central question) **is sound** under an explicitly
documented Docker-daemon trust boundary — see §C. No CRITICAL finding exists. Deferred MINOR and
INFO items (§B) do not block the milestone per prompt13 §7/§9.

---

## B. Findings ranked by material impact

### Blocker (must fix before push)

---

#### B1 — MAJOR — The loopback-only binding check cannot pass on the Testcontainers path; the container is in fact wildcard-bound

| Field | Content |
|---|---|
| **Severity** | MAJOR (broken core invariant of the harness + unmet security requirement; not CRITICAL because the failure is fail-closed — the run refuses to proceed rather than proceeding unsafely) |
| **File:line** | Enforcement: `phase0/container-identity.ts:317-328` (reject at `:322-324`, `LOOPBACK_IPS` at `:220`); caller: `phase0/provisioners/testcontainers.ts:124-132` (runs before `waitReady` at `:137`); root cause in dependency: `node_modules/testcontainers/build/generic-container/generic-container.js:305-319` (`PortBindings` entries carry only `HostPort`, never `HostIp` — `:309`/`:313`), `node_modules/@testcontainers/postgresql/build/postgresql-container.js:31,36-38` (plain `withExposedPorts(5432)`), `node_modules/testcontainers/build/utils/port.d.ts:1-6` (`PortWithBinding` has no IP field — no public API can set one), `node_modules/@types/dockerode/index.d.ts:1157-1160` (`PortBinding.HostIp` optional) |
| **Root cause** | Two independently correct pieces that contradict each other: (1) Testcontainers creates containers with `HostConfig.PortBindings = {'5432/tcp': [{HostPort: '0'}]}`, so Docker publishes on all interfaces (`inspect` → `HostIp: "0.0.0.0"`, or `""` on some API levels); (2) the new identity policy accepts only `127.0.0.1`/`::1`. No code anywhere overrides the binding, and the installed Testcontainers version exposes no option that could. The URL-level guard cannot see this: `resolveHost()` returns `localhost` for a unix socket (`resolve-host.js:30-41`), so `assertDisposableUrl` (`testcontainers.ts:119`) passes while the actual socket is wildcard-bound. |
| **Concrete failure scenario** | Authorize push → GitHub Actions `integration` job (`phase0.yml:73-90`) → container starts fine → `verifyContainerIdentity` (`testcontainers.ts:124`) → check 7 → `ContainerIdentityError: host binding 0.0.0.0:3xxxxx is not loopback-only` → `up()` throws **before** the state file write (`:155`) and **before** the handle stash (`:159`) → `test-env.ts` catch at `:219-221` → `FATAL`, exit 2 (`EXIT_INFRA_FAIL`); `finally` at `:225` skips `down()` because `state` is null → container left running until the Testcontainers Reaper (session label set at `generic-container.js:94-96`) removes it at process exit. |
| **Consequence** | (1) The push milestone fails: CI-CONTAINER stays FAIL with a *new* root cause, costing a full push→CI→diagnose→fix cycle. (2) Security requirement unmet: prompt13 §3 demands wildcard/public bindings fail closed *and* that the port actually be loopback-bound; today container-mode runs (locally or on CI) expose PostgreSQL on all interfaces for the duration of the run, guarded only by random per-run passwords. |
| **Reproducibility** | **Logically demonstrated**, not executed: (a) dependency sources cited above prove no `HostIp` is ever set; (b) this repository's own test proves `0.0.0.0` → rejection: `container-identity.test.ts:110-113` (`expect(() => verdictOf(raw)).toThrow(/not loopback-only/)`); (c) the conjunction has never been run — the previous CI run (43656080155) died earlier at the old RepoDigests check (HEAD `container-identity.ts:164` precedes the binding check at HEAD `:169`), and all 26 unit tests use a fixture that hardcodes `HostIp: '127.0.0.1'` (`container-identity.test.ts:46`) — the exact circular-fixture pattern prompt13 §3 warns about. The only empirical unknown is Docker's exact inspect representation (`0.0.0.0` vs `""`); **both are rejected by line 322**, and no Docker CLI exists on this review machine (UNVERIFIED here; first CI run confirms in minutes). |
| **Smallest durable correction** | In `testcontainers.ts`, subclass the container and set the host IP in the protected creation hook (runs at `generic-container.js:79-81`, *before* `HostConfig` is merged at `:141-142`): `class LoopbackPostgreSqlContainer extends PostgreSqlContainer { protected override async beforeContainerCreated() { for (const list of Object.values(this.hostConfig.PortBindings ?? {})) for (const b of list ?? []) b.HostIp ??= '127.0.0.1'; } }` (~8 lines), then use it at `:101`. `hostConfig` is `protected` (`generic-container.d.ts:14`), the hook is `protected` (`:36`), `PortBinding.HostIp` is optional (dockerode `:1158`) — type-safe under `phase0/tsconfig.json` strict. Verify in the first CI run that `localhost` still resolves to the bound address (`resolve-host.js` returns `localhost`; Node/glibc `/etc/hosts` resolves `127.0.0.1` first on stock runners — UNVERIFIED here; if not, add a second binding entry for `::1`, also accepted by `LOOPBACK_IPS`). |
| **Required regression test** | Unit (no Docker): instantiate the subclass, invoke `beforeContainerCreated` (cast for protected access), assert every `PortBindings` entry now has `HostIp: '127.0.0.1'`; keep the existing reject-`0.0.0.0` case (`container-identity.test.ts:110-113`). End-to-end proof = the CI integration run itself (identity line prints, no FATAL). |
| **Blocks push** | **YES** |

---

### Deferred concerns (fix later; do not gate the milestone)

---

#### M1 — MINOR — P3 archive/reconcile is not execution-scoped: the invariant degrades to "an attempt with this operation id exists somewhere"

| Field | Content |
|---|---|
| **Severity** | MINOR (financial reconciliation weakness in principle; no reachable masking scenario under the current harness — defense in depth) |
| **File:line** | `phase0/reconcile.mjs:87-114` (existence match `:95-109`, `UNION ALL` live+archive `:100-106`, no `attempt_id` join, no count comparison, no execution filter); `phase0/p3/schema.sql:69-84` (archive has **no** run/execution column, no FK to `p3_operation`), trigger `:103-105`, `ON CONFLICT (attempt_id) DO NOTHING` `:96`; journal keying `phase0/p3/fake-provider.ts:20-27`, `reconcile.mjs:77-79` |
| **Root cause** | The archive is a global append-only side table and the check is a per-`operation_id` existence test across `p3_attempt ∪ p3_attempt_archive`. Prompt13 §3's stronger invariant ("…in *this* execution…correct durable attempt and operation") is not what the code enforces. |
| **Concrete failure scenario** | A provider charge in the current journal for operation X is satisfied by an archive row for operation X *from an earlier execution*. Practical preconditions: (i) `operation_id` reuse across executions — defeated by `randomUUID()` (`wallet.ts:52`) and fresh attempt UUIDs (`:165`); (ii) a journal carried across executions — defeated by the per-execution journal path + `rmSync` (`test-env.ts:156-157`); (iii) archive rows originate only from live rows of the same database (`schema.sql:88-96`). A *preset* stale `P3_PROVIDER_LOG` (`p3.test.ts:63-69` respects it) produces false **FAIL**s (orphan charges), never false passes. |
| **Consequence** | If any future test or runner invocation presets the journal or reuses operation ids, reconciliation could silently accept historical attempts as current evidence. Today: none of the three preconditions is reachable (cross-execution contamination assessed practically impossible — UUID op ids + per-execution journal + whole-table `TRUNCATE`-only deletion). |
| **Reproducibility** | Query-level demonstration (verbatim SQL above); the masking scenario is **not reproducible** with the current harness and is marked as a gap in the invariant's *form*, not an observed failure. Related sub-gaps with the same root: archive trigger's `ON CONFLICT DO NOTHING` keeps the first snapshot of an `attempt_id` (a later re-archive would not refresh `state` — invisible in practice because ids are unique and rows are never re-archived); `settle-equals-attempt-cost` (`reconcile.mjs:117-121`) joins live attempts only, so a settlement whose attempt was archived drops out of the comparison (fixtures truncate settlement and attempt together, `p3.test.ts:60-62`, so unreachable); `sweepExpired` refund eligibility also reads live attempts only (`wallet.ts:339-346` — an archived `uncertain` attempt would not block a refund, but truncation clears `p3_operation` in the same statement, so no reserved operation survives to be refunded). |
| **Smallest durable correction** | Match on `attempt_id` (the journal already carries it) instead of/in addition to `operation_id` existence, and compare per-operation charge counts vs attempt counts; optionally add `execution_id` to the archive, populated from the state file at trigger time. At minimum, document the UUID + per-execution-journal argument beside the check so the invariant's strength is explicit. |
| **Required regression test** | Seed `p3_attempt_archive` with an attempt for operation X from a prior "execution" (different attempt id), journal-charge operation X with a new attempt id → `charges-have-attempts` must FAIL once attempt-id matching exists. |
| **Blocks push** | NO |

#### M2 — MINOR — Post-start failures in `up()` orphan the container (no state file, no handle → `down()` skipped)

| Field | Content |
|---|---|
| **Severity** | MINOR (bounded cleanup via Testcontainers Reaper; no data/security impact) |
| **File:line** | `phase0/provisioners/testcontainers.ts:101-159` — container started `:101-107`, identity `:124`, readiness `:137`, SCRAM `:138`, state file only at `:155`, handle stash only at `:159`; consumer `phase0/test-env.ts:225-229` (`else if (provisioner && state)` → `down()` not called when `up()` throws) |
| **Root cause** | Success artifacts (state, handle) are written *after* all fallible post-start steps; any throw between them loses both teardown paths. |
| **Concrete failure scenario** | B1's identity rejection, or an ordinary readiness timeout (`:77`) or SCRAM mismatch (`:86`) → `up()` throws → run exits 2 → container keeps running; `test-env down` later reports "no live handle". Reaper (session label, `generic-container.js:94-96`) removes it at process exit; if the Reaper is disabled or fails, the container lingers until manual `docker rm`. |
| **Consequence** | Orphaned PostgreSQL container on CI (ephemeral runner — low impact) or on the owner's machine (requires manual cleanup; state file absent so the harness cannot name it). This is also the immediate side effect B1 would trigger on the first CI run. |
| **Reproducibility** | Logically demonstrated from the code order above (no Docker available to execute); live behavior UNVERIFIED until CI. |
| **Smallest durable correction** | Stash `globalThis.__phase0_container = container;` immediately after `.start()` returns (`:107`), before the identity check — two moved lines; `down()` (`:198-216`) then always stops a started container. |
| **Required regression test** | Without Docker this cannot be executed end-to-end; acceptable minimum: a unit test asserting handle-stash ordering by injecting a failing identity step (mock `verifyContainerIdentity` to throw) and asserting the stashed handle is present and stopped — otherwise verify in the first CI failure-path log. Marked UNVERIFIED for live execution. |
| **Blocks push** | NO (fix in the same pass as B1 — it is two lines and B1's failure path hits it) |

#### M3 — MINOR — Any non-timeout error after provider dispatch maps to `failed`, which is sweep-refundable without consulting the provider journal

| Field | Content |
|---|---|
| **Severity** | MINOR (latent financial-exposure taxonomy defect; unreachable with the current fake provider) |
| **File:line** | `phase0/p3/wallet.ts:194-202` (`ProviderTimeoutError` → `uncertain` `:196`; **everything else → `failed` `:201`**); sweeper eligibility `:339-346` (`state <> 'failed'` blocks refund; `failed` does not); `phase0/p3/fake-provider.ts` — plain `Error` thrown **pre-charge** (`:76`), `ProviderTimeoutError` thrown **post-charge** (`:92`) |
| **Root cause** | The state machine encodes "unknown outcome" as a single exception class (`ProviderTimeoutError`) instead of "did the provider possibly charge?" — the only question that matters for refund safety. |
| **Concrete failure scenario** | A future real adapter throws a generic network error *after* the provider recorded the charge → attempt becomes `failed` → `sweepExpired` sees no non-`failed` attempt → refunds the operation → provider charge exists, customer refunded: unaccounted exposure that `reconcile.mjs` will **not** flag (the charge has a matching attempt — `charges-have-attempts` passes). With today's fake provider the scenario is unreachable: every post-charge failure is `ProviderTimeoutError` → `uncertain` → sweep refuses (`:339-346`), and every plain-`Error` path is pre-charge (nothing to protect). |
| **Consequence** | Latent duplicate-charge/refund exposure for the first non-fake provider integration; Phase 0 itself is safe. |
| **Reproducibility** | Logically demonstrated (code paths above); not reachable in current tests (no test uses a post-charge generic error). Marked **latent**, not observed. |
| **Smallest durable correction** | After provider contact has begun, only an explicit pre-charge rejection may map to `failed`; all other post-dispatch errors → `uncertain` (quarantine). Alternatively, document and enforce an adapter contract: "any error thrown after the request may have reached the provider must be `ProviderTimeoutError`-class", and enforce it at the provider interface boundary. |
| **Required regression test** | Add a fake-provider mode that records the charge and then throws a plain `Error`; assert the attempt lands in `uncertain`, `sweepExpired` refuses the refund, and reconciliation still balances. |
| **Blocks push** | NO (unreachable with the current provider; schedule with the next P3 change) |

#### M4 — MINOR — Attempt sequence numbering skips `failed` attempts → false `ConflictError` permanently blocks retry after a rejected attempt

| Field | Content |
|---|---|
| **Severity** | MINOR (fail-closed — no duplicate charge possible — but breaks retry-after-reject and misreports the cause) |
| **File:line** | `phase0/p3/wallet.ts:157-173` (prior-attempt count restricted to `('succeeded','dispatching','uncertain')` `:159`; `sequence = prior.n + 1` `:170`; unique violation mapped to `ConflictError` `:173`) vs `phase0/p3/schema.sql:38` (`UNIQUE (operation_id, sequence)`) |
| **Root cause** | Sequence allocation counts a subset of states while the unique constraint spans all rows. |
| **Concrete failure scenario** | Attempt 1 ends `failed` (fake-provider mode `'fail'` `:76`) → next `dispatchAttempt` computes `sequence = 1` again → unique violation → `ConflictError('concurrent dispatch conflict…')` at `:173` — every subsequent dispatch for that operation fails with a misleading race error. USD budget sum (`:164`) has the same state filter (failed attempts excluded from spend — defensible, since `'fail'` charges nothing). |
| **Consequence** | With any provider that can reject, retry (a core P3 capability) is dead after one rejection. Currently unreachable: no test sets mode `'fail'` (appears only in `runner.ts:47`, `fake-provider.ts:18,76`), and `'uncertain'`/`'dispatching'` are counted. |
| **Reproducibility** | Logically demonstrated from schema + query; not executed (DB tests out of review scope). Unreachable in the current suite. |
| **Smallest durable correction** | `sequence = coalesce(max(sequence), 0) + 1` over **all** attempts for the operation (single subselect), keeping budget/cap filters as they are. |
| **Required regression test** | Dispatch with mode `'fail'`, then dispatch again → must succeed with `sequence = 2`; `ConflictError` only on a genuine concurrent insert (existing race test). |
| **Blocks push** | NO |

#### M5 — MINOR — `settle()` can append a second `settle` row to an already-settled operation (terminal UPDATE row count unchecked)

| Field | Content |
|---|---|
| **Severity** | MINOR (ledger hygiene; no balance movement — settle never moves money — and unreachable in current paths) |
| **File:line** | `phase0/p3/wallet.ts:226` (entry guard permits `settled`), `:231-235` (insert keyed `(operation_id, kind, attempt_id)` via `ON CONFLICT`), `:236-247` (exact-replay path returns), `:253-258` (`UPDATE … SET billing_state='settled' WHERE … AND billing_state='reserved'` — **rowCount not checked**), `:259` (unconditional `COMMIT`); uniqueness key `phase0/p3/schema.sql:51-58`; reconcile blind spot `phase0/reconcile.mjs:117-121` (join drops settlements without a live attempt) |
| **Root cause** | The idempotent-replay design keys on the settlement triple, so a *different* attempt id is not a replay, while the state transition silently no-ops. |
| **Concrete failure scenario** | `settle(op, attemptA)` → state `settled`. `settle(op, attemptB)` → passes `:226`, insert **succeeds** (different key) → guarded UPDATE hits 0 rows → falls through to `COMMIT` → two `kind='settle'` rows for one operation; `settle-equals-attempt-cost` cannot see a settle whose attempt is absent from live `p3_attempt`. |
| **Consequence** | Settlement ledger can double-record without any balance effect or reconciliation flag. Reachability: no current call path settles twice with different attempts (same-attempt replay is tested and correct — `p3.test.ts:155`); crash-3 settles once. |
| **Reproducibility** | Logically demonstrated from the code; not executed (no DB in review scope); no current caller triggers it. |
| **Smallest durable correction** | After the terminal UPDATE, `if ((moved.rowCount ?? 0) !== 1 && inserted.rowCount > 0) throw new ConflictError(...)` — i.e., a newly inserted settlement must be accompanied by the state transition; or refuse entry when `billing_state === 'settled'` unless the insert conflicts (exact replay). |
| **Required regression test** | Settle the same operation with two different attempt ids → second call must throw `ConflictError`; assert exactly one `kind='settle'` row remains. |
| **Blocks push** | NO |

#### M6 — MINOR — HBA join-then-split round-trip can misidentify a quoted comma-bearing database/role token (narrow false-accept direction)

| Field | Content |
|---|---|
| **Severity** | MINOR (authentication-policy parsing that does not fail closed in one narrow, admin-config-dependent case; native mode only; fix cheaply in the same batch) |
| **File:line** | `phase0/provisioners/native.ts:210-227` — `toHbaRuleRow` re-joins `text[]` elements with `,` at `:213`; `fieldMatchesList` re-splits on `,` at `:131`; consumers `findApplicableHbaRule` `:148-177` → `assertHbaRequiresScram` `:180-187`, which gates `up()` (`:300`) and `verifyRuntime()` (`:355`); adjacent comment mismatch `:135-137` claims "failing closed with an explicit message" for unevaluated entries (regex/`+group`/`samerole`/`replication`) — those silently return `false` and fall through to the explicit no-match throw at `:173-176` (fail-closed in effect, but the message claim is inaccurate) |
| **Root cause** | PostgreSQL returns each `pg_hba_file_rules` token as one array element; the hba tokenizer (`next_token()` in `src/backend/libpq/hba.c`) allows double-quoted tokens **containing commas** (docs §20.1: quoting makes a word lose keyword meaning and match literally). `['phase0_x,other']` → joined `'phase0_x,other'` → split → `['phase0_x','other']`: element boundaries are lost. |
| **Concrete failure scenario** | An administrator writes `host "phase0_x,other" all 127.0.0.1/32 scram-sha-256` on an earlier line than the rule PostgreSQL would actually apply to `phase0_x` (e.g. a later `… trust`). PostgreSQL would skip the quoted rule for `phase0_x`; the harness selects it, sees `scram-sha-256`, and **accepts** — concluding SCRAM while the server actually applies the weaker later rule. The reverse direction (false reject) fails closed and is harmless. The *queried* values cannot contain commas (database regex `/^phase0_[A-Za-z0-9_]*$/`, `db-guard.ts:36`; user is the constant `phase0_rt`), so exposure is entirely on the rule side — the owner's `pg_hba.conf`. |
| **Consequence** | In a contrived but legal HBA configuration, the SCRAM demonstration could certify a rule PostgreSQL does not apply. Standard configurations (comma lists *between* elements, no quoted commas) parse correctly — the existing tests cover pre-joined strings and element lists (`provisioners.test.ts:95-96,266-275`) but **not** a single element containing a comma — again the circular-fixture pattern. |
| **Reproducibility** | Logically demonstrated against PostgreSQL's documented tokenizer and the code; **not executed** against a live server (review boundary: no DB operations). Marked UNVERIFIED live; the parser behavior itself is unit-testable without a server. |
| **Smallest durable correction** | Keep arrays end-to-end: `HbaRuleRow.database`/`user_name` stay `string[]` (drop the join at `:213`), and `fieldMatchesList` iterates elements directly (drop the split at `:131`). ~15 lines; `'all'`/`'sameuser'` semantics unchanged. |
| **Required regression test** | `toHbaRuleRow({database: ['phase0_x,other'], …})` then `findApplicableHbaRule(…, database 'phase0_x')` must **not** select that row; `['phase0_x']` must still match; multi-element arrays must behave exactly as today. |
| **Blocks push** | NO (prompt13 §9 explicitly says not to delay for minor parsing issues absent material consequence; recommended to land in the same batch as B1 because it is cheap and in the same "fail closed" spirit) |

### INFO (documentation, observability, future work — never blocking)

Every INFO item: severity **INFO**; blocks-push **NO**; scenario = the stated situation; consequence = as stated; reproducibility = source-verified; regression test = none required unless noted.

| # | File:line | Root cause / scenario / consequence | Smallest correction |
|---|---|---|---|
| I1 | `phase0/container-identity.ts:90`; `testcontainers.ts:127` | `IdentityPolicy.expectedDb` is **never read** by `assertContainerIdentity` — database identity is actually enforced by `db-guard.connectGuarded` (`db-guard.ts:194-214`, live `current_database()` vs URL) and `verifyLiveIdentity` (`:245-262`, used by `setup-db.ts:46`). Consequence: misleading API — a future caller may believe identity verifies the database name. | Either verify `expectedDb` against the identity evidence, or delete the field and document where DB identity is enforced. |
| I2 | `phase0/provisioners/native.ts:378-472` (no state-file removal; contrast `testcontainers.ts:209`); `provisioners/types.ts:123-125` | Native `down()` leaves `$TMPDIR/phase0-test-env.json` (mode 600). Scenario: stale file consumed by a later `cmdDown` → cross-execution teardown attempt — guarded by `execution_id` ledger scoping + database cross-check (`native.ts:396-414`, empty ledger → "nothing attributable"), and idempotent on retry; native state carries **no secrets** (no password field, `:327-333`). `writeFileSync`'s mode applies only at creation (an older world-readable file stays as-is). Consequence: cosmetic asymmetry only. prompt13 §9: do not delay for this. | `rmSync(stateFilePath(), { force: true })` at the end of native `down()`; optionally `chmodSync` on rewrite. |
| I3 | `phase0/provisioners/native.ts:277-279` | `clearContainerEnv()` runs **before** `assertContainerEnvAbsent()`, so the "fail closed if leaked" assertion can never observe a pre-existing leak — the leak is silently erased (safe direction: `db-guard` then sees `addrs: null` → strict loopback, `db-guard.ts:155-163,125-135`); `verifyRuntime` re-asserts later (`:340`). Consequence: comment/behavior mismatch; isolation itself is sound. | Reorder (assert, then clear) or reword the comment to "container context is removed, then asserted absent". |
| I4 | `phase0/reconcile.mjs:64-83,95-114` | If `P3_PROVIDER_LOG` is unset or missing, `journal = []` → `charges-have-attempts` and `journal-parseable` pass vacuously ("0 entries ok"). In run mode the path is always set and `rmSync`'d (`test-env.ts:156-157`) and reconcile runs only on `EXIT_PASS` (`:210-214`) — unreachable there; a manual invocation can print a green report with no journal. | Treat a missing journal as FATAL when P3 suites were expected (or stamp `journal-present: false` loudly in the report). |
| I5 | `phase0/p1/worker-schema.sql:4-8`; assertion only in `p1.test.ts` (`executionCount===1` at `:129,187,217,230,261,286,317`) | `p1_execution_log` has no unique index on `workflow_id`; exactly-once is test-asserted, not schema-enforced. Consequence: an SDK step retry (none configured today; SIGKILL evidence shows 1 execution) could double-log without a constraint catching it. | `CREATE UNIQUE INDEX … ON p1_execution_log (workflow_id)` (after confirming no legitimate duplicates) as defense in depth. |
| I6 | `phase0/p3/schema.sql:12-13`; `wallet.ts:65-66,162-164` | `max_input_tokens`/`max_output_tokens` are stored but never read — `dispatchAttempt` enforces only attempt-count and USD caps. | Enforce in the dispatch gate (one query change) or document the caps as recorded-only. |
| I7 | `phase0/AUTOMATED_TESTING_PLAN.md:128,139,156` vs `.github/workflows/*.yml` | Doc drift: plan says CI runs `npm run test:phase0` (actual: split `test:phase0:unit` + `test:phase0:integration` jobs); says known failure "pinned in the workflow" (actual: `phase0/vault-baseline.json`); says nightly driven by `PHASE0_SUITE=nightly` env (actual: `--repeat-suites --sigkill-loop 20` flags); promised failure notifications absent. | Update the plan text; no code change. |
| I8 | `.github/workflows/phase0.yml:62` | `--reporter=default --reporter=json` with a single `--outputFile=…`; vitest 4.1.8 documents dot-notation (`--outputFile.json=…`) for multiple reporters. UNVERIFIED (workflow not executed here). Job is `continue-on-error: true`, so worst case is a missing `app-suite.json` artifact, not a red build. | Specify `--outputFile.json=…` explicitly; confirm on first CI run. |
| I9 | `.github/workflows/phase0.yml:24-47` | `typecheck` and `unit` jobs upload no artifacts (others do) — observability only. | Add `if: always()` artifact upload if desired. |
| I10 | `phase0/setup-db.ts:66-117` | A failure after `CREATE ROLE`/grants but before `recordOwnership` (`:117`) leaves role+grants with no ledger rows → later `down()` reports "nothing attributable". No catch swallows the error (exit non-zero). Consequence: bounded — disposable namespace, documented runbook, idempotent re-run. | Record ownership rows transactionally with the DDL, or document the leftover-role cleanup in the runbook. |
| I11 | `phase0/p3/runner.ts:6,68`; `wallet.ts:90-93,154-156` | Crash point `after-settle` exists but is absent from the header list (`none\|after-reserve\|after-dispatching\|before-settle`); `reserve` reports `'already-reserved'` for *any* non-`unbilled` state, so a runner re-run on a settled operation proceeds to `dispatchAttempt` and dies with a confusing `ConflictError` (fail-closed; no current test does this). | Document the crash point; map settled/refunded reserve results to an explicit "already terminal" outcome in the runner. |

---

## C. Docker provenance assessment

**Central question: does the new implementation establish pinned-image-to-running-container identity when `RepoDigests` is absent? — YES, under an explicitly documented Docker-daemon trust boundary. The chain is sound; the loopback sub-check is not (B1).**

**Chain traced (each link, what it proves, what it does not):**

1. **Pin** — `PG_IMAGE = 'postgres@sha256:30551eca…d3ce'` (`testcontainers.ts:32`), manifest-list digest, shape enforced by unit test `test-env.test.ts:17-18`. *Proves:* immutability of the request. *Not:* content (a digest is a promise until resolved). Residual INFO: digest shape is enforced only at test level, not re-asserted at runtime in `up()`.
2. **Pull/resolution** — Testcontainers passes the string **verbatim**: `createOpts = { Image: this.imageName.string }` (`generic-container.js:55-56`; `image-name.js` preserves `postgres@sha256:…`), default pull policy pulls only when missing (`pull-policy.js` default `shouldPull() === false`; `generic-container.js:66-75`), platform passed from `createOpts.platform`. The container's `Config.Image` therefore equals the pin — but `Config.Image` is *only the requested string*, and the code correctly does **not** treat it as content proof: it is used solely for exact equality (`container-identity.ts:280-282`).
3. **Image object registration** — `docker image inspect postgres@sha256:<index-digest>` (`:365-368`) resolves through daemon content addressing (index → platform manifest → config) to a local image whose ID is returned (`:294-297`). Docker's image ID **is** `sha256:` of the image *config* JSON, which embeds `rootfs.diff_ids` (the layer digests) — so ID equality transitively binds the full layer set. This is the load-bearing link and it is *daemon behavior* — documented as such in the code (`:291-293`, `:306-308`, file header).
4. **Container creation** — container's top-level `Image` field is the image ID used at create time; checked equal to the image inspected **by that ID** (`:287-289`) and equal to the image resolved **from the pin** (`:295-297`). Three-way equality: container ↔ content ↔ digest. Distinction correctly maintained: index digest (the pin), config digest (the local image ID) — the code never claims they are the same string; it proves they *resolve to each other* via the daemon.
5. **Platform** — `Architecture`/`Os` of the resolved image vs the runner (`expectedRunnerArch()`, `:117-126`, closed set, unknown arch throws) at `:301-304`. Multi-platform images: the daemon selects the entry for the runner's platform; an unexpected selection is rejected (tests `:164-172`).
6. **`RepoDigests` demoted to a consistency signal** — image-level only (`parseImageInspection:213-216`; `@types/dockerode` confirms the field exists on `ImageInspectInfo:924`/`ImageInfo:363` and **not** on `ContainerInspectInfo:580` — the reported root cause of the old CI failure is independently confirmed). Absent → accepted and recorded (`:309`, test `:174-180`); present-but-missing-our-pin → rejected (`:310-315`, test `:182-187`); registry-prefix normalization prevents `evil.io/postgres@<same-digest>` spoofing (`:232-249`, test `:189`).
7. **Execution binding** — fresh `newRunId()` label checked at inspect time (`:270-275`); identity is always evaluated against the container **just created** (`testcontainers.ts:124` uses `container.getId()`), container reuse never enabled, so a stale container from an aborted run cannot be mistaken for the current one even if `PHASE0_RUN_ID` were preset.
8. **Fail-closed everywhere** — missing/malformed inspect payloads throw `ContainerIdentityError` (`parseInspection:145-193`, `parseImageInspection:196-218`; tests `:233-258`); the `docker` invocation uses `execFile` with an argv array (no shell, 30s timeout, JSON-parse failure rejects) (`:128-139`); no catch anywhere converts a rejection into a permissive path (the only `try/catch` in `up()` wraps container *start*, `testcontainers.ts:100-113`).

**Required adversarial attack cases:**

| Attack | Outcome | Evidence |
|---|---|---|
| Missing pinned digest | Pin shape enforced by unit gate; `Config.Image` non-empty required | `test-env.test.ts:17-18`; `container-identity.ts:159-161` |
| Mutable tag instead of digest | Rejected at unit gate (identity would accept a tag only if `RepoDigests` were also empty — see residual note above) | `test-env.test.ts:17-18` |
| Wrong digest | Reject: resolution mismatch `:295-297` / creation-image mismatch `:280-282` | tests `:150-155`, `:144-148` |
| Wrong platform | Reject `:301-304` | tests `:164-172` |
| Wrong configuration digest | Reject `:287-289` (image-inspect-by-id ≠ container image id) | test `:157-162` |
| Mismatched local image ID | Reject `:295-297` | test `:150` |
| Container from unexpected image | Reject `:280-282` | test `:144` |
| Wrong/absent execution label | Reject `:270-275` | tests `:126-142` |
| Existing container from another run | Cannot be selected — identity inspects the just-created container id; fresh run label; no reuse | `testcontainers.ts:124`; `:270-273` |
| Public/wildcard port binding | **Reject `:321-325` — but this is B1: legitimate Testcontainers output triggers it; the *binding itself* is not loopback (unmet requirement)** | test `:110-113`; §B B1 |
| Unrelated private (RFC1918) server address | Reject — exact container-interface match only (`matchServerAddress`, `:377+`), fed to `db-guard` server-view policy (`db-guard.ts:125-135,155-163`, decisions at `:213-214`, `:253-254`); native mode cannot inherit container addrs (§E, I3) | tests `:95-108` |
| Missing Docker inspection data | Fail-closed `ContainerIdentityError` | tests `:233-246`; `dockerInspectJson:128-139` |
| Malformed/ambiguous inspection | Reject at parse (bad `Id`/`Image`/`Ports`/binding/image payload) | tests `:233`, `:239`, `:248`, `:254` |
| Multi-platform resolving to unexpected platform | Reject `:301-304` (+ RepoDigests consistency when present) | tests `:164-172`, `:199-208` |

**Test-independence verdict:** 26/26 pass and the case coverage is real (each rejection has a distinct test with a mutated fixture), but the fixtures are shaped by the same assumptions as the implementation — the loopback fixture hardcodes `127.0.0.1` (`container-identity.test.ts:46`) while real Testcontainers output is `0.0.0.0`. Prompt13's circularity warning is therefore **confirmed, with exactly one concrete counterexample: B1**. All other attack cases were re-derived from code, not from test names.

**What relies on Docker daemon trust (accepted, documented):** daemon honesty in content addressing, registry transport integrity, and local layer-store integrity. No client-side check can defend against a compromised daemon, and independent registry calls would re-verify the same manifest the daemon already fetched — they solve no actual gap here (prompt13 §3 line 165). The code documents this boundary at `:291-293`/`:306-308` and in the file header.

**UNVERIFIED until the first CI run (fail-closed paths):** (1) `docker image inspect postgres@sha256:<index>` resolution on a fresh runner — if unsupported, the run fails loudly (`:131-139`), it cannot pass wrongly; (2) actual `RepoDigests` content after a real pull — absent → accepted per design, present-but-mismatched → rejected; (3) the empirical half of B1 (exact `HostIp` representation) — no Docker CLI exists on this machine; both possible representations are rejected.

---

## D. Financial and workflow integrity

**P1 (atomic enqueue, workflow identity):** the fix is correct.
- Identity comes from the authoritative DBOS context: `DBOS.workflowID` (`worker.ts:55`), missing → `throw` (`:56`) → workflow fails before any log write (fail-closed). The workflow **ignores** its payload input (`:54`), so no caller-supplied identifier can reach the step — the historical `workflowRunTag`/`undefined` NOT NULL defect and its six timeouts are documented at `:27-44` and structurally impossible now.
- Enqueue is atomic with the business row: `enqueueInCallerTransaction` inside the caller's transaction with `workflowIDReusePolicy: 'return-existing'` (`dbos-adapter.ts:87-102`); id derived deterministically from the business key (sha256 → UUID, `handler.ts:52-59`), never from payload fields.
- Dedup/convergence: `p1_business_event.business_key PRIMARY KEY` + `workflow_id UNIQUE` (`p1/schema.sql:5,10`); `ON CONFLICT (business_key) DO NOTHING` + `FOR UPDATE` duplicate path, hash-mismatch → conflict (`handler.ts:131-158`), invariant throw `:150`, generation renewal guarded by `(business_key, generation)` + rowCount (`:172-190`) — expired tombstones cannot double-advance. Rollback leaves neither business row nor workflow registration (enqueue shares the transaction). Evidence: P1-RACE/ROLLBACK/REUSE/EXPIRY/VANISH rows all PASS in the matrix (lines 51-63), artifacts preserved under `phase0/evidence/`.
- Residual: I5 (no unique index on `p1_execution_log`); adapter does not validate `req.workflowId` presence (`dbos-adapter.ts:97`) — handler always supplies it (INFO only).

**P3 (wallet, attempts, recovery):** invariants hold on reachable paths; four weaknesses deferred (M1, M3, M4, M5).
- Reservation: operation row locked first, then wallet (documented order `wallet.ts:73-76`), conditional `UPDATE … WHERE billing_state='unbilled'` + rowCount check (`:103-107`), balance under lock (`:94-98`), reserve settlement row (`:108`) — concurrent-reserve single-debit proven by test (`p3.test.ts:285-293`) and constraint (`schema.sql:57`).
- Dispatch: pre-contact gate in one transaction — state must be `reserved`, attempt cap and USD cap enforced, `dispatching` row durably inserted *before* provider contact (`:145-176`); this closes the sweeper/disppears race (comment `:140-144`).
- Settlement: exactly-once via `UNIQUE NULLS NOT DISTINCT (operation_id, kind, attempt_id)` (`schema.sql:51-58`) + `ON CONFLICT DO NOTHING` + replay amount comparison (`wallet.ts:231-247`); explicit `$2::text`/`$3::bigint` casts present at `:255` (the reported fix). Weakness M5 (unchecked terminal rowCount).
- Uncertainty: `ProviderTimeoutError` → `uncertain`, never auto-retry (`:194-196`, comment `:195`); stale-dispatching recovery quarantines with `RETURNING` rowcount (`:281-286`) and the runner **refuses** while unresolved attempts exist (`runner.ts:36-41`, exit 3, tested `p3.test.ts:110-112`); sweep re-checks eligibility inside the operation lock (`:333-346`), refuses when any non-`failed` attempt exists, verifies the refund transition rowCount (`:351`), and pulls the refund amount from the reserve settlement row (`:352-356`).
- Crash safety: journal charge is the external truth (`fake-provider.ts:12-13`); SIGKILL 20/20 with `total=11 passed=1` per iteration and reconcile PASS (30 charges ↔ 30 journal entries, 0 settlement mismatches, no negative wallets) is preserved in the run artifacts (`summary-…03-19-34….md`, `reconciliation-…03-19-34….json`, matrix rows TB-SIGKILL20/TB-RECON) — I inspected the JSON verdicts, not just the matrix cells.
- **Explicit answer to prompt13 §2/§3:** no reachable path converts uncertainty into an unsafe retry or automatic refund *with the current provider* — the two reachable failure modes (timeout → quarantine; pre-charge rejection → `failed` with nothing charged) are safe; M3 is the latent path for future adapters; M1 is the archive-scoping gap whose cross-execution masking scenario is unreachable under the current harness (UUID operation ids, per-execution journal `rmSync`, archive populated only from same-database live rows).

---

## E. Database safety

- **Guard:** `db-guard.ts` reviewed end-to-end — loopback-only host with **no override variable by design** (`:9-11`), disposable database regex (`:36`), query-param allowlist (rejects `host/port/dbname/user/password/options` redirection, `:12-14`), dangerous `PG*` env unset (`:15-16`), and live server-view verification on the actual connection (`connectGuarded:194-214`, `verifyLiveIdentity:245-262`). Container mode feeds the exact verified container interfaces (`testcontainers.ts:133-134` → `db-guard.ts:155-163`); native mode removes that context first (I3 for the comment nit) → strict loopback. No path accepts a different server merely because it has a private IP (test `container-identity.test.ts:102-108`).
- **Port binding:** see **B1** — this is simultaneously the Priority-1 and database-safety blocker.
- **HBA/SCRAM:** first-match-wins is correct and tested (`provisioners.test.ts:225-295`); `pg_hba_file_rules` parse errors fail closed (`native.ts:155-160`); no matching rule → throw (`:173-176`); verifier format checked against `pg_authid` (`native.ts:81-99`, tests `:200-208`). Remaining parsing risk: **M6** (comma round-trip; narrow false-accept), plus the comment/behavior mismatch at `:135-137`.
- **Provisioner isolation:** native `up()` performs **no DB mutation** (role/grants/ownership live in the separate `setup-db.ts` spawned only after `up()` succeeds, `test-env.ts:129`); container env vars cleared before any native work (`native.ts:278-279`); `verifyRuntime` re-asserts absence (`:340`); CLI refusals (unknown provisioner / no URL / non-loopback URL → exit 2) tested at `provisioners.test.ts:447-465`.
- **Ownership teardown:** ledger-scoped and FK-aware — drop candidates = ledger ∩ present tables (`ownership.ts:126`), transitive blocker fixpoint (`:68-102`) demotes blocked drops to `retained` with the blocking child named (`:135-141`); pre-existing tables get only run-namespaced `DELETE`s with LIKE-escaping (`native.ts:440-449`, `ownership.ts:50-52`) or nothing (`ownership.ts:143-149`); identifier quoting charset-checked (`native.ts:189-196`); empty ledger → "nothing attributable, nothing deleted" (`native.ts:403-414`); ledger rows deleted last, so a mid-teardown failure leaves them intact and the plan re-derivable (idempotent retry); a failing statement stops the run (no swallow) and `test-env` keeps the original verdict (`test-env.ts:230-233`). Evidence: TB-TEARDOWN 13 `cleaned` lines (11 prototype tables + ledger), 0 `retained`, preserved in the run artifacts.
- **State file:** mode `0600`, but `mode` applies only at creation (`types.ts:123-125`); native `down()` leaves it (I2 — assessed non-material per prompt13 §9: no secrets in native state, cross-execution effects guarded, cleanup idempotent).
- **Mid-setup failure:** `native.up()` cannot leave partial DB state (it mutates nothing); `setup-db.ts` failures leave role/grants with no ledger rows (I10 — bounded, fail-loud); container `up()` post-start failure orphans the container (M2).

---

## F. Portability assessment

- **No accidental provider coupling found:** grep over `phase0/` and `.github/` for `neon|supabase|cockroach|planetscale|timescale|tiger` → zero matches. Nothing Neon-specific has entered application or Phase 0 code.
- **Classification of what exists:** (a) *harness-only, PG-server-administration-dependent* — HBA rule reading (`pg_hba_file_rules`), SCRAM verifier inspection (`pg_authid`), `password_encryption` GUC, ownership ledger, `BEFORE TRUNCATE` trigger (`p3/schema.sql:103-105`), native teardown DDL. These are inherently unsuitable for managed providers that don't expose server configuration — already acknowledged in the code/docs; they must stay out of application paths (today they do: `native.ts` only). (b) *standard-PostgreSQL application semantics* — `FOR UPDATE`, `ON CONFLICT … DO NOTHING`, `jsonb_build_object`, `make_interval`, partial/unique indexes: portable across PostgreSQL-family providers, **not** automatically CockroachDB-portable (SERIALIZABLE-versus-MVCC `FOR UPDATE` semantics, trigger support — e.g. no `BEFORE TRUNCATE` triggers — and the settlement `UNIQUE NULLS NOT DISTINCT` key `p3/schema.sql:51-58` are known CRDB divergences). (c) *DBOS operational requirements* — SDK-owned tables/queue semantics, orthogonal to provider choice.
- **Only material flag:** the P3 settlement uniqueness key and the archive trigger are the two constructs that would need redesign first on CockroachDB-class targets; both live in harness/suite code today, so the coupling cost of a future adapter remains low. No ORM or vendor-neutral query layer is proposed (explicitly out of scope).

---

## G. Evidence and test coverage

**Executed by this reviewer (all non-destructive, repository-state-preserving):**

| Check | Command | Outcome |
|---|---|---|
| Phase 0 typecheck | `npx tsc -p phase0/tsconfig.json --noEmit` | **exit 0, zero errors** |
| Unit suite | `npm run test:phase0:unit` | **6 files, 131/131 passed, 8.18s, exit 0** — independently confirms matrix B-UNIT (`EVIDENCE_MATRIX.md:22`), including the 26 container-identity and 37 provisioners cases; count history 83→111→120→131 consistent (`:22` Notes) |
| Baseline/diff | `git status`, `git branch`, `git rev-parse`, `git diff HEAD --stat`, `git log` | branch `phase0/automated-testing`, HEAD `dd40238`, 15 modified files (+790/−104), **0 deletions**, nothing committed/pushed |
| Evidence preservation | `git status --porcelain`, artifact listing | Failed runs `…02-30-13…` (29 files, `Verdict: FAIL`) and `…02-59-51…` (30 files, `Verdict: FAIL`) fully preserved; current `…03-19-34…` (30 files) `Verdict: PASS`; historical FAIL evidence untouched |
| Dependency claims | source/type inspection of `testcontainers@12.2.1`, `@testcontainers/postgresql@12.2.1`, `@types/dockerode` | `RepoDigests` image-only (`:924`/`:363` vs `ContainerInspectInfo:580`); verbatim image string (`generic-container.js:55-56`); default pull-only-if-missing; `PortBindings` without `HostIp` (`:305-319`); creation hook `:79-81` precedes `HostConfig` merge `:141-142` — all confirmed from installed sources |
| Secrets | pattern scans over tracked files | No real credentials: only `.env.example` placeholder, runbook substitutions, and test fixtures (`hunter2`, `bootpw`, `rtpw123`); no `AKIA/sk-/ghp/BEGIN PRIVATE KEY` hits; no URLs with passwords under `phase0/evidence/` |
| Redaction | prompt11 §B-4 grep over this report | clean (no `.env` contents, no passwords/URLs with credentials) |

**Could not run / UNVERIFIED (and why):**
- **Any Docker/container behavior** — no `docker` CLI on this review machine (documented in `RUNTIME_VERDICT.md`; I re-confirmed `command not found`). B1's mechanism is source-demonstrated; the inspect representation, digest-ref inspection on a real daemon, and RepoDigests content are UNVERIFIED until CI.
- **Any database-backed test** (P1/P3/backpressure/reconcile/teardown live) — review boundary forbids DB operations; those claims were verified against preserved artifacts (verdict JSONs inspected) and code, not re-executed. `vitest` was **not** run with the phase0 config directly (it would include DB-gated files); only the explicit `test:phase0:unit` file list was executed.
- **Workflows** — triggers are master-only (`phase0.yml:11-15`); nothing runs for this branch until the authorized push/PR.
- **Matrix conflation checks (all pass):** 131/131 is current-code state, executed here; the native run's own report says **120/120** (`docs/plans/prompt11_imp.md:13,112`) — the older execution is *not* misrepresented as 131/131; CI-CONTAINER remains `FAIL (observed)` with "awaiting authorizing push + CI run to flip" (`EVIDENCE_MATRIX.md:32`); P2 rows remain `BLOCKED` pending staging approval (`:93-95`); `vault.test.ts` (real file: `server/lib/vault.test.ts`) is untouched and pinned via `phase0/vault-baseline.json` + `baseline-gate.mjs` (B-SUITE correctly `FAIL (pre-existing)`); `ENVIRONMENT.md`/`RUNTIME_VERDICT.md` keep their sandbox-scoped EPERM verdicts with a scoped 2026-11-15 addendum for the owner-Mac native run (+11 lines each; original text preserved — no conflation, no deletion).

---

## H. Minimum remediation plan

Required to clear the blocker (small, surgical):

1. **B1** — loopback host-IP binding: add the `LoopbackPostgreSqlContainer` subclass overriding `beforeContainerCreated()` to set `HostIp: '127.0.0.1'` on existing `PortBindings` entries (~8 lines in `testcontainers.ts`), use it at `:101`, plus the unit test asserting the hook's effect. Do **not** relax `container-identity.ts:321-325` — the check is correct; the binding is what must change.
2. **M2 (same pass, 2 lines)** — stash the container handle immediately after `.start()` (`:107`) so B1-style post-start failures and readiness/SCRAM failures can still be torn down.

Strongly recommended in the same batch (cheap, same fail-closed theme):

3. **M6** — array-based HBA matching (~15 lines + 2 tests): keep `database`/`user_name` as `string[]` end-to-end; fix the `:135-137` comment.

Explicitly **not** required for push (schedule after CI is green): M1, M3, M4, M5; INFO items I1–I11 as polish (I8 worth a glance during the first CI run).

Post-fix validation (the review is not a substitute for CI evidence): authorize the push, then watch the first integration run for — identity line printed (`identity: container … verified`) with no `not loopback-only` FATAL; `docker image inspect <manifest-list digest>` resolution; `RepoDigests` content; `localhost` connectivity against the loopback-only bind; absence of an orphaned container on any failure; `app-suite.json` artifact produced (I8); CI-CONTAINER flipping only on observed green.

---

## I. Next decision

**Do not authorize the branch push yet.** Land remediation step 1–2 (B1 + M2), preferably 3 (M6), then re-run the two sanctioned gates (`npx tsc -p phase0/tsconfig.json --noEmit`, `npm run test:phase0:unit` with the new hook test) and authorize the owner to push — after confirming Git author identity — to obtain the real GitHub Actions Testcontainers run. Only an observed green CI integration job flips CI-CONTAINER and closes Priority 1; this review's `FIX BEFORE PUSH` verdict is not a substitute for that evidence.
