#!/usr/bin/env bash
# OpenLevel : DEPLOY the "Add contact" fix (Contacts dialog + POST /loc/:loc/contacts).
# MUTATES live files on the openlevel-api bind mount (one backend .ts) AND the openlevel-web
# dist (index.html + assets/) -> runs UNDER FLOCK on the openlevel lock.
#
# Mechanic (same as slice 3D): api runs `npx tsx server/index.ts` with /opt/openlevel/app
# bind-mounted, so the backend is RAW TypeScript -> sync contacts.ts + force-recreate so tsx
# re-imports. The web service is stock nginx bind-mounting /opt/openlevel/dist -> replacing the
# build output is enough (no recreate). The PWA files at the dist ROOT (sw.js, manifest, icons)
# are out-of-band (NOT produced by `vite build`) -> we replace ONLY index.html + assets/ and
# leave them untouched. The sw.js is the no-cache worker, so a refresh serves the new bundle.
#
# Payload (built locally, scp'd to $TGZ): server/routes/contacts.ts + dist/index.html + dist/assets/.
# Backend first (the route must exist before any UI calls it), then frontend.
# Boot gate = `docker inspect health`. On ANY failure: restore contacts.ts + dist, recreate.
set -euo pipefail

APP=/opt/openlevel/app
DIST=/opt/openlevel/dist
COMPOSE_DIR=/opt/openlevel
SVC=api                 # docker compose service key
CN=openlevel-api        # container name
LOCKDIR=/opt/openclaw/.locks
LOCK="$LOCKDIR/openlevel-compose.lock"
TGZ=/tmp/openlevel-addcontact.tgz
STAGE=/tmp/openlevel-addcontact-stage
STAMP=$(date +%Y%m%d-%H%M%S)
BAK="/opt/openlevel/.backups/addcontact-${STAMP}"

# -- 1. flock ----------------------------------------------------------------
mkdir -p "$LOCKDIR"
exec 9>"$LOCK"
flock -w 90 9 || { echo "[deploy] FATAL: could not acquire openlevel lock $LOCK"; exit 1; }
echo "[deploy] lock acquired"

# -- 2. stage + verify the payload ------------------------------------------
test -f "$TGZ" || { echo "[deploy] FATAL: staging tarball $TGZ missing"; exit 1; }
rm -rf "$STAGE"; mkdir -p "$STAGE"
tar xzf "$TGZ" -C "$STAGE"
sed -i 's/\r$//' "$STAGE/server/routes/contacts.ts"   # LF-normalize the .ts (canonical)
test -s "$STAGE/server/routes/contacts.ts" || { echo "[deploy] FATAL: staged contacts.ts missing/empty"; exit 1; }
grep -q "createContactSchema = z" "$STAGE/server/routes/contacts.ts" || { echo "[deploy] FATAL: createContactSchema marker missing in staged contacts.ts"; exit 1; }
grep -q "ok: true, contact" "$STAGE/server/routes/contacts.ts" || { echo "[deploy] FATAL: POST-route marker missing in staged contacts.ts"; exit 1; }
test -s "$STAGE/dist/index.html" || { echo "[deploy] FATAL: staged dist/index.html missing/empty"; exit 1; }
test -d "$STAGE/dist/assets" || { echo "[deploy] FATAL: staged dist/assets missing"; exit 1; }
STAGED_JS=$(find "$STAGE/dist/assets" -name '*.js' | head -1)
test -s "$STAGED_JS" || { echo "[deploy] FATAL: no built JS in staged dist/assets"; exit 1; }
NEWHASH=$(basename "$STAGED_JS")
grep -q "$NEWHASH" "$STAGE/dist/index.html" || { echo "[deploy] FATAL: staged index.html does not reference $NEWHASH"; exit 1; }
echo "[deploy] staged payload verified (contacts.ts markers + index.html references $NEWHASH)"

# -- 3. backup the live files we are about to overwrite ---------------------
mkdir -p "$BAK/server/routes" "$BAK/dist"
test -s "$APP/server/routes/contacts.ts" || { echo "[deploy] FATAL: live contacts.ts missing -- refusing to deploy without a backup source"; exit 1; }
cp -a "$APP/server/routes/contacts.ts" "$BAK/server/routes/contacts.ts"
cp -a "$DIST/index.html" "$BAK/dist/index.html"
cp -a "$DIST/assets" "$BAK/dist/assets"
test -s "$BAK/server/routes/contacts.ts" && test -s "$BAK/dist/index.html" && test -d "$BAK/dist/assets" || { echo "[deploy] FATAL: backup failed"; exit 1; }
echo "[deploy] backed up live contacts.ts + dist/index.html + dist/assets -> $BAK"

# -- revert (used on ANY verification failure) ------------------------------
revert() {
  echo "[deploy] !! reverting: restore contacts.ts + dist, recreate $SVC"
  cp -a "$BAK/server/routes/contacts.ts" "$APP/server/routes/contacts.ts"
  cp -a "$BAK/dist/index.html" "$DIST/index.html"
  rm -rf "$DIST/assets"; cp -a "$BAK/dist/assets" "$DIST/assets"
  ( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" ) >/dev/null 2>&1 || true
}

# -- 4. BACKEND FIRST: sync contacts.ts + recreate --------------------------
install -D -m 644 "$STAGE/server/routes/contacts.ts" "$APP/server/routes/contacts.ts"
echo "[deploy] synced contacts.ts into $APP/server/routes"
( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" )
echo "[deploy] up -d --force-recreate $SVC issued"

# 4a. boot gate: poll health until healthy
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

# 4b. hard-crash signatures in this boot's logs
if docker logs --since 3m "$CN" 2>&1 | grep -qiE 'SyntaxError|Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ReferenceError'; then
  echo "[deploy] FATAL: boot-crash signature in logs"; docker logs --since 3m "$CN" 2>&1 | tail -50; revert; exit 1
fi

# 4c. live container actually has the POST route (the new wiring)
LIVEPOST=$(docker exec "$CN" sh -c "grep -c 'createContactSchema = z' /app/server/routes/contacts.ts" 2>/dev/null || echo 0)
[ "${LIVEPOST:-0}" -ge 1 ] || { echo "[deploy] FATAL: createContactSchema NOT in live container (count=$LIVEPOST)"; revert; exit 1; }
echo "[deploy] live contacts.ts has the create route (count=$LIVEPOST)"

# -- 5. FRONTEND: replace index.html + assets/, PRESERVE root PWA files ------
install -D -m 644 "$STAGE/dist/index.html" "$DIST/index.html"
rm -rf "$DIST/assets"; cp -a "$STAGE/dist/assets" "$DIST/assets"
chmod -R a+rX "$DIST/assets"; chmod a+r "$DIST/index.html"
echo "[deploy] synced dist/index.html + dist/assets (PWA root files preserved)"

# 5a. verify on disk: new bundle present + referenced, PWA files intact
test -f "$DIST/assets/$NEWHASH" || { echo "[deploy] FATAL: new bundle $NEWHASH not on disk after sync"; revert; exit 1; }
grep -q "$NEWHASH" "$DIST/index.html" || { echo "[deploy] FATAL: live index.html does not reference $NEWHASH after sync"; revert; exit 1; }
PWA_OK=1
for f in sw.js manifest.webmanifest icon-192.png icon-512.png icon-512-maskable.png; do
  test -f "$DIST/$f" || { echo "[deploy] WARN: PWA file $DIST/$f missing after sync"; PWA_OK=0; }
done
[ "$PWA_OK" = "1" ] && echo "[deploy] PWA root files (sw.js, manifest, icons) intact" || echo "[deploy] WARN: one or more PWA root files missing (not fatal; assets+index OK)"

echo "[deploy] DONE -- OpenLevel Add contact LIVE. Backend route + dialog deployed. Backup: $BAK"
echo "[deploy] NEWHASH=$NEWHASH"
