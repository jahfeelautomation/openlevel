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
| B-UNIT | database-independent unit tests | vitest, no DB | `npm run test:phase0:unit` | PASS | 162/162 green (58 guard + 2 outcome + 12 race-observer + 4 orch + 4 gate + 26 container-identity + 56 provisioners) | history: 83 → 111 → 120 → 131 → 150 → 162 (prompt16: +9 predicate, +3 sampler-repro) |
| CONTAINER-ID | image-resolution identity chain + binding/label/platform policy | vitest, fixture inspect JSON, no Docker | `container-identity.test.ts` within B-UNIT | PASS | 26/26: CI-regression accept via image chain; different-image, wrong-manifest/config-digest, wrong platform, inconsistent RepoDigests, label, binding, RFC1918, malformed all reject; empty image-RepoDigests accepted w/ chain (documented demotion) | fix for the CI FATAL; live proof pending CI |
| GUARD-FIX | review3 `/32` fix + server-view policy in live checks | vitest, no DB | `npx tsc -p phase0/tsconfig.json --noEmit` + B-UNIT | PASS | `host()` in both live checks; loopback+RFC1918 policy with logging; 29 classification cases green | code fix verified statically; live behavior pending CI |
| ORCH-CLI | orchestrator arg parsing + exit codes | node, no Docker | `test-env.ts` bogus/down/run probes | PASS | usage→2, down-no-state→0, run-without-Docker→2 with Docker guidance | executed 2026-11-15 |
| SUMMARY | summary generator golden path | node, fixture JSON | `summary.mjs` on fixture | PASS | verdict/table/invariants rendered; exit 0 on PASS | executed 2026-11-15 |
| RECON-GUARD | reconcile refusal paths | node, no DB | missing/prod/unreachable URL probes | PASS | exit 2 with FATAL on all three; full reconcile BLOCKED on live DB | executed 2026-11-15 |
| PROV-SEAM | one harness, two adapters; Testcontainers path behavior-identical | tsc strict + vitest, no DB/Docker | `npx tsc -p phase0/tsconfig.json --noEmit` + B-UNIT | PASS (static) | `Provisioner` interface; container `up`/`down` moved verbatim; `PHASE0_PROVISIONER` parse (default testcontainers, unknown→throw); suites untouched (same env contract); existing 83 unit tests still green | live parity pending Track B + CI |
| PROV-NATIVE-STATIC | native guard logic + dry-run refusals | vitest + spawned CLI, no DB | `provisioners.test.ts` within B-UNIT | PASS (static) | version gate (16 only), container-env hygiene (clear + absent-assert), unknown-provisioner→2, native-no-URL→2, native-non-loopback→2; no socket attempted | proves refusal only; live proof BLOCKED on Track B |
| SCRAM-STATIC | SCRAM-evidence decision logic | vitest, fixtures, no DB | `provisioners.test.ts` within B-UNIT | PASS (static) | verifier-format accept/reject (SCRAM/md5/null), IPv4 CIDR containment, hba first-match-wins + TLS family + comma-lists + parse-error fail-closed | live demonstration BLOCKED on Track B |
| OWNERSHIP-STATIC | ownership ledger + teardown planner | vitest, no DB | `provisioners.test.ts` within B-UNIT | PASS (static) | LIKE-escape; planner: created→drop, pre-existing keyed→namespaced deletes + retained note, pre-existing unkeyed→fully retained, vanished→ignored | live cleanup proof BLOCKED on Track B |
| CI-CONTAINER | Testcontainers live run + image provenance on CI | GitHub Actions, Docker-native | `npm run test:phase0:integration` (CI run 43656080155) | FAIL (observed) | `FATAL: no RepoDigests` exit 2 — root cause proven: code read image-only field from container inspect (see CONTAINER-ID row). Resolution-chain fix implemented + 26 unit cases green locally; awaiting authorizing push + CI run to flip | fix ready, CI validation pending owner push |

## Track B run record — run-2026-11-15T03-19-34-525Z-29438 (native live)

Run-level proof. Env: PG 16.16 (Postgres.app, Apple Silicon) @ 127.0.0.1:5433, SDK 5.5.0, node v22.23.5, vitest v4.1.8. Command: `PHASE0_PROVISIONER=native node --import tsx phase0/test-env.ts run --repeat-suites --sigkill-loop 20` → exit 0, 103s. Report: `docs/plans/prompt11_imp.md`; 30 artifacts under `phase0/evidence/`; redacted console log retained owner-side.

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| TB-PROV | native provisioning + identity | native, run-…-29438 | orchestrator `up` | PASS | `native-provision-…-29438.json`: anton@127.0.0.1:5433/phase0_proofs, 16.16 (Postgres.app) | strict loopback; no container context |
| TB-SCRAM | demonstrated SCRAM (GUC + hba + verifier + login) | native, run-…-29438 | provision + runtime verify | PASS | `password_encryption=scram-sha-256`; hba `line 115: host db=all user=all addr=127.0.0.1 method=scram-sha-256`; role verifier SCRAM; `runtime: phase0_rt@127.0.0.1:5433 scram=scram-sha-256` | demonstrated, not inferred |
| TB-RERUN | repeat complete suite vs retained DB | native, run-…-29438 | `--repeat-suites` | PASS | P1-rerun 9/9, P3-rerun 11/11, backpressure-rerun 1/1 — identical counts to first pass | history accumulates harmlessly |
| TB-SIGKILL20 | 20 consecutive SIGKILL iterations | native, run-…-29438 | `--sigkill-loop 20` | PASS | 20/20 `suite-sigkill-<i>-of-20` JSONs, each total=11 passed=1 failed=0; 0.96–1.41s each | exactly one charge, quarantined |
| TB-RECON | provider journal vs PG ledger | native, run-…-29438 | `reconcile.mjs` | PASS | `reconciliation-…-29438.json` verdict PASS: journal-parseable (30 entries), no-negative-wallets (900000µ), charges-have-attempts (30 live+archive), settle-equals-cost (0 mismatches); `provider-…-29438.jsonl` 30 lines | archive holds 34 attempts |
| TB-TEARDOWN | ownership-scoped cleanup | native, run-…-29438 | orchestrator `down` | PASS | console tail: 13 `cleaned:` lines (11 prototype tables incl. `p3_attempt_archive` + ledger rows + ledger drop), zero `retained:` lines; DB + server left running per B-6 | FK-ordered drops |

## P1 — atomic enqueue (native live proof: run-2026-11-15T03-19-34-525Z-29438)

Native env for every row below: PG 16.16 (Postgres.app, Apple Silicon) @ 127.0.0.1:5433, SDK 5.5.0, node v22.23.5, `PHASE0_PROVISIONER=native … run --repeat-suites --sigkill-loop 20`, exit 0, 103s. Suite artifacts: `phase0/evidence/suite-P1[-rerun]-run-…-29438.json` (9/9 passed each); report `docs/plans/prompt11_imp.md`.

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| P1-RACE | 8-way barrier race → 1 event + 1 execution + overlap proof | native, run-…-29438 + rerun | `p1.test.ts`: "concurrent identical requests create one business event and one workflow" | PASS | passed in both suite JSONs; sampler peak backends ≥ 2; losers live-status members; reuse via execution log + SUCCESS | native proof; CI/staging separate |
| P1-ROLLBACK | pre-commit failure leaves nothing anywhere | native, run-…-29438 + rerun | `p1.test.ts`: "rollback leaves neither business event nor workflow" | PASS | passed in both suite JSONs; absence in event + domain row + `dbos.workflow_status` + `dbos.operation_outputs` + lookup (M-07) | |
| P1-DONE | post-completion duplicate converges | native, run-…-29438 + rerun | `p1.test.ts`: "duplicate after completion returns existing result without re-enqueue" | PASS | passed in both suite JSONs | |
| P1-RETAIN | post-history-deletion duplicate via projection | native, run-…-29438 + rerun | `p1.test.ts`: "duplicate after workflow-history deletion converges via retained projection" | PASS | passed in both suite JSONs | |
| P1-409 | same key + different hash → conflict + record | native, run-…-29438 + rerun | `p1.test.ts`: "same key with different payload hash returns 409 conflict" | PASS | passed in both suite JSONs | |
| P1-EXPIRY | tombstone expiry → atomic new generation; concurrent resubmits converge on one gen-2 | native, run-…-29438 + rerun | `p1.test.ts`, 2 tests (single + 8-way race) | PASS | both passed in both suite JSONs; guarded renewal + archive-once + loser re-read | canonical row 7 of 8 |
| P1-VANISH-SUPP | mid-flight row deletion fails closed (supplementary, m-03) | native, run-…-29438 + rerun | same test as P1-VANISH | PASS | same passing test as P1-VANISH (duplicate matrix row, kept for history) | supplementary, not counted |
| P1-OUTCOME | outcome→HTTP mapping contract (m-02) | vitest, no DB | see B-UNIT command | PASS | 2/2 green within the B-UNIT run; accepted/duplicate→200, conflict→409 | counted under B-UNIT |
| P1-REUSE-TYPE | reuse option present in installed types | SDK 5.5.0 .d.ts (no DB needed) | type inspection | PASS | `workflowIDReusePolicy` in installed `enqueue_options.d.ts`; `DEFAULT_POOL_SIZE=10` in installed source | static evidence only |
| P1-REUSE | delete-then-resubmit reuses live workflow, no new execution | native, run-…-29438 + rerun | `p1.test.ts`: "delete-then-resubmit reuses the live workflow without new execution (M-06)" | PASS | passed in both suite JSONs; same UUID, execution count 1, SUCCESS | |
| P1-VANISH | mid-flight row deletion fails closed, no assisted recovery | native, run-…-29438 + rerun | `p1.test.ts`: "mid-flight row deletion fails closed without assisted recovery (m-03)" | PASS | passed in both suite JSONs; deterministic two-connection trigger | |

## P3 — wallet + attempts (native live proof: run-2026-11-15T03-19-34-525Z-29438)

Same native env/command as P1 above. Suite artifacts: `phase0/evidence/suite-P3[-rerun]-run-…-29438.json` (11/11 passed each); report `docs/plans/prompt11_imp.md`.

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| P3-C1..C4 | 4 crash tests via real process kills + recovery inspection | native, run-…-29438 + rerun | `p3.test.ts` crash-1..crash-4 | PASS | all 4 passed in both suite JSONs; recovery-refusal + lease transition observed | crash-4 a real after-settle kill (m-13) |
| P3-EXH | concurrent exhaustion never negative | native, run-…-29438 + rerun | `p3.test.ts`: "concurrent turns exhausting one wallet never go negative" | PASS | passed in both suite JSONs | |
| P3-SWEEP | sweeper refunds only provably-undispatched | native, run-…-29438 + rerun | `p3.test.ts`: "sweeper refunds only provably-undispatched reservations" | PASS | passed in both suite JSONs; locked recheck + rowcount guard + NULLS NOT DISTINCT dedup | |
| P3-RESERVE-RACE | concurrent reserves debit exactly once | native, run-…-29438 + rerun | `p3.test.ts`: "concurrent reserves on one operation debit exactly once (M-10)" | PASS | passed in both suite JSONs; FOR UPDATE serialization observed | |
| P3-SWEEP-RACE | sweeper vs in-flight dispatch + dual sweepers | native, run-…-29438 + rerun | `p3.test.ts`, 2 tests (M-11) | PASS | both passed in both suite JSONs; single-refund observed | |
| P3-RECOVERY | stale dispatching → uncertain via lease; runner refuses | native, run-…-29438 + rerun | crash-2 test path | PASS | passed in both suite JSONs; recoverStaleAttempts + exit-3 refusal (M-08, M-09) | same test as crash-2 |
| P3-TIMEOUT | provider timeout → uncertain, no throw, no retry | native, run-…-29438 + rerun | `p3.test.ts`: "provider timeout marks attempt uncertain without throwing or retrying" | PASS | passed in both suite JSONs; charge==1, attempts==1 | |
| P3-SIGKILL | external SIGKILL mid-call → 1 charge, quarantined | native, run-…-29438 + rerun + 20× loop | `p3.test.ts` SIGKILL test; `-t SIGKILL` × 20 | PASS | passed in P3 + rerun JSONs and in all 20 `suite-sigkill-<i>-of-20` JSONs (each total=11 passed=1 failed=0) | 20/20, 0.96–1.41s each |

## Backpressure (native live proof: run-2026-11-15T03-19-34-525Z-29438)

Same native env/command as P1 above. Suite artifacts: `phase0/evidence/suite-backpressure[-rerun]-run-…-29438.json` (1/1 passed each); report `docs/plans/prompt11_imp.md`.

| Test ID | Requirement | Environment | Command | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| BP-FLOOD | 10-way flood on max-2 pool → fast retryable fails, zero commits | native, run-…-29438 + rerun | `backpressure.test.ts`: "saturated pool fails fast, retryable, with zero silent loss" | PASS | passed in both suite JSONs; `AcquireTimeoutError(retryable)` × 10, census ≤ 2, shared-client count == 1, 0 rows committed (M-13) | flood phase of the single test |
| BP-RETRY | post-relief retries converge (10 accepted) | native, run-…-29438 + rerun | same test, retry-after-relief phase | PASS | passed in both suite JSONs; 10/10 accepted, 10 committed rows | retry phase of the single test |

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
