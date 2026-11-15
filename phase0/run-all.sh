#!/usr/bin/env bash
#
# Phase 0 complete proof sequence (P1 + backpressure + P3).
# Run from the repository root:  bash phase0/run-all.sh
# Requires: node >= 22 on PATH, `npm ci` completed, PHASE0_DATABASE_URL set
# to a disposable phase0_* database (see phase0/LOCAL_POSTGRES_RUNBOOK.md).
#
# Exits non-zero on any test failure. Evidence is written sanitized to
# phase0/evidence/ (credentials redacted; never commit raw secrets).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${PHASE0_DATABASE_URL:-}" ]; then
  echo "FATAL: PHASE0_DATABASE_URL is not set. See phase0/LOCAL_POSTGRES_RUNBOOK.md" >&2
  exit 2
fi
if [ -z "${PHASE0_RT_PASSWORD:-}" ]; then
  echo "FATAL: PHASE0_RT_PASSWORD is not set (needed for the phase0_rt runtime URL)." >&2
  exit 2
fi

# Runtime-role URLs are derived AFTER setup creates the role (preflight runs
# first on the bootstrap URL only; a second preflight below verifies the
# runtime role — deriving it here would check a role that cannot exist yet).
derive_runtime_urls() {
  PHASE0_RT_URL="$(node -e '
const u = new URL(process.env.PHASE0_DATABASE_URL);
u.username = "phase0_rt";
u.password = process.env.PHASE0_RT_PASSWORD;
process.stdout.write(u.toString());
')"
  export PHASE0_RT_URL
  export P1_DATABASE_URL="$PHASE0_RT_URL"
  export P3_DATABASE_URL="$PHASE0_RT_URL"
}
# Run identity (M-05): tests namespace business keys per run so the suite is
# re-runnable against one retained database with independent results.
export PHASE0_RUN_ID="${PHASE0_RUN_ID:-run-$(date +%Y%m%d-%H%M%S)-$$}"

EVIDENCE_DIR="phase0/evidence"
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$EVIDENCE_DIR/phase0-run-$STAMP.log"
WORKER_LOG="$EVIDENCE_DIR/phase0-worker-$STAMP.log"

# Redact embedded credentials from everything written to evidence logs.
redact() {
  sed -E -e 's#(://[^:/@]+:)[^@]+@#\1<redacted>@#g' -e 's#([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]=)[^ &"'"'"']*#\1<redacted>#g' -e 's#([?&](password|passwd|pwd|pass)=)[^&#]*#\1<redacted>#g'
}

SUITE_FAIL=0
run_suite() {
  local name="$1" file="$2" json="$EVIDENCE_DIR/suite-$1-$STAMP.json" start rc
  echo "--- $name ---"
  start=$SECONDS
  set +e
  npx vitest run --config phase0/vitest.phase0.config.ts --reporter=default --reporter=json --outputFile="$json" "$file"
  rc=$?
  set -e
  echo "$name duration_s=$((SECONDS - start)) vitest_exit=$rc"
  # Scrub the JSON artifact: stack traces can theoretically embed connection
  # strings, so evidence files are redacted even when the suite passed.
  if [ -f "$json" ]; then
    redact <"$json" >"$json.tmp" && mv "$json.tmp" "$json"
  fi
  node phase0/check-suite.mjs "$json" "$name" || SUITE_FAIL=1
  return 0
}

{
  echo "=== Phase 0 proof run: $STAMP ==="
  echo "--- versions ---"
  node --version
  npm --version
  npm ls @dbos-inc/dbos-sdk 2>&1 | tail -n 2

  echo "--- preflight (bootstrap) ---"
  node --import tsx phase0/preflight.ts

  echo "--- setup (idempotent) ---"
  node --import tsx phase0/setup-db.ts

  echo "--- runtime-role verification ---"
  derive_runtime_urls
  node --import tsx phase0/preflight.ts

  echo "--- p1 worker ---"
  # Worker output lands in a temp raw file (outside the repo) so $! is the
  # WORKER pid (a pipeline would capture sed's pid instead and orphan the
  # worker on cleanup). It is redacted into evidence exactly once, at exit.
  WORKER_RAW="$(mktemp -t phase0-worker-raw.XXXXXX)"
  node --import tsx phase0/p1/worker.ts >"$WORKER_RAW" 2>&1 &
  WORKER_PID=$!
  cleanup_worker() {
    kill "$WORKER_PID" 2>/dev/null || true
    redact <"$WORKER_RAW" >"$WORKER_LOG" 2>/dev/null || true
    rm -f "$WORKER_RAW"
  }
  trap cleanup_worker EXIT
  for _ in $(seq 1 60); do
    grep -q "p1 worker up" "$WORKER_RAW" 2>/dev/null && break
    sleep 1
  done
  grep -q "p1 worker up" "$WORKER_RAW" || { echo "FATAL: p1 worker did not start"; cat "$WORKER_RAW"; exit 1; }

  run_suite "P1-atomic-enqueue" "phase0/p1/p1.test.ts"
  run_suite "backpressure" "phase0/p1/backpressure.test.ts"
  run_suite "P3-wallet-attempts" "phase0/p3/p3.test.ts"
  run_suite "guard-unit" "phase0/db-guard.test.ts"

  if [ "$SUITE_FAIL" -ne 0 ]; then
    echo "=== Phase 0 proof run FAILED (see SUITE markers above) ==="
    exit 1
  fi
  echo "=== Phase 0 proof run complete: all suites green ==="
} 2>&1 | redact | tee "$LOG"

echo "evidence: $LOG"
