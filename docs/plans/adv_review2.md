# Independent Adversarial Code Review — Phase 0 Remediation (B1, M2, M6)

Review assignment: `docs/plans/prompt14.md`. Reviewer: independent senior architect (not the implementation agent).
Subject: branch `phase0/automated-testing`, baseline HEAD `dd40238`, uncommitted working tree
(15 modified files, +1243/−176; ~93 untracked: 90 `phase0/evidence/` artifacts, `docs/plans/`,
`docs/architecture/`, `deepwiki.md`, `phase0/prompt12.md`).
Review mode: read-only; no commits, no pushes, no Docker, no database operations, no `.env` access,
no evidence deletion, no source modification.

---

## A. Executive verdict

**READY FOR OWNER-MANAGED PUSH — DOCKER VALIDATION PENDING**

All three fixes are genuine at source level, the 150/150 unit suite and both typechecks were
independently executed green, and no CRITICAL or MAJOR defect remains. Two non-blocking items
(one MINOR, one INFO) plus one DOCKER-PENDING watch item are recorded below. This is not a claim
that Docker integration has passed: live loopback binding, live stop-on-failure, and the
provenance chain still require the CI run.

---

## B. B1 — loopback binding review

**Durable. SOURCE-VERIFIED + UNIT-TESTED; live Docker proof DOCKER-PENDING.**

Hook correctness (all checked against installed Testcontainers 12.2.1): the override signature is
correct — base declares `protected beforeContainerCreated?(): Promise<void>`
(`node_modules/testcontainers/build/generic-container/generic-container.d.ts:36`), so `override`
compiles today and fails loudly if a future version removes or renames the hook. The hook is
awaited after pull and before `client.container.create({...createOpts, HostConfig: this.hostConfig})`
(`generic-container.js:79-81` vs `:141`); only `ExtraHosts`/`NetworkMode`/`Labels` are touched
after it, so nothing overwrites `PortBindings`. `PostgreSqlContainer`'s constructor populates
`{'5432/tcp': [{HostPort: '0'}]}` via `withExposedPorts` with no `HostIp`
(`generic-container.js:305-319`, `@testcontainers/postgresql/.../postgresql-container.js:36-38`),
and `PortWithBinding` has no IP field (`utils/port.d.ts:1-6`) — the "no public API" claim is
accurate. `up()` calls no port-touching builder after construction. `dockerode`
`PortBinding.HostIp` is optional (`@types/dockerode/index.d.ts:1157-1160`). The single production
construction site uses the subclass (`phase0/provisioners/testcontainers.ts:261`); no bypass exists.

Binding correctness: the hook (`testcontainers.ts:53-79`) iterates every key of `PortBindings`,
throws on missing/empty/non-array/non-object shapes (fail-closed), mutates entries in place so
Docker receives the change, preserves all other `HostConfig` fields, and unconditionally
overwrites — an explicit `0.0.0.0` cannot survive. No structure can evade it: reached objects get
`HostIp`, anything else throws. The fail-closed direction is robust to dependency drift: if a
future version stops populating bindings or moves fields, the hook throws instead of creating a
wildcard container.

Security invariant: `phase0/container-identity.ts:317-328` step 7 is unchanged — every 5432
binding must be in `{127.0.0.1, ::1}`, the URL port must be among them. `0.0.0.0`, `::`, empty,
public, and RFC1918 bindings all still reject, and `matchServerAddress` is untouched. The
verifier was not weakened.

Tests: all seven B1 tests (`provisioners.test.ts:538-621`) exercise the real subclass and real
hook (protected access via cast, not fixtures). The `[{HostPort: '0'}]` precondition matches
dependency source line-for-line, and the hook-output-fed-to-verifier test takes `HostIp` from the
hook's own mutation. Not circular.

Connectivity (`localhost` vs `::1`): `container.getHost()` returns `"localhost"` on unix-socket
CI (`container-runtime/utils/resolve-host.js:30-41`), and `pg` passes no `family`/`autoSelectFamily`
options (`pg/lib/connection.js:42`, `pg/lib/client.js:172-174`), so Node 22 connection defaults
decide. Reviewer demonstrated `localhost` resolving `::1`-first on this machine
(`[{::1,6},{127.0.0.1,4}]`, default lookup → `::1`); glibc RFC 6724 sorting makes that likely on
Linux CI too. Classification: **plausible but unverified platform risk, low likelihood** — Node
20+ `autoSelectFamily` racing (documented default true) should fall back to `127.0.0.1`
transparently, and any failure is loud fail-closed (readiness timeout, exit 2), never silent. The
fallback half could not be behaviorally confirmed here (sandbox blocks listen sockets with EPERM;
not retried per sandbox policy). Smallest correction if CI ever shows it, one line, not to apply
now: map exact `'localhost'` → `'127.0.0.1'` in `provisionStartedContainer` before `buildUrl`.

---

## C. M2 — lifecycle and cleanup review

**Durable for its stated boundary. SOURCE-VERIFIED + UNIT-TESTED; live stop DOCKER-PENDING.**

State transitions traced (`phase0/provisioners/testcontainers.ts:86-131,193-279`): `.start()`
returns → `withStartedContainer` stashes synchronously before the task runs, so no post-start
exception can precede handle retention (only a synchronous call frame separates them). Identity,
readiness, SCRAM, state-file write, and env assignment all execute inside the guarded task — every
post-start failure reaches `stopStashedContainerBestEffort`, which never throws, so the primary
error always propagates intact. Success keeps the handle for `down()`; repeated successful cleanup
is a no-op via take-and-clear. Double-stop is impossible across the only two consumers (failure
path, `down()`), and `StartedGenericContainer.stop` is internally lock-serialized and idempotent
anyway (`started-generic-container.js:40-50`). Single-process global-handle state is safe under the
actual orchestrator (one `up()` per process; failed `up()` exits, so stale
`PHASE0_VERIFIED_ADDRS` cannot leak into another provisioner). No orchestrator change was needed:
`test-env.ts:225` skips `down()` when `state` is null, which is now correct because `up()` cleans
up internally.

All seven lifecycle tests (`provisioners.test.ts:623-730`) use the real helper with fake
containers and assert the right outcomes. The helper mechanics are UNIT-TESTED; the wiring (all
fallible steps inside the task) is SOURCE-VERIFIED.

Precise boundary: the helper protects only failures **after** `.start()` returns. Testcontainers'
own `startContainer` has no cleanup around wait-strategy failure, so in-`.start()` failures rely
on the Ryuk reaper (default on), not on this code. That matches the report's claim; do not
overstate it.

### Finding M2-R1 — MINOR, non-blocking

| Field | Content |
|---|---|
| **Severity** | MINOR (cleanup-diagnostic gap on an already-rare path; bounded by reaper; primary error preserved) |
| **File:line** | `phase0/provisioners/testcontainers.ts:105-115` (`takeLiveContainer` at `:106` before `stop()` at `:109`) |
| **Root cause** | Take-before-stop: the handle is cleared before the stop attempt, so if `stop()` itself throws, the handle is gone — no retry possible — and the stderr line carries only a 200-char message with no container id. |
| **Concrete failure scenario** | Post-start failure (e.g. readiness timeout) → cleanup `stop()` hits a transient Docker API error → container keeps running, handle discarded, `down()` later reports "no live handle"; operator must find the container by label (`openlevel.phase0.disposable=true`) or rely on the reaper. |
| **Consequence** | Orphaned PostgreSQL container until reaper/manual removal; on ephemeral CI negligible, on a dev machine a manual `docker rm`. No data, security, or correctness impact; the primary error is never masked. |
| **Evidence** | Source-proven (read the helper); live stop failure UNVERIFIED (no Docker here). |
| **Smallest durable correction** | On `stop()` failure, re-stash the handle and include the container id/name in the diagnostic line. Compatible with all existing M2 tests (success-path idempotency test unaffected). |
| **Required regression test** | Failing-stop fake → second cleanup attempt retries (`stops === 2`), or handle remains available after failed cleanup. |
| **Blocks push** | NO — schedule with the next container-path change. |

---

## D. M6 — HBA token preservation review

**Durable. SOURCE-VERIFIED + UNIT-TESTED.**

`database`/`user_name` stay `string[]` through `toHbaRuleRow` (`native.ts:216-238`: arrays pass
through element-wise, scalars become single elements, null becomes `[]`) and `fieldMatchesList`
(`:132-145`) iterates elements with exact/`all`/`sameuser` semantics — no join-then-split path
remains in any matching layer (`options` is joined but strictly display-only; `formatHbaRule`
callers are error text `:188`, one log line `:264`, and evidence JSON `:328` only). A quoted
`['phase0_x,other']` cannot match `phase0_x` on either field. `all`, `sameuser` (db==user,
database field only, per PostgreSQL), multi-element lists, first-match-wins including
weaker-first, TLS-family selection, null/malformed fail-closed, and unsupported-construct
fall-through are all preserved; `pg_hba_file_rules` `text[]` values are treated as pre-parsed
tokens with no second tokenizer. All five comma regression tests
(`provisioners.test.ts:314-356`) exercise the real `toHbaRuleRow` + `findApplicableHbaRule` in
both directions (false-accept blocked, true matches kept), and existing first-match-wins/TLS
tests remain green in the executed run.

Track B note: the native run exercised the pre-M6 code, but only on standard configs where old
and new behavior is provably identical (unit-covered); the changed path (quoted commas) is covered
by the new unit tests. No Track B claim is extended to untested behavior.

---

## E. Cross-cutting regressions

No weakening found. Image provenance was strengthened, not weakened (prompt12 chain: exact
`Config.Image` match, image-id resolution equality, platform pin, RepoDigests consistency signal);
reviewer verified `ImageName.fromString('postgres@sha256:…')` round-trips the string verbatim
(`image-name.js`: no `/` → no registry → `${image}@${tag}`), so step 2's exact match is sound, and
a hypothetical hub-prefix override would fail closed. Port/interface/label policy, SCRAM
requirements, `db-guard.ts` (unmodified), native strict-loopback path (native diff is HBA + FK
teardown only), ownership teardown (FK-ordered drops added, unit-tested), P1/P3 substrate fixes
(all Track B–executed), and provider-uncertainty paths (unmodified files) are intact. HBA logic
stays in the native provisioner. Evidence history is append-only.

### Finding DOC-1 — INFO, non-blocking

| Field | Content |
|---|---|
| **Severity** | INFO (stale doc comment understating a security control) |
| **File:line** | `phase0/container-identity.ts:47-51` ("Known limitation" header) |
| **Root cause** | Header still says loopback "cannot be ENFORCED at creation — VERIFIED post-hoc." Post-B1 that is false: enforcement happens at creation via the hook, with post-hoc verification as defense-in-depth. |
| **Consequence** | Could mislead a future maintainer into removing the hook as redundant. No runtime effect. |
| **Evidence** | Source-proven by direct contradiction with `testcontainers.ts:53-79`. |
| **Smallest durable correction** | One-paragraph header update. |
| **Blocks push** | NO. |

---

## F. Validation results and evidence classification

Executed with the user-local Node v22.23.5 (found at `~/.local/node/bin`, absent from default
PATH):

- `npx tsc -p phase0/tsconfig.json --noEmit` → exit 0, zero errors.
- `npm run typecheck` → exit 0.
- `npm run test:phase0:unit` → **150/150 passed, 6 files, 8.99s, exit 0**: 58 guard + 2 outcome +
  4 orch + 4 gate + 26 container-identity + 56 provisioners — exactly the matrix breakdown;
  provisioners +19 = +7 hook, +7 lifecycle, +5 HBA. Script verified Docker-free (vitest over six
  DB-independent files matching `UNIT_TEST_FILES`; spawned CLI probes exit 2 before any socket).

Classification: B1/M2 mechanics SOURCE-VERIFIED + UNIT-TESTED; live Docker behavior
DOCKER-PENDING. M6 standard-config behavior PREVIOUSLY DATABASE-VERIFIED (Track B
run-2026-11-15T03-19-34-525Z-29438) + comma delta UNIT-TESTED. Nothing material is UNVERIFIED
except live Docker execution, which is CI's job by design.

---

## G. Remaining Docker-only uncertainties

Live 127.0.0.1 publication as seen by `docker inspect`; live stop-on-post-start-failure;
image-chain resolution of the manifest-list digest on the CI daemon; `localhost`→`127.0.0.1`
connection on the runner (watch item, §B). The upgrade-timing residual (a future Testcontainers
calling the hook after creation) cannot be guarded statically but would fail closed at the
identity check. All are CI-observable within one run.

---

## H. Deferred findings (M1, M3, M4, M5), unchanged

Confirmed still open in current source via diff inspection (their regions are unmodified): M1
archive/reconcile not execution-scoped (`reconcile.mjs` still existence-matches live UNION
archive, no `attempt_id` join); M3 post-dispatch generic errors → sweep-refundable `failed`
(`wallet.ts:194-202` mapping untouched); M4 sequence numbering skips `failed` (`wallet.ts:157-173`
untouched); M5 double-settle with a second attempt id (terminal UPDATE rowcount still unchecked).
All MINOR, all unreachable in the current harness, none blocking, none expanded here. See
`docs/plans/adv_review.md` §B for full records.

---

## I. Git state and evidence-matrix accuracy

Branch `phase0/automated-testing`, HEAD `dd40238` (matches baseline). **The "four changed files"
describe remediation-vs-post-Track-B-tree, not vs `dd40238`: the worktree holds 15 modified files
(+1243/−176) plus ~93 untracked** (90 `phase0/evidence/` artifacts, `docs/plans/`,
`docs/architecture/`, `deepwiki.md`, `phase0/prompt12.md`). The owner must curate the commit —
nothing is staged, nothing is pushed, and this review must not be mistaken for a push-ready
commit. Matrix checks: 150/150 current unit accurate (independently executed); native run still
recorded as 120/120 in `docs/plans/prompt11_imp.md:13,112` with matrix history
`83→111→120→131→150`, no conflation; CI-CONTAINER still blocked pending CI; P2-T1..T5 still
BLOCKED on Gate D; `vault.test.ts` untouched with baseline-gate 4/4 green;
`ENVIRONMENT.md`/`RUNTIME_VERDICT.md` addenda append-only (+11 lines each).

Modified tracked files (for commit curation): `.gitignore`, `phase0/EVIDENCE_MATRIX.md`,
`phase0/container-identity.test.ts`, `phase0/container-identity.ts`,
`phase0/evidence/ENVIRONMENT.md`, `phase0/evidence/RUNTIME_VERDICT.md`, `phase0/p1/worker.ts`,
`phase0/p3/schema.sql`, `phase0/p3/wallet.ts`, `phase0/provisioners/native.ts`,
`phase0/provisioners/ownership.ts`, `phase0/provisioners/provisioners.test.ts`,
`phase0/provisioners/testcontainers.ts`, `phase0/reconcile.mjs`, `phase0/test-env.ts`.

---

## J. Next action for the owner

1. Optionally apply the two non-blocking items (M2-R1 re-stash + DOC-1 header) — or push first
   and schedule them; neither gates. 2. Confirm git author identity, curate the commit from the 15
   modified files (decide explicitly on the 90 evidence JSONs, `docs/plans/`, `docs/architecture/`,
   `deepwiki.md`), and push manually. 3. Let GitHub Actions supply the Docker proof; if the
   integration job fails at readiness with a `localhost`/`::1` signature, apply the one-line host
   normalization from §B. 4. Seek explicit P2 staging approval only after CI is green.
