#!/usr/bin/env bash
# OpenLevel : DEPLOY the per-state legal texting-hours wiring (State on the contact).
# MUTATES live files on the openlevel-api bind mount (db/schema.sql + four backend .ts)
# AND the openlevel-web dist (index.html + assets/) -> runs UNDER FLOCK on the openlevel lock.
#
# Pairs with nerve-gateway:v202 (already LIVE), which is the single legal authority that
# turns a contact's `state` into the 8am-9pm window in THAT state's own timezone (AZ+NC,
# DST-aware) and BLOCKS a blank/unknown state as unknown_state. This OL side:
#   - contacts.state column (already migrated this session; re-confirmed below)
#   - contacts-repo.ts state/setState, contacts.ts PUT /:id/state
#   - operator-tools.ts threads the contact's state through send_text
#   - send-text-rail.ts carries `state` in the gateway POST body
#   - dist: the State dropdown on the contact record
#
# Ordering is load-bearing (migrate-first): the new contacts-repo.ts SELECTs `state`; if
# that code ran before the column existed, every contacts list + the assistant count would
# 500. So: (1) sync schema.sql + run migrate.ts (idempotent ADD COLUMN IF NOT EXISTS state,
# a no-op since the column is already migrated) + confirm the column, (2) sync the 4 .ts +
# recreate, (3) sync the frontend build. migrate.ts runs INSIDE the container against its
# own DATABASE_URL, so the secret is never printed or seen here.
#
# Until this ships, the live OL sends NO state -> gateway v202 refuses every assistant text
# as unknown_state (fail-closed). Nothing illegal can leak in the transient.
#
# The dist sw.js/manifest/icons are out-of-band statics (NOT produced by `vite build`) ->
# replace ONLY index.html + assets/, leave the PWA root files untouched.
#
# RIGOR (matches the gateway + slice3): the 4 .ts are the ONLY copy of the running version
# (loose files, no git on box) -> BACK THEM UP before overwrite. Boot gate = docker inspect
# health. On ANY post-recreate failure: restore the 4 .ts + dist, recreate. The migrated
# `state` column is forward-only (idempotent, ignored by old code) -- never un-migrated.
set -euo pipefail

APP=/opt/openlevel/app
DIST=/opt/openlevel/dist
COMPOSE_DIR=/opt/openlevel
SVC=api                 # docker compose service key
CN=openlevel-api        # container name
LOCKDIR=/opt/openclaw/.locks
LOCK="$LOCKDIR/openlevel-compose.lock"
TGZ=/tmp/openlevel-perstate.tgz
STAGE=/tmp/openlevel-perstate-stage
STAMP=$(date +%Y%m%d-%H%M%S)
BAK="/opt/openlevel/.backups/perstate-${STAMP}"

MOD_FILES="server/lib/operator-tools.ts server/lib/send-text-rail.ts server/repos/contacts-repo.ts server/routes/contacts.ts"

# -- 1. flock ----------------------------------------------------------------
mkdir -p "$LOCKDIR"
exec 9>"$LOCK"
flock -w 90 9 || { echo "[deploy] FATAL: could not acquire openlevel lock $LOCK"; exit 1; }
echo "[deploy] lock acquired"

# -- 2. stage + verify the payload ------------------------------------------
test -f "$TGZ" || { echo "[deploy] FATAL: staging tarball $TGZ missing"; exit 1; }
rm -rf "$STAGE"; mkdir -p "$STAGE"
tar xzf "$TGZ" -C "$STAGE"
for f in db/schema.sql $MOD_FILES; do
  test -s "$STAGE/$f" || { echo "[deploy] FATAL: staged $f missing/empty"; exit 1; }
  sed -i 's/\r$//' "$STAGE/$f"   # LF-normalize (authored on Windows)
done
grep -q "ADD COLUMN IF NOT EXISTS state text" "$STAGE/db/schema.sql"        || { echo "[deploy] FATAL: state ALTER missing in staged schema.sql"; exit 1; }
grep -q "async setState(" "$STAGE/server/repos/contacts-repo.ts"            || { echo "[deploy] FATAL: setState marker missing in staged contacts-repo.ts"; exit 1; }
grep -q "'/:id/state'" "$STAGE/server/routes/contacts.ts"                   || { echo "[deploy] FATAL: PUT /:id/state route marker missing in staged contacts.ts"; exit 1; }
grep -q "nonce: string, state: string" "$STAGE/server/lib/operator-tools.ts" || { echo "[deploy] FATAL: state-threaded SendTextFn marker missing in staged operator-tools.ts"; exit 1; }
grep -q "{ e164, body, nonce, state }" "$STAGE/server/lib/send-text-rail.ts" || { echo "[deploy] FATAL: state-in-body marker missing in staged send-text-rail.ts"; exit 1; }
test -s "$STAGE/dist/index.html" || { echo "[deploy] FATAL: staged dist/index.html missing/empty"; exit 1; }
test -d "$STAGE/dist/assets" || { echo "[deploy] FATAL: staged dist/assets missing"; exit 1; }
STAGED_JS=$(find "$STAGE/dist/assets" -name '*.js' | head -1)
test -s "$STAGED_JS" || { echo "[deploy] FATAL: no built JS in staged dist/assets"; exit 1; }
NEWHASH=$(basename "$STAGED_JS")
grep -q "$NEWHASH" "$STAGE/dist/index.html" || { echo "[deploy] FATAL: staged index.html does not reference $NEWHASH"; exit 1; }
echo "[deploy] staged payload verified (schema + 4 backend markers; index.html references $NEWHASH)"

# -- 3. backup the live files we are about to overwrite ---------------------
mkdir -p "$BAK/db" "$BAK/server/lib" "$BAK/server/repos" "$BAK/server/routes" "$BAK/dist"
test -s "$APP/db/schema.sql" && cp -a "$APP/db/schema.sql" "$BAK/db/schema.sql" || { echo "[deploy] FATAL: live db/schema.sql missing -- refusing without backup source"; exit 1; }
for f in $MOD_FILES; do
  test -s "$APP/$f" || { echo "[deploy] FATAL: live $f missing -- refusing to deploy without a backup source"; exit 1; }
  cp -a "$APP/$f" "$BAK/$f"
  test -s "$BAK/$f" || { echo "[deploy] FATAL: backup of $f failed"; exit 1; }
done
cp -a "$DIST/index.html" "$BAK/dist/index.html"
cp -a "$DIST/assets" "$BAK/dist/assets"
test -s "$BAK/dist/index.html" && test -d "$BAK/dist/assets" || { echo "[deploy] FATAL: dist backup failed"; exit 1; }
echo "[deploy] backed up live schema.sql + 4 .ts + dist -> $BAK"

# -- revert (post-recreate failure): restore the 4 .ts + dist, recreate -----
# The migrated `state` column is forward-only (idempotent, ignored by old code) -- never
# un-migrated. schema.sql stays new (matches the migrated DB).
revert() {
  echo "[deploy] !! reverting: restore 4 .ts + dist, recreate $SVC"
  for f in $MOD_FILES; do cp -a "$BAK/$f" "$APP/$f"; done
  cp -a "$BAK/dist/index.html" "$DIST/index.html"
  rm -rf "$DIST/assets"; cp -a "$BAK/dist/assets" "$DIST/assets"
  ( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" ) >/dev/null 2>&1 || true
}

# -- 4. MIGRATE FIRST: sync schema.sql, run migrate.ts (idempotent) ----------
install -D -m 644 "$STAGE/db/schema.sql" "$APP/db/schema.sql"
echo "[deploy] synced db/schema.sql into $APP/db"
set +e
MIGOUT=$(docker exec "$CN" sh -c 'cd /app && npx tsx db/migrate.ts' 2>&1)
MIGRC=$?
set -e
echo "[deploy] migrate.ts output: $MIGOUT"
if [ "$MIGRC" -ne 0 ] || ! printf '%s' "$MIGOUT" | grep -q "schema migrated"; then
  echo "[deploy] FATAL: migrate.ts failed (rc=$MIGRC). Restoring old schema.sql, no code touched, old api still serving."
  cp -a "$BAK/db/schema.sql" "$APP/db/schema.sql"
  exit 1
fi
echo "[deploy] migrate.ts succeeded"

# 4a. confirm the `state` column exists (belt-and-suspenders). Runs inside /app/db so 'pg'
# resolves from /app/node_modules. Prints ONLY a boolean; never the DATABASE_URL.
HOSTCHK=/tmp/ol-statechk.ts
cat > "$HOSTCHK" <<'EOF'
import { Pool } from 'pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const r = await pool.query(
  "SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='state'",
)
console.log('COL_EXISTS=' + ((r.rowCount ?? 0) > 0))
await pool.end()
EOF
docker cp "$HOSTCHK" "$CN":/app/db/.ol-statechk.ts >/dev/null 2>&1 || true
COLOUT=$(docker exec "$CN" sh -c 'cd /app && npx tsx db/.ol-statechk.ts' 2>&1 || true)
docker exec "$CN" sh -c 'rm -f /app/db/.ol-statechk.ts' >/dev/null 2>&1 || true
rm -f "$HOSTCHK"
echo "[deploy] column check: $COLOUT"
printf '%s' "$COLOUT" | grep -q "COL_EXISTS=true" || { echo "[deploy] FATAL: state column not confirmed after migrate. Old api still serving (no code synced)."; exit 1; }
echo "[deploy] state column confirmed present"

# -- 5. BACKEND: sync the 4 .ts + recreate ----------------------------------
for f in $MOD_FILES; do install -D -m 644 "$STAGE/$f" "$APP/$f"; done
echo "[deploy] synced 4 backend .ts into $APP/server"
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

# 5c. live container actually has all 4 new files
LIVEREPO=$(docker exec "$CN" sh -c "grep -c 'async setState(' /app/server/repos/contacts-repo.ts" 2>/dev/null || echo 0)
LIVEROUTE=$(docker exec "$CN" sh -c "grep -c \"'/:id/state'\" /app/server/routes/contacts.ts" 2>/dev/null || echo 0)
LIVETOOLS=$(docker exec "$CN" sh -c "grep -c 'nonce: string, state: string' /app/server/lib/operator-tools.ts" 2>/dev/null || echo 0)
LIVERAIL=$(docker exec "$CN" sh -c "grep -cF '{ e164, body, nonce, state }' /app/server/lib/send-text-rail.ts" 2>/dev/null || echo 0)
[ "${LIVEREPO:-0}" -ge 1 ]  || { echo "[deploy] FATAL: setState NOT in live repo (count=$LIVEREPO)"; revert; exit 1; }
[ "${LIVEROUTE:-0}" -ge 1 ] || { echo "[deploy] FATAL: PUT /:id/state NOT in live routes (count=$LIVEROUTE)"; revert; exit 1; }
[ "${LIVETOOLS:-0}" -ge 1 ] || { echo "[deploy] FATAL: state-threaded SendTextFn NOT in live operator-tools (count=$LIVETOOLS)"; revert; exit 1; }
[ "${LIVERAIL:-0}" -ge 1 ]  || { echo "[deploy] FATAL: state-in-body NOT in live send-text-rail (count=$LIVERAIL)"; revert; exit 1; }
echo "[deploy] live backend carries per-state code (repo=$LIVEREPO route=$LIVEROUTE tools=$LIVETOOLS rail=$LIVERAIL)"

# -- 6. FRONTEND: replace index.html + assets/, PRESERVE root PWA files ------
install -D -m 644 "$STAGE/dist/index.html" "$DIST/index.html"
rm -rf "$DIST/assets"; cp -a "$STAGE/dist/assets" "$DIST/assets"
chmod -R a+rX "$DIST/assets"; chmod a+r "$DIST/index.html"
echo "[deploy] synced dist/index.html + dist/assets (PWA root files preserved)"

# 6a. verify on disk: new bundle present + referenced, PWA files intact
test -f "$DIST/assets/$NEWHASH" || { echo "[deploy] FATAL: new bundle $NEWHASH not on disk after sync"; revert; exit 1; }
grep -q "$NEWHASH" "$DIST/index.html" || { echo "[deploy] FATAL: live index.html does not reference $NEWHASH after sync"; revert; exit 1; }
PWA_OK=1
for f in sw.js manifest.webmanifest icon-192.png icon-512.png icon-512-maskable.png; do
  test -f "$DIST/$f" || { echo "[deploy] WARN: PWA file $DIST/$f missing after sync"; PWA_OK=0; }
done
[ "$PWA_OK" = "1" ] && echo "[deploy] PWA root files (sw.js, manifest, icons) intact" || echo "[deploy] WARN: one or more PWA root files missing (not fatal; assets+index OK)"

echo "[deploy] DONE -- OpenLevel per-state legal texting hours LIVE. State on the contact + dropdown; rail carries state to gateway v202. Backup: $BAK"
echo "[deploy] NEWHASH=$NEWHASH"
echo "[deploy] NOTE: disclaimer flip is NOT part of this deploy -- gated on a real end-to-end send to Bryan."
