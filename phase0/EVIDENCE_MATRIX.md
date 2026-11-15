# Phase 0 Evidence Matrix

States: PASS (observed) / FAIL (observed) / BLOCKED (named gate) / NOT RUN.
No test is marked PASS without executed output quoted or referenced.

## Gate C — disposable PostgreSQL provisioning

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| C-PROV-1 | Least-complex local PG provisioning | macOS 12.7 Intel, no brew/Docker/PG, Xcode CLT present |ladder walk: `embedded-postgres@18.6.0-beta.19` inspect → install → launch | BLOCKED | Package + postinstall inspected (empty symlink manifest; no host modification); PG 18.6 binaries run (`postgres --version` OK, SHA-256 recorded in session log). Cluster start impossible: `bind()` → EPERM on all TCP ports/interfaces and unix sockets; `initdb` bootstrap fails `shmget: Operation not permitted`. Sandbox-level restriction, not a tooling choice. | ladder exhausted in-sandbox |
| C-PROV-2 | Neon-branch fallback | n/a | — | NOT RUN | Requires account approval per prompt6 §2; superseded by user-side local execution package (see runbook) unless local fails there too | approval-gated, not requested |
| C-PROV-3 | Local execution package for user-side run | repo only | file review | PASS | `phase0/LOCAL_POSTGRES_RUNBOOK.md` + `setup-db.ts` + `preflight.ts` + `run-all.sh` + `db-guard.ts` delivered; typechecks clean; all DB cases remain BLOCKED until the user runs them | expanded this pass: guard, setup, preflight, runner, evidence scripts |

## Baseline (accepted + extended)

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| B-TYPE | typecheck clean | node v22.23.5, npm 10.9.9 | `npm run typecheck` | PASS | exit 0, zero errors | |
| B-SUITE | full suite baseline | same + 202 installed pkgs | `npm test` (724s; re-run 635s) | FAIL (pre-existing) | 181/182 files, 1589/1590 cases; sole failure `vault.test.ts` mixed/upper-case bug, deterministic, untouched per scope | re-confirmed identical 2026-11-15 (Track A) |
| B-SDK | exact SDK pin | npm registry | `npm install --save-exact @dbos-inc/dbos-sdk@5.5.0` | PASS | `npm ls` → 5.5.0; tree delta exactly package.json + lockfile + phase0/ | |
| B-COMPILE | phase0 typecheck + SDK API binding | tsc strict, SDK 5.5.0 .d.ts | `npx tsc -p phase0/tsconfig.json --noEmit` | PASS | zero errors via the dedicated config (M-04); `workflowIDReusePolicy` present; `DEFAULT_POOL_SIZE=10` confirmed; `runAsStep` corrected to `registerStep`; `poolOptions` corrected to `fileParallelism:false` | exact command above is the gate |
| B-UNIT | database-independent unit tests | vitest, no DB | `npm run test:phase0:unit` | PASS | 111/111 green (58 db-guard + 2 outcome + 4 orch + 4 gate + 15 container-identity + 28 provisioners) | re-executed 2026-11-15 (Track A) |
| CONTAINER-ID | exact interface match + binding/label/digest policy | vitest, fixture inspect JSON, no Docker | `container-identity.test.ts` within B-UNIT | PASS | verified-private accept; arbitrary-RFC1918, public-binding, unknown/missing/ambiguous all reject | executed 2026-11-15 |
| GUARD-FIX | review3 `/32` fix + server-view policy in live checks | vitest, no DB | `npx tsc -p phase0/tsconfig.json --noEmit` + B-UNIT | PASS | `host()` in both live checks; loopback+RFC1918 policy with logging; 29 classification cases green | code fix verified statically; live behavior pending CI |
| ORCH-CLI | orchestrator arg parsing + exit codes | node, no Docker | `test-env.ts` bogus/down/run probes | PASS | usage→2, down-no-state→0, run-without-Docker→2 with Docker guidance | executed 2026-11-15 |
| SUMMARY | summary generator golden path | node, fixture JSON | `summary.mjs` on fixture | PASS | verdict/table/invariants rendered; exit 0 on PASS | executed 2026-11-15 |
| RECON-GUARD | reconcile refusal paths | node, no DB | missing/prod/unreachable URL probes | PASS | exit 2 with FATAL on all three; full reconcile BLOCKED on live DB | executed 2026-11-15 |
| PROV-SEAM | one harness, two adapters; Testcontainers path behavior-identical | tsc strict + vitest, no DB/Docker | `npx tsc -p phase0/tsconfig.json --noEmit` + B-UNIT | PASS (static) | `Provisioner` interface; container `up`/`down` moved verbatim; `PHASE0_PROVISIONER` parse (default testcontainers, unknown→throw); suites untouched (same env contract); existing 83 unit tests still green | live parity pending Track B + CI |
| PROV-NATIVE-STATIC | native guard logic + dry-run refusals | vitest + spawned CLI, no DB | `provisioners.test.ts` within B-UNIT | PASS (static) | version gate (16 only), container-env hygiene (clear + absent-assert), unknown-provisioner→2, native-no-URL→2, native-non-loopback→2; no socket attempted | proves refusal only; live proof BLOCKED on Track B |
| SCRAM-STATIC | SCRAM-evidence decision logic | vitest, fixtures, no DB | `provisioners.test.ts` within B-UNIT | PASS (static) | verifier-format accept/reject (SCRAM/md5/null), IPv4 CIDR containment, hba first-match-wins + TLS family + comma-lists + parse-error fail-closed | live demonstration BLOCKED on Track B |
| OWNERSHIP-STATIC | ownership ledger + teardown planner | vitest, no DB | `provisioners.test.ts` within B-UNIT | PASS (static) | LIKE-escape; planner: created→drop, pre-existing keyed→namespaced deletes + retained note, pre-existing unkeyed→fully retained, vanished→ignored | live cleanup proof BLOCKED on Track B |
| CI-CONTAINER | Testcontainers live run + image provenance on CI | GitHub Actions, Docker-native | `npm run test:phase0:integration` (CI run 43656080155) | FAIL (observed) | `FATAL: no RepoDigests present to verify image identity` exit 2; unit 83/83 green in same run. Separate Docker-specific task per prompt11 §4; ID-based verification fix pending | next CI run validates the fix, not app logic |

## P1 — atomic enqueue (all require live PG: BLOCKED except code-complete)

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| P1-RACE | 8-way barrier race → 1 event + 1 execution + overlap proof | needs Gate C | `npx vitest run --config phase0/vitest.phase0.config.ts phase0/p1/p1.test.ts -t concurrent` | BLOCKED | sampler asserts peak active backends ≥ 2 (i-01); losers assert live-status membership (m-01); reuse proof via execution log + SUCCESS | |
| P1-ROLLBACK | pre-commit failure leaves nothing anywhere | needs Gate C | same file, rollback test | BLOCKED | asserts absence in event + synthetic domain row + `dbos.workflow_status` + `dbos.operation_outputs` + client lookup (M-07) | |
| P1-DONE | post-completion duplicate converges | needs Gate C | same file | BLOCKED | code complete | |
| P1-RETAIN | post-history-deletion duplicate via projection | needs Gate C | same file (`deleteWorkflowById` verified present in 5.5.0 types) | BLOCKED | code complete | |
| P1-409 | same key + different hash → conflict + record | needs Gate C | same file | BLOCKED | code complete | |
| P1-EXPIRY | tombstone expiry → atomic new generation; concurrent resubmits converge on one gen-2 | needs Gate C | same file, 2 tests (single + 8-way race) | BLOCKED | guarded renewal + archive-once + loser re-read; review2 bullets 9–10 in one named case | canonical row 7 of 8 |
| P1-VANISH-SUPP | mid-flight row deletion fails closed (supplementary, m-03) | needs Gate C | same file, vanish test | BLOCKED | deterministic two-connection invariant trigger; outside the review2 eight | supplementary, not counted |
| P1-OUTCOME | outcome→HTTP mapping contract (m-02) | vitest, no DB | see B-UNIT command | PASS | 2/2 green within the B-UNIT run; accepted/duplicate→200, conflict→409 | counted under B-UNIT |
| P1-REUSE-TYPE | reuse option present in installed types | SDK 5.5.0 .d.ts (no DB needed) | type inspection | PASS | `workflowIDReusePolicy` in installed `enqueue_options.d.ts`; `DEFAULT_POOL_SIZE=10` in installed source | static evidence only |
| P1-REUSE | delete-then-resubmit reuses live workflow, no new execution | needs Gate C | same file, reuse test | BLOCKED | deletes business row only; asserts same UUID, execution count 1, SUCCESS (M-06) | |
| P1-VANISH | mid-flight row deletion fails closed, no assisted recovery | needs Gate C | same file, vanish test | BLOCKED | deterministic two-connection invariant trigger (m-03) | |

## P3 — wallet + attempts (all require live PG: BLOCKED except code-complete)

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| P3-C1..C4 | 4 crash tests via real process kills + recovery inspection | needs Gate C | `npx vitest run --config phase0/vitest.phase0.config.ts phase0/p3/p3.test.ts` | BLOCKED | runner + fault modes + measurable assertions complete; recovery-refusal + lease transition implemented | crash-4 now a real after-settle kill (m-13) |
| P3-EXH | concurrent exhaustion never negative | needs Gate C | same file | BLOCKED | code complete | |
| P3-SWEEP | sweeper refunds only provably-undispatched | needs Gate C | same file | BLOCKED | locked recheck + rowcount guard + NULLS NOT DISTINCT dedup; per-row error logging (M-11, m-10) | |
| P3-RESERVE-RACE | concurrent reserves debit exactly once | needs Gate C | same file | BLOCKED | FOR UPDATE serialization + idempotent already-reserved + single debit asserts (M-10) | |
| P3-SWEEP-RACE | sweeper vs in-flight dispatch + dual sweepers | needs Gate C | same file, 2 tests | BLOCKED | hook-ordered overlap + concurrent-sweeper single-refund asserts (M-11) | |
| P3-RECOVERY | stale dispatching → uncertain via lease; runner refuses | needs Gate C | crash-2 test path | BLOCKED | recoverStaleAttempts + exit-3 refusal + no-retry asserts (M-08, M-09) | |
| P3-TIMEOUT | provider timeout → uncertain, no throw, no retry | needs Gate C | same file, timeout test | BLOCKED | ProviderTimeoutError path with P3_FAKE_TIMEOUT_MS=200; charge==1, attempts==1 | |
| P3-SIGKILL | external SIGKILL mid-call → 1 charge, quarantined | needs Gate C | same file | BLOCKED | dual precondition (dispatch row + provider charge) before kill (M-12); 20× run is an owner-side procedure, not yet executed | |

## Backpressure (requires live PG: BLOCKED except code-complete)

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| BP-FLOOD | 10-way flood on max-2 pool → fast retryable fails, zero commits | needs Gate C | `npx vitest run --config phase0/vitest.phase0.config.ts phase0/p1/backpressure.test.ts` | BLOCKED | `AcquireTimeoutError(retryable)` + leak-free late-release + tagged-backend census ≤ pool max + shared-client creation count == 1 (M-13) | |
| BP-RETRY | post-relief retries converge (10 accepted) | needs Gate C | same file | BLOCKED | code complete | |

## P2 prep (no staging per prompt6 §7)

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| P2-CONFIG | staging config + boot wrapper + restart policy | repo only | file review | PASS | `fly.staging.toml` (rolling, max_unavailable=1, SIGTERM/120s, on-failure retries=10, no app-wide VMID); boot wrapper fail-closed + syntax-checked | |
| P2-PROBE | probe workflows for T2/T3 | repo only | typecheck | PASS | `probe-workflows.ts` typechecks against SDK 5.5.0 types | |
| P2-T1..T5 | fencing/deploy/restart/heartbeat proofs | staging Fly (Gate D) | proof-checklist.md | BLOCKED | explicitly unauthorized until Gate D staging approval | prep artifacts delivered: config, boot wrapper, probe workflows, p2 schema |

## Supply chain

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| S-AUDIT | 18 restored hashes ↔ name/version/URL/artifact | registry metadata over HTTPS | `node phase0/evidence/verify-lockfile.mjs` | PASS | all 18: working tree == registry, HEAD differs; pairs in `LOCKFILE_PAIRS.md`; `npm ci` green confirms platform completeness | audit regenerated per M-15 |
