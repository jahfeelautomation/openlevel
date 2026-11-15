# Phase 0 — Local PostgreSQL Runbook (macOS)

Self-contained package for executing the P1, P3, and backpressure proofs on
a disposable local database. No cloud resources, no secrets in chat, no
changes outside `phase0/` (plus the already-approved `package.json`/lockfile
SDK pin).

## 0. Prerequisites (verify once)

```bash
node --version        # want v22.x (repo engines: >=22.0.0)
npm --version
cd /Users/sherwin/Documents/openlevel/openlevel   # repo root for every command below
git status --short    # expect only: M package.json, M package-lock.json, ?? phase0/, prior known entries
npm ls @dbos-inc/dbos-sdk   # want 5.5.0 exact
```

If `node_modules` is absent: `npm ci --no-audit --no-fund` (uses the
repaired committed lockfile; see `phase0/evidence/LOCKFILE_AUDIT.md`).

**Node prerequisite (i-04):** if `node` is missing, install Node 22
user-locally (no sudo): download the `node-v22.x-darwin-<arch>.tar.gz`
from nodejs.org/dist, extract under `$HOME/.local/node`, and prepend its
`bin/` to `PATH` for the session. Re-verify with `node --version`.
Do NOT assume any `/tmp` toolchain persists between sessions — if a prior
`/tmp/node-*` is gone, reinstall; never proceed with a different major.

## 1. Install disposable PostgreSQL (pick ONE option)

**Version rule:** use PostgreSQL **16.x exactly** — the native
provisioner major-gates to 16 to match the CI image (postgres:16.16); any
other major is refused. Record the exact `SELECT version()` output in the
evidence log. Compatibility against the actual Neon target branch must be
verified before production cutover (V2.1 gate, not assumed here).

**Option A — Postgres.app (recommended, no sudo, no package manager):**

1. Download Postgres.app for macOS from https://postgresapp.com
   (choose a build bundling PostgreSQL 16+; record the exact app + PG version).
2. Open the DMG and drag `Postgres.app` to `/Applications` (or run it from
   the mounted image for a fully non-persistent install).
3. Start Postgres.app and initialize a server; note its port (default 5432).
4. Add its binaries to PATH for this shell only:
   `export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"`

**Option B — Homebrew (only if brew is already installed):**
`brew install postgresql@16 && brew services start postgresql@16`.
Do NOT install Homebrew itself just for this task — use Option A or C.

**Option C — compile from source (slowest, fully pinned):**
requires Xcode CLT (`xcode-select --install` needs user approval):
download the chosen `postgresql-16.X.tar.gz` from postgresql.org,
verify its published SHA-256, then
`./configure --prefix=$HOME/.local/pgsql16 && make && make install`.

Do NOT use Docker unless it is already installed and running (it was
absent at last check). Do NOT use PGlite for these proofs. Do NOT use
any existing application, customer, or production database.

## 2. Create the disposable role and database

Run as the OS user (Postgres.app and brew both create a superuser matching
it). Replace `<PORT>` with the actual port (verify free first with
`lsof -iTCP:<PORT> -sTCP:LISTEN`, expecting no output).

```bash
export PGHOST=127.0.0.1 PGPORT=<PORT> PGUSER=$(whoami)
# 1. Create the disposable database (bootstrap superuser = OS user):
createdb -h 127.0.0.1 -p <PORT> phase0_proofs
# 2. Random credentials (never reused, never committed). Both the bootstrap
#    superuser and the runtime role authenticate with SCRAM (no trust):
export PHASE0_BOOT_PASSWORD="$(openssl rand -hex 24)"
export PHASE0_RT_PASSWORD="$(openssl rand -hex 24)"
# NOTE: this first connection uses the fresh install's default local auth for
# the sole purpose of setting a password; every connection after this one
# authenticates with SCRAM.
psql "postgres://$(whoami)@127.0.0.1:<PORT>/postgres" \
  -c "ALTER USER \"$(whoami)\" WITH PASSWORD '${PHASE0_BOOT_PASSWORD}'"
export PHASE0_DATABASE_URL="postgres://$(whoami):${PHASE0_BOOT_PASSWORD}@127.0.0.1:<PORT>/phase0_proofs"
# 3. Guarded setup (refuses non-phase0_* targets; creates phase0_rt role):
node --import tsx phase0/setup-db.ts
```

What setup does (all guarded by the disposable-namespace check, refuses
anything outside `phase0_*`): ensures the DBOS system schema, applies the
p1/p2/p3 prototype schemas, creates role `phase0_rt`, grants it rights
**within this scratch database only**, and prints the server version.

## 2b. Listener, auth, and port verification (M-16 — record all output)

Run BEFORE any test. Every check must print the expected value; anything
else stops the sequence.

```bash
export PHASE0_DATABASE_URL="postgres://$(whoami):${PHASE0_BOOT_PASSWORD}@127.0.0.1:<PORT>/phase0_proofs"
# 1. Listener is loopback-only (expect: 127.0.0.1 and/or ::1, never 0.0.0.0 or *):
psql "$PHASE0_DATABASE_URL" -tAc "SHOW listen_addresses"
# 2. Actual bound socket (expect a 127.0.0.1:<PORT> LISTEN line, nothing else):
lsof -iTCP:<PORT> -sTCP:LISTEN -n -P
# 3. Server identity (expect phase0_proofs + version 16+; record verbatim):
psql "$PHASE0_DATABASE_URL" -tAc "SELECT current_database(), version()"
# 4. Auth rule that will govern phase0_rt (expect scram-sha-256 for
#    127.0.0.1/32 — record the matching pg_hba.conf lines; trust is NOT
#    accepted per the security requirements, even on loopback):
psql "$PHASE0_DATABASE_URL" -tAc "SHOW hba_file" | xargs grep -v "^#" | grep -v "^$"
# 5. Runtime role can connect with its password (expect its own name back):
PHASE0_RT_URL="postgres://phase0_rt:${PHASE0_RT_PASSWORD}@127.0.0.1:<PORT>/phase0_proofs"
psql "$PHASE0_RT_URL" -tAc "SELECT current_user"
```

Copy all five outputs into the evidence log. If (1) shows a non-loopback
listener, stop: reconfigure to loopback-only before proceeding. If (4)
shows anything other than scram-sha-256 for the loopback range (in
particular any `trust` line), stop and fix `pg_hba.conf` first: set the
`127.0.0.1/32` (and `::1/128`, if present) lines to `scram-sha-256`,
ensure the bootstrap superuser has a password
(`ALTER USER <osuser> WITH PASSWORD '<random>'`), then reload with
`SELECT pg_reload_conf()` and re-run checks 3–5 (passing the password
via `PGPASSWORD` in that shell only — never committed or pasted).

## 3. Credentials handling (mandatory)

- Persist NOTHING with secrets to the repo. Either keep variables in the
  current shell only, or write them to `phase0/.env`, which is covered by
  the existing gitignored `.env` basename rule (verified with
  `git check-ignore`). Never paste credentials into chat, issues, or docs.
- Connection strings in evidence logs are redacted by `run-all.sh`
  (`://user:<redacted>@`). Verify redaction with
  `grep -ciE "password=|://[^ ]+:[^ @]+@" phase0/evidence/<log>` → expect 0
  (excluding the word `<redacted>` itself).

## 4. Preflight (must pass before any test)

```bash
export PHASE0_DATABASE_URL="postgres://$(whoami):${PHASE0_BOOT_PASSWORD}@127.0.0.1:<PORT>/phase0_proofs"
# Or persist for the session only: append the export lines to phase0/.env
# (gitignored — verified), then: set -a; source phase0/.env; set +a
node --import tsx phase0/preflight.ts
```

Expected: prints database name, `server_version`, user, and
`preflight: PASS`. Any refusal (unset var, non-`phase0_*` name,
production marker, unreachable server) aborts everything downstream —
fix the target, never the guard.

## 5. Full proof sequence (one command)

Preferred orchestrated path (native provisioner, SCRAM demonstration,
ownership-scoped teardown, rerun + 20× SIGKILL built in): follow
`phase0/TRACK_B_NATIVE.md` §B-1–§B-2 (one command). The manual fallback
below remains for diagnosis.

```bash
bash phase0/run-all.sh
```

What it does, in order: versions record → preflight (bootstrap) →
idempotent setup → runtime-role verification → start p1 worker
(auto-killed on exit) → P1 suite → backpressure suite → P3 suite →
guard-unit suite → sanitized evidence log at
`phase0/evidence/phase0-run-<ts>.log` (+ worker log + per-suite JSON).
Non-zero exit on any test failure. Individual diagnosis:

```bash
npx vitest run --config phase0/vitest.phase0.config.ts phase0/p1/p1.test.ts
npx vitest run --config phase0/vitest.phase0.config.ts phase0/p1/backpressure.test.ts
npx vitest run --config phase0/vitest.phase0.config.ts phase0/p3/p3.test.ts
# (P1 tests need the worker running: P1_DATABASE_URL=... node --import tsx phase0/p1/worker.ts)
```

Repeatability (M-05): run `bash phase0/run-all.sh` a second time against
the SAME retained database — it must pass with independent results (run
identity namespaces business keys; DBOS history accumulates harmlessly).
SIGKILL confidence (M-12): after a green run, execute the SIGKILL test
20 consecutive times and record the tally:
`for i in $(seq 1 20); do npx vitest run --config phase0/vitest.phase0.config.ts phase0/p3/p3.test.ts -t SIGKILL || break; done`
— any failure stops the loop and fails the gate.

## 6. Evidence to collect

From the evidence log + worker log, record: PostgreSQL `server_version`,
SDK version (`npm ls`), per-file test counts (pass/fail/skip), per-suite
durations, and database/provider assertion counts (business rows,
workflow executions, attempt rows, settlement rows, provider-log charges).
Paste the filled seven-column matrix rows into `phase0/EVIDENCE_MATRIX.md`,
flipping BLOCKED → PASS/FAIL only on observed output.

## 7. Cleanup (verify scope first)

```bash
EXPECTED_DB=phase0_proofs   # exact literal — never a prefix alone
# 1. Prove the target is disposable AND exactly the expected database:
ACTUAL="$(psql "$PHASE0_DATABASE_URL" -tAc 'SELECT current_database()')"
[ "$ACTUAL" = "$EXPECTED_DB" ] || { echo "FATAL: refusing cleanup of $ACTUAL"; exit 2; }
# 2. Stop the worker (run-all.sh trap does this; manual runs: Ctrl-C).
# 3. Drop ONLY the scratch database + scratch role (exact names):
psql "postgres://$(whoami):${PHASE0_BOOT_PASSWORD}@127.0.0.1:<PORT>/postgres" -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE ${EXPECTED_DB}" \
  -c "DROP ROLE IF EXISTS phase0_rt"
# 4. If Postgres.app/DMG was used only for this task: quit the app / eject.
# 5. Remove temp provider logs: rm -f "$P3_PROVIDER_LOG"
# 6. Verify nothing else changed: git status --short
#    Expect exactly: M package.json + M package-lock.json (SDK pin + 18
#    verified hash repairs — see evidence/LOCKFILE_AUDIT.md), ?? phase0/,
#    prior known entries (.gitignore edit, deepwiki, docs/), and gitignored
#    evidence logs. Anything else is out of scope: stop and report.
# 7. Verify the disposables are gone: reconnect attempts to phase0_proofs
#    and phase0_rt must fail; other databases/roles untouched (list with \l).
```

Cleanup can only affect the disposable environment: every destructive
command above names exact `phase0_*` literals verified in step 1, the
guard refuses anything else, and no command touches other databases,
roles, or system state.
