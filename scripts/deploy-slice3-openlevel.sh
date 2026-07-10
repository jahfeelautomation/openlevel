#!/usr/bin/env bash
# OpenLevel slice 3D : DEPLOY the operator-assistant text rail (send_text on confirm).
# MUTATES live files on the openlevel-api bind mount + .env + recreates the container ->
# runs UNDER FLOCK (establishes the openlevel lock convention).
#
# Mechanic: the api service runs `npx tsx server/index.ts` with /opt/openlevel/app bind-mounted
# to /app, so the live server is RAW TypeScript. Deploy = sync the 5 changed .ts files into
# /opt/openlevel/app/server, add GATEWAY_TEXT_URL to /opt/openlevel/.env (sole source -- not in
# the compose environment block), force-recreate so tsx re-imports + env_file reloads.
# compose SERVICE key = "api"; container_name = "openlevel-api".
#
# The 5-file delta (verified clean vs live: zero only-on-box, send-text-rail.ts absent live):
#   MODIFIED: server/index.ts (2-arg -> 3-arg assistantRoute, builds makeHttpSendText),
#             server/lib/operator-config.ts, server/lib/operator-tools.ts (+send_text tool),
#             server/routes/assistant.ts (perform send_text on confirm)
#   NEW:      server/lib/send-text-rail.ts (makeHttpSendText -> SendTextFn over the gateway)
#
# RIGOR (matches the gateway activate): the 4 modified files are the ONLY copy of the running
# version (loose files, no git on box, differ from HEAD) -> BACK THEM UP before overwrite.
# Boot gate = `docker inspect health` (api has a HEALTHCHECK). On ANY failure: restore the 4
# files, delete the NEW file (or restore if it pre-existed), restore .env, recreate.
set -euo pipefail

APP=/opt/openlevel/app
ENV=/opt/openlevel/.env
COMPOSE_DIR=/opt/openlevel
SVC=api                 # docker compose service key
CN=openlevel-api        # container name (inspect/exec/logs)
STAGE=/tmp/openlevel-slice3-stage
TGZ=/tmp/openlevel-slice3.tgz
LOCKDIR=/opt/openclaw/.locks
LOCK="$LOCKDIR/openlevel-compose.lock"
STAMP=$(date +%Y%m%d-%H%M%S)
BAK="/opt/openlevel/.backups/slice3-${STAMP}"
GATEWAY_URL="https://api.jahfeelautomation.com/text/send"

MOD_FILES="server/index.ts server/lib/operator-config.ts server/lib/operator-tools.ts server/routes/assistant.ts"
NEW_FILE="server/lib/send-text-rail.ts"

# -- 1. flock ----------------------------------------------------------------
mkdir -p "$LOCKDIR"
exec 9>"$LOCK"
flock -w 90 9 || { echo "[deploy] FATAL: could not acquire openlevel lock $LOCK"; exit 1; }
echo "[deploy] lock acquired"

# -- 0. pre-flight: stage + verify the 5 files ------------------------------
test -f "$TGZ" || { echo "[deploy] FATAL: staging tarball $TGZ missing"; exit 1; }
rm -rf "$STAGE"; mkdir -p "$STAGE"
tar xzf "$TGZ" -C "$STAGE"
find "$STAGE/server" -name '*.ts' -exec sed -i 's/\r$//' {} +   # LF-normalize (canonical)
test "$(find "$STAGE/server" -name '*.ts' | wc -l)" -eq 5 || { echo "[deploy] FATAL: expected 5 staged .ts files"; exit 1; }
for f in $MOD_FILES $NEW_FILE; do test -s "$STAGE/$f" || { echo "[deploy] FATAL: staged $f missing/empty"; exit 1; }; done
grep -q "claude: deps.claude, sendText: deps.sendText" "$STAGE/server/index.ts" || { echo "[deploy] FATAL: 3-arg assistantRoute marker missing in staged index.ts"; exit 1; }
grep -q "export function makeHttpSendText" "$STAGE/server/lib/send-text-rail.ts" || { echo "[deploy] FATAL: makeHttpSendText missing in staged send-text-rail.ts"; exit 1; }
grep -q "send_text" "$STAGE/server/lib/operator-tools.ts" || { echo "[deploy] FATAL: send_text tool missing in staged operator-tools.ts"; exit 1; }
echo "[deploy] staged 5 files verified (markers present, LF-normalized)"

# -- 2. backup the live files we are about to overwrite ---------------------
mkdir -p "$BAK/server/lib" "$BAK/server/routes"
for f in $MOD_FILES; do
  test -s "$APP/$f" || { echo "[deploy] FATAL: live $f missing/empty -- refusing to deploy without a backup source"; exit 1; }
  cp -a "$APP/$f" "$BAK/$f"
  test -s "$BAK/$f" || { echo "[deploy] FATAL: backup of $f failed"; exit 1; }
done
cp -a "$ENV" "$BAK/.env"; test -s "$BAK/.env" || { echo "[deploy] FATAL: .env backup failed"; exit 1; }
NEW_RAIL_PREEXISTING=0
if [ -e "$APP/$NEW_FILE" ]; then NEW_RAIL_PREEXISTING=1; cp -a "$APP/$NEW_FILE" "$BAK/$NEW_FILE"; fi
echo "[deploy] backed up 4 live files + .env -> $BAK (new-file preexisting=$NEW_RAIL_PREEXISTING)"

# -- revert (used on ANY verification failure) ------------------------------
revert() {
  echo "[deploy] !! reverting: restore 4 files + .env, handle new file, recreate"
  for f in $MOD_FILES; do cp -a "$BAK/$f" "$APP/$f"; done
  if [ "$NEW_RAIL_PREEXISTING" = "1" ]; then cp -a "$BAK/$NEW_FILE" "$APP/$NEW_FILE"; else rm -f "$APP/$NEW_FILE"; fi
  cp -a "$BAK/.env" "$ENV"
  ( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" ) >/dev/null 2>&1 || true
}

# -- 3. sync the 5 files into the live bind mount ---------------------------
for f in $MOD_FILES $NEW_FILE; do install -D -m 644 "$STAGE/$f" "$APP/$f"; done
echo "[deploy] synced 5 files into $APP/server"

# -- 4. add GATEWAY_TEXT_URL to .env (idempotent; INTERNAL_PUSH_SECRET untouched) --
if grep -q "^GATEWAY_TEXT_URL=" "$ENV"; then
  sed -i "s|^GATEWAY_TEXT_URL=.*|GATEWAY_TEXT_URL=${GATEWAY_URL}|" "$ENV"
  echo "[deploy] GATEWAY_TEXT_URL replaced in .env"
else
  printf '\nGATEWAY_TEXT_URL=%s\n' "$GATEWAY_URL" >> "$ENV"
  echo "[deploy] GATEWAY_TEXT_URL appended to .env"
fi

# -- 5. recreate (tsx is NOT watch mode; .env changed -> recreate mandatory) --
( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" )
echo "[deploy] up -d --force-recreate $SVC issued"

# -- 6. verify (auto-revert on any failure) ---------------------------------
# 6a. boot gate: poll health until healthy
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

# 6b. hard-crash signatures in this boot's logs (import-sufficiency etc.)
if docker logs --since 3m "$CN" 2>&1 | grep -qiE 'SyntaxError|Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ReferenceError'; then
  echo "[deploy] FATAL: boot-crash signature in logs"; docker logs --since 3m "$CN" 2>&1 | tail -50; revert; exit 1
fi

# 6c. live container actually runs the 3-arg assistantRoute (the new wiring)
LIVE3=$(docker exec "$CN" sh -c "grep -c 'claude: deps.claude, sendText: deps.sendText' /app/server/index.ts" 2>/dev/null || echo 0)
[ "${LIVE3:-0}" -ge 1 ] || { echo "[deploy] FATAL: 3-arg assistantRoute NOT in live container (count=$LIVE3)"; revert; exit 1; }
echo "[deploy] live index.ts 3-arg assistantRoute present (count=$LIVE3)"

# 6d. new rail file present in live container
LIVERAIL=$(docker exec "$CN" sh -c "test -f /app/server/lib/send-text-rail.ts && echo 1 || echo 0" 2>/dev/null || echo 0)
[ "${LIVERAIL:-0}" = "1" ] || { echo "[deploy] FATAL: send-text-rail.ts NOT in live container"; revert; exit 1; }
echo "[deploy] live send-text-rail.ts present"

# 6e. GATEWAY_TEXT_URL propagated into the running container env (proves env_file load)
ENVOK=$(docker exec "$CN" sh -c 'test -n "$GATEWAY_TEXT_URL" && echo SET || echo EMPTY' 2>/dev/null || echo ERR)
[ "$ENVOK" = "SET" ] || { echo "[deploy] FATAL: GATEWAY_TEXT_URL not in container env (got=$ENVOK)"; revert; exit 1; }
echo "[deploy] GATEWAY_TEXT_URL present in container env"

echo "[deploy] DONE -- OpenLevel slice 3D LIVE. send_text rail wired to gateway. Backup: $BAK"
echo "[deploy] NOTE: disclaimer flip (step 5) is NOT part of this deploy -- gated on a real end-to-end send."
