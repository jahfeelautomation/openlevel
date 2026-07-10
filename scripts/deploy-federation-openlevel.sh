#!/usr/bin/env bash
# WARNING - INITIAL ROLLOUT ONLY. Do NOT use this to re-deploy a FIX to an already-live
# federation.ts. This script treats federation.ts as a brand-new file: its revert does
# `rm -f` (which would DELETE the working surface on a failed recreate) and it no-ops when
# the file is already present. For a fix-redeploy use redeploy-federation-openlevel.sh,
# which backs up the current live file and RESTORES it on any failure.
#
# OpenLevel : DEPLOY the JahFeel Hub federation surface (/federation/*) - INERT until token.
# MUTATES live loose .ts on the openlevel-api bind mount (/opt/openlevel/app/server) ->
# runs UNDER FLOCK on the openlevel lock.
#
# Payload (pure-additive over b59cc1c0, the live prod base):
#   NEW: server/lib/federation-types.ts   (wire contract types + ref codec)
#   NEW: server/routes/federation.ts      (the /federation/* router, 503 until token)
#   MOD: server/lib/config.ts             (+ optional FEDERATION_SERVICE_TOKEN env)
#   MOD: server/index.ts                  (+ one federationRoute mount line)
# No schema change, no dist change. The surface answers 503 (federation not configured)
# until FEDERATION_SERVICE_TOKEN is set in /opt/openlevel/.env - so this deploy adds a
# dormant API surface and changes nothing the operator already uses. Token wiring + the
# gateway-side url/token are a SEPARATE later step.
#
# SAFETY (matches the gateway + per-state deploys, plus a base guard):
#   - flock the openlevel compose lock.
#   - idempotent: exit 0 if federation is already live.
#   - BASE GUARD: live config.ts + index.ts must sha256-match the b59cc1c0 base this diff
#     was written against (LF-normalized). If prod was changed out-of-band, ABORT - never
#     clobber. This enforces the invariant the whole plan rests on (prod == b59cc1c0).
#   - back up the 2 modified live files before overwrite (loose files, no git on box).
#   - boot gate = docker inspect health; scan this boot's logs for crash signatures.
#   - prove the surface is live AND inert: /health 200, /federation/today 503.
#   - revert() on ANY post-recreate failure: restore the 2 modified, remove the 2 new,
#     recreate. The 2 new files have no live version, so revert simply deletes them.
set -euo pipefail

APP=/opt/openlevel/app
COMPOSE_DIR=/opt/openlevel
SVC=api                 # docker compose service key
CN=openlevel-api        # container name
LOCKDIR=/opt/openclaw/.locks
LOCK="$LOCKDIR/openlevel-compose.lock"
TGZ=/tmp/openlevel-federation.tgz
STAGE=/tmp/openlevel-federation-stage
STAMP=$(date +%Y%m%d-%H%M%S)
BAK="/opt/openlevel/.backups/federation-${STAMP}"

NEW_FILES="server/lib/federation-types.ts server/routes/federation.ts"
MOD_FILES="server/lib/config.ts server/index.ts"

# -- 1. flock ----------------------------------------------------------------
mkdir -p "$LOCKDIR"
exec 9>"$LOCK"
flock -w 90 9 || { echo "[deploy] FATAL: could not acquire openlevel lock $LOCK"; exit 1; }
echo "[deploy] lock acquired"

# -- 2. stage + verify payload ----------------------------------------------
test -f "$TGZ" || { echo "[deploy] FATAL: staging tarball $TGZ missing"; exit 1; }
rm -rf "$STAGE"; mkdir -p "$STAGE"
tar xzf "$TGZ" -C "$STAGE"
for f in $NEW_FILES $MOD_FILES; do
  test -s "$STAGE/$f" || { echo "[deploy] FATAL: staged $f missing/empty"; exit 1; }
  sed -i 's/\r$//' "$STAGE/$f"   # LF-normalize (authored on Windows)
done
for b in server/lib/config.ts.base server/index.ts.base; do
  test -s "$STAGE/$b" || { echo "[deploy] FATAL: staged base $b missing/empty"; exit 1; }
  sed -i 's/\r$//' "$STAGE/$b"
done
grep -q "federationRoute" "$STAGE/server/routes/federation.ts"        || { echo "[deploy] FATAL: federationRoute marker missing in staged federation.ts"; exit 1; }
grep -q "OPENLEVEL_CARD" "$STAGE/server/lib/federation-types.ts"      || { echo "[deploy] FATAL: OPENLEVEL_CARD marker missing in staged federation-types.ts"; exit 1; }
grep -q "FEDERATION_SERVICE_TOKEN" "$STAGE/server/lib/config.ts"      || { echo "[deploy] FATAL: FEDERATION_SERVICE_TOKEN marker missing in staged config.ts"; exit 1; }
grep -q "federationRoute" "$STAGE/server/index.ts"                    || { echo "[deploy] FATAL: federationRoute mount missing in staged index.ts"; exit 1; }
echo "[deploy] staged payload verified (4 files + 2 base refs; markers present)"

# -- 2a. idempotency: already deployed? --------------------------------------
if docker exec "$CN" sh -c 'test -f /app/server/routes/federation.ts' 2>/dev/null && \
   [ "$(docker exec "$CN" sh -c 'grep -c federationRoute /app/server/index.ts' 2>/dev/null || echo 0)" -ge 1 ]; then
  echo "[deploy] federation already present in live container - nothing to do (idempotent exit 0)"
  exit 0
fi

# -- 3. BASE GUARD: live config.ts + index.ts must equal the b59cc1c0 base ----
set +e
for pair in "config.ts:server/lib/config.ts" "index.ts:server/index.ts"; do
  name="${pair%%:*}"; rel="${pair#*:}"
  live=$(docker exec "$CN" sh -c "cat /app/$rel" 2>/dev/null | sed 's/\r$//' | sha256sum | cut -d' ' -f1)
  base=$(sed 's/\r$//' "$STAGE/$rel.base" | sha256sum | cut -d' ' -f1)
  if [ -z "$live" ] || [ "$live" != "$base" ]; then
    echo "[deploy] FATAL: live $name does NOT match expected b59cc1c0 base (live=${live:-<empty>} base=$base)."
    echo "[deploy]        Prod was changed out-of-band, or base mismatch. Refusing to overwrite - investigate first."
    exit 1
  fi
  echo "[deploy] base guard ok: live $name == b59cc1c0 base"
done
set -e

# -- 4. backup the 2 modified live files (2 new files have no live version) ---
mkdir -p "$BAK/server/lib" "$BAK/server/routes"
for f in $MOD_FILES; do
  test -s "$APP/$f" || { echo "[deploy] FATAL: live $f missing - refusing without a backup source"; exit 1; }
  cp -a "$APP/$f" "$BAK/$f"
  test -s "$BAK/$f" || { echo "[deploy] FATAL: backup of $f failed"; exit 1; }
done
echo "[deploy] backed up live config.ts + index.ts -> $BAK"

revert() {
  echo "[deploy] !! reverting: restore config.ts + index.ts, remove new federation files, recreate $SVC"
  for f in $MOD_FILES; do cp -a "$BAK/$f" "$APP/$f"; done
  for f in $NEW_FILES; do rm -f "$APP/$f"; done
  ( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" ) >/dev/null 2>&1 || true
}

# -- 5. sync all 4 files + recreate ------------------------------------------
for f in $NEW_FILES $MOD_FILES; do install -D -m 644 "$STAGE/$f" "$APP/$f"; done
echo "[deploy] synced 2 new + 2 modified .ts into $APP/server"
( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" )
echo "[deploy] up -d --force-recreate $SVC issued"

# 5a. boot gate: poll health until healthy
READY=0
for i in $(seq 1 45); do
  H=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}NOHEALTH{{end}}' "$CN" 2>/dev/null || echo ERR)
  case "$H" in
    healthy) READY=1; echo "[deploy] health -> healthy"; break;;
    NOHEALTH) echo "[deploy] FATAL: no healthcheck on $CN (unexpected)"; revert; exit 1;;
    *) sleep 2;;
  esac
done
[ "$READY" = "1" ] || { echo "[deploy] FATAL: $CN never healthy in time"; docker logs --since 3m "$CN" 2>&1 | tail -50 || true; revert; exit 1; }

# 5b. hard-crash signatures in this boot's logs
if docker logs --since 3m "$CN" 2>&1 | grep -qiE 'SyntaxError|Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ReferenceError'; then
  echo "[deploy] FATAL: boot-crash signature in logs"; docker logs --since 3m "$CN" 2>&1 | tail -50; revert; exit 1
fi

# 5c. live container actually has all 4 files
docker exec "$CN" sh -c 'test -f /app/server/routes/federation.ts'      || { echo "[deploy] FATAL: federation.ts NOT in live container"; revert; exit 1; }
docker exec "$CN" sh -c 'test -f /app/server/lib/federation-types.ts'   || { echo "[deploy] FATAL: federation-types.ts NOT in live container"; revert; exit 1; }
LIVEMOUNT=$(docker exec "$CN" sh -c 'grep -c federationRoute /app/server/index.ts' 2>/dev/null || echo 0)
LIVECFG=$(docker exec "$CN" sh -c 'grep -c FEDERATION_SERVICE_TOKEN /app/server/lib/config.ts' 2>/dev/null || echo 0)
[ "${LIVEMOUNT:-0}" -ge 1 ] || { echo "[deploy] FATAL: federationRoute mount NOT live (count=$LIVEMOUNT)"; revert; exit 1; }
[ "${LIVECFG:-0}" -ge 1 ]   || { echo "[deploy] FATAL: FEDERATION_SERVICE_TOKEN NOT live in config (count=$LIVECFG)"; revert; exit 1; }
echo "[deploy] live container carries federation (index mount=$LIVEMOUNT, config=$LIVECFG, both new files present)"

# 5d. HTTP proof: /health 200 (regression) + /federation/today 503 (mounted AND inert)
HJSON=$(docker exec "$CN" node -e 'fetch("http://localhost:"+(process.env.PORT||8790)+"/health").then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.log("ERR",e.message))' 2>/dev/null || echo ERR)
echo "[deploy] /health -> $HJSON"
printf '%s' "$HJSON" | grep -q '"ok":true' || { echo "[deploy] FATAL: /health not ok after deploy"; revert; exit 1; }
FCODE=$(docker exec "$CN" node -e 'fetch("http://localhost:"+(process.env.PORT||8790)+"/federation/today").then(r=>console.log(r.status)).catch(e=>console.log("ERR",e.message))' 2>/dev/null || echo ERR)
echo "[deploy] /federation/today -> $FCODE (expect 503 = mounted + inert, no token yet)"
[ "$FCODE" = "503" ] || { echo "[deploy] FATAL: /federation/today expected 503 (inert), got $FCODE"; revert; exit 1; }
echo "[deploy] federation surface mounted AND correctly inert (503 until token)"

echo "[deploy] DONE - OpenLevel /federation/* LIVE + INERT. Set FEDERATION_SERVICE_TOKEN in /opt/openlevel/.env (>=32 chars) + recreate to activate. Backup: $BAK"
