#!/usr/bin/env bash
# redeploy-federation-openlevel.sh - SAFE single-file re-sync of the federation.ts FIX
# to live OpenLevel. Use this (NOT deploy-federation-openlevel.sh) for a fix-redeploy:
# the deploy script treats federation.ts as a brand-new file - its revert does `rm -f`,
# which would DELETE the working surface on a failed recreate - and it no-ops when the
# file is already present. This script instead backs up the CURRENT live file and
# RESTORES that backup on any failure, under the openlevel compose flock, health-gated
# and crash-scanned. Read-only until the swap; idempotent (re-running re-syncs the same
# bytes). No PII, no secrets touched.
set -uo pipefail

HOST=root@87.99.129.115
LOCAL_FILE=/c/Users/Ghost/.openclaw/workspace/.claude/worktrees/hub-openlevel-federation/projects/openlevel/server/routes/federation.ts

[ -s "$LOCAL_FILE" ] || { echo "FATAL: local file missing: $LOCAL_FILE"; exit 1; }
grep -q 'epochOf' "$LOCAL_FILE" || { echo "FATAL: local file lacks epochOf - wrong content"; exit 1; }
echo "[local] $(wc -c < "$LOCAL_FILE" | tr -d ' ') bytes, epochOf present"

# 1. Ship LF-normalized to a staging path (no service impact, no lock needed).
echo "[ship] -> staging on $HOST"
tr -d '\r' < "$LOCAL_FILE" | ssh -o ConnectTimeout=20 "$HOST" \
  "mkdir -p /opt/openlevel/_staging && cat > /opt/openlevel/_staging/federation.ts.new" \
  || { echo "FATAL: ship to staging failed"; exit 1; }

# 2. Backup + swap + recreate + health-gate + crash-scan, under flock; restore on any failure.
ssh -o ConnectTimeout=20 "$HOST" 'bash -s' <<'REMOTE'
set -uo pipefail
LIVE=/opt/openlevel/app/server/routes/federation.ts
STAGING=/opt/openlevel/_staging/federation.ts.new
LOCK=/opt/openclaw/.locks/openlevel-compose.lock
COMPOSE=/opt/openlevel/docker-compose.yml
STAMP=$(date +%Y%m%d-%H%M%S)
BAK=/opt/openlevel/_fedbak/federation.ts.$STAMP

exec 9>"$LOCK" || { echo "FATAL: cannot open lock $LOCK"; exit 1; }
flock -w 120 9 || { echo "FATAL: could not acquire openlevel-compose.lock in 120s"; exit 1; }
echo "[lock] acquired openlevel-compose.lock"

[ -s "$STAGING" ] || { echo "FATAL: staging missing/empty"; exit 1; }
grep -q 'epochOf' "$STAGING" || { echo "FATAL: staging lacks epochOf - wrong content"; exit 1; }
[ -s "$LIVE" ] || { echo "FATAL: live file missing - aborting before any change"; exit 1; }

mkdir -p /opt/openlevel/_fedbak
cp -p "$LIVE" "$BAK" || { echo "FATAL: backup failed"; exit 1; }
echo "[backup] $BAK ($(sha256sum "$BAK" | cut -c1-16))"

restore() {
  echo "[restore] reverting live <- backup"
  cp -p "$BAK" "$LIVE"
  ( cd /opt/openlevel && docker compose -f "$COMPOSE" up -d --force-recreate api ) >/dev/null 2>&1
  echo "[restore] recreated api on backup ($(sha256sum "$LIVE" | cut -c1-16))"
}

cp "$STAGING" "$LIVE" || { echo "FATAL: swap copy failed"; cp -p "$BAK" "$LIVE"; exit 1; }
echo "[swap] live now $(sha256sum "$LIVE" | cut -c1-16)"

echo "[recreate] api ..."
if ! ( cd /opt/openlevel && docker compose -f "$COMPOSE" up -d --force-recreate api ); then
  echo "FATAL: compose recreate failed"; restore; exit 1
fi

# Health-gate: poll up to ~120s; "starting" keeps waiting, "unhealthy" breaks early.
ok=""; st="?"
for i in $(seq 1 40); do
  st=$(docker inspect --format '{{.State.Health.Status}}' openlevel-api 2>/dev/null || echo none)
  if [ "$st" = "healthy" ]; then ok=1; break; fi
  if [ "$st" = "unhealthy" ]; then echo "[health] unhealthy at poll $i"; break; fi
  sleep 3
done
if [ -z "$ok" ]; then
  echo "FATAL: api not healthy after ~120s (last: $st)"
  echo "--- recent logs ---"; docker logs --tail 40 openlevel-api 2>&1 | tail -40
  restore; exit 1
fi
echo "[health] healthy"

# Crash-scan: tsx loads .ts at runtime, so a parse/type crash shows here.
errs=$(docker logs --since 150s openlevel-api 2>&1 | grep -iE 'SyntaxError|TypeError|Cannot find|ReferenceError|unhandledRejection|Error: ' | head -5 || true)
if [ -n "$errs" ]; then
  echo "FATAL: error markers in logs:"; echo "$errs"; restore; exit 1
fi
echo "[logs] clean"

grep -q 'epochOf' "$LIVE" || { echo "FATAL: live lacks epochOf post-swap"; restore; exit 1; }
echo "DEPLOY_OK live=$(sha256sum "$LIVE" | cut -c1-16) backup=$BAK"
REMOTE
rc=$?
echo "=== redeploy exit: $rc ==="
exit $rc
