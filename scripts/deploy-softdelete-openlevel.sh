#!/usr/bin/env bash
# OpenLevel : DEPLOY the operator "Delete contact" soft-delete (archive/restore).
# MUTATES live files on the openlevel-api bind mount (db/schema.sql + two backend .ts)
# AND the openlevel-web dist (index.html + assets/) -> runs UNDER FLOCK on the openlevel lock.
#
# Ordering is load-bearing (advisor): MIGRATE FIRST. The new backend filters
# `archived_at IS NULL`; if that code ran before the column existed, every
# contacts list + the assistant count would 500. So:
#   1. sync db/schema.sql + run db/migrate.ts  (adds `archived_at` while the OLD
#      code -- which never references the column -- is still serving, unaffected)
#   2. sync contacts-repo.ts + contacts.ts + force-recreate  (now the column exists)
#   3. sync the frontend build
#
# The prod api does NOT auto-apply schema on boot (server/index.ts bootstrap just
# connects a pg Pool) -- migrate is an explicit step; a recreate alone won't add
# the column. migrate.ts runs INSIDE the container against its own DATABASE_URL,
# so the secret is never printed or seen here.
#
# schema.sql is pure idempotent DDL (every statement IF NOT EXISTS) and its only
# delta from prod is the 9-line archived_at block, so a full migrate.ts run is a
# no-op except ADD COLUMN + the partial index.
#
# The dist sw.js is the no-cache (network-only) worker and sw.js/manifest/icons
# are out-of-band statics (NOT produced by `vite build`) -> replace ONLY
# index.html + assets/, leave the PWA root files untouched. A refresh serves the
# new bundle (no stale-shell risk by the SW's design).
#
# Payload (built locally, scp'd to $TGZ): db/schema.sql + server/repos/contacts-repo.ts
# + server/routes/contacts.ts + dist/index.html + dist/assets/.
# Boot gate = `docker inspect health`. On ANY post-recreate failure: restore the
# two .ts + dist, recreate. The migrated column is forward-only (never un-migrated).
set -euo pipefail

APP=/opt/openlevel/app
DIST=/opt/openlevel/dist
COMPOSE_DIR=/opt/openlevel
SVC=api                 # docker compose service key
CN=openlevel-api        # container name
LOCKDIR=/opt/openclaw/.locks
LOCK="$LOCKDIR/openlevel-compose.lock"
TGZ=/tmp/openlevel-softdelete.tgz
STAGE=/tmp/openlevel-softdelete-stage
STAMP=$(date +%Y%m%d-%H%M%S)
BAK="/opt/openlevel/.backups/softdelete-${STAMP}"

# -- 1. flock ----------------------------------------------------------------
mkdir -p "$LOCKDIR"
exec 9>"$LOCK"
flock -w 90 9 || { echo "[deploy] FATAL: could not acquire openlevel lock $LOCK"; exit 1; }
echo "[deploy] lock acquired"

# -- 2. stage + verify the payload ------------------------------------------
test -f "$TGZ" || { echo "[deploy] FATAL: staging tarball $TGZ missing"; exit 1; }
rm -rf "$STAGE"; mkdir -p "$STAGE"
tar xzf "$TGZ" -C "$STAGE"
for f in db/schema.sql server/repos/contacts-repo.ts server/routes/contacts.ts; do
  test -s "$STAGE/$f" || { echo "[deploy] FATAL: staged $f missing/empty"; exit 1; }
  sed -i 's/\r$//' "$STAGE/$f"   # LF-normalize (authored on Windows)
done
grep -q "ADD COLUMN IF NOT EXISTS archived_at" "$STAGE/db/schema.sql" || { echo "[deploy] FATAL: archived_at ALTER missing in staged schema.sql"; exit 1; }
grep -q "contacts_live" "$STAGE/db/schema.sql" || { echo "[deploy] FATAL: contacts_live index missing in staged schema.sql"; exit 1; }
grep -q "listArchived" "$STAGE/server/repos/contacts-repo.ts" || { echo "[deploy] FATAL: listArchived marker missing in staged contacts-repo.ts"; exit 1; }
grep -q "archived_at IS NULL" "$STAGE/server/repos/contacts-repo.ts" || { echo "[deploy] FATAL: live-filter marker missing in staged contacts-repo.ts"; exit 1; }
grep -q "'/archived'" "$STAGE/server/routes/contacts.ts" || { echo "[deploy] FATAL: /archived route marker missing in staged contacts.ts"; exit 1; }
grep -q "'/:id/restore'" "$STAGE/server/routes/contacts.ts" || { echo "[deploy] FATAL: restore route marker missing in staged contacts.ts"; exit 1; }
test -s "$STAGE/dist/index.html" || { echo "[deploy] FATAL: staged dist/index.html missing/empty"; exit 1; }
test -d "$STAGE/dist/assets" || { echo "[deploy] FATAL: staged dist/assets missing"; exit 1; }
STAGED_JS=$(find "$STAGE/dist/assets" -name '*.js' | head -1)
test -s "$STAGED_JS" || { echo "[deploy] FATAL: no built JS in staged dist/assets"; exit 1; }
NEWHASH=$(basename "$STAGED_JS")
grep -q "$NEWHASH" "$STAGE/dist/index.html" || { echo "[deploy] FATAL: staged index.html does not reference $NEWHASH"; exit 1; }
echo "[deploy] staged payload verified (schema + repo + route markers; index.html references $NEWHASH)"

# -- 3. backup the live files we are about to overwrite ---------------------
mkdir -p "$BAK/db" "$BAK/server/repos" "$BAK/server/routes" "$BAK/dist"
for f in db/schema.sql server/repos/contacts-repo.ts server/routes/contacts.ts; do
  test -s "$APP/$f" || { echo "[deploy] FATAL: live $f missing -- refusing to deploy without a backup source"; exit 1; }
  cp -a "$APP/$f" "$BAK/$f"
done
cp -a "$DIST/index.html" "$BAK/dist/index.html"
cp -a "$DIST/assets" "$BAK/dist/assets"
test -s "$BAK/db/schema.sql" && test -s "$BAK/server/repos/contacts-repo.ts" && test -s "$BAK/server/routes/contacts.ts" && test -s "$BAK/dist/index.html" && test -d "$BAK/dist/assets" || { echo "[deploy] FATAL: backup failed"; exit 1; }
echo "[deploy] backed up live schema.sql + contacts-repo.ts + contacts.ts + dist -> $BAK"

# -- revert (post-recreate failure): restore code + dist, recreate ----------
# The migrated `archived_at` column is forward-only (idempotent, ignored by old
# code) -- we never un-migrate. schema.sql stays new (matches the migrated DB).
revert() {
  echo "[deploy] !! reverting: restore contacts-repo.ts + contacts.ts + dist, recreate $SVC"
  cp -a "$BAK/server/repos/contacts-repo.ts" "$APP/server/repos/contacts-repo.ts"
  cp -a "$BAK/server/routes/contacts.ts" "$APP/server/routes/contacts.ts"
  cp -a "$BAK/dist/index.html" "$DIST/index.html"
  rm -rf "$DIST/assets"; cp -a "$BAK/dist/assets" "$DIST/assets"
  ( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" ) >/dev/null 2>&1 || true
}

# -- 4. MIGRATE FIRST: sync schema.sql, run migrate.ts ----------------------
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

# 4a. confirm the column exists (belt-and-suspenders; runs inside /app/db so 'pg'
# resolves from /app/node_modules). Prints ONLY a boolean; never the DATABASE_URL.
HOSTCHK=/tmp/ol-archcheck.ts
cat > "$HOSTCHK" <<'EOF'
import { Pool } from 'pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const r = await pool.query(
  "SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='archived_at'",
)
console.log('COL_EXISTS=' + ((r.rowCount ?? 0) > 0))
await pool.end()
EOF
docker cp "$HOSTCHK" "$CN":/app/db/.ol-archcheck.ts >/dev/null 2>&1 || true
COLOUT=$(docker exec "$CN" sh -c 'cd /app && npx tsx db/.ol-archcheck.ts' 2>&1 || true)
docker exec "$CN" sh -c 'rm -f /app/db/.ol-archcheck.ts' >/dev/null 2>&1 || true
rm -f "$HOSTCHK"
echo "[deploy] column check: $COLOUT"
printf '%s' "$COLOUT" | grep -q "COL_EXISTS=true" || { echo "[deploy] FATAL: archived_at column not confirmed after migrate. Old api still serving (no code synced)."; exit 1; }
echo "[deploy] archived_at column confirmed present"

# -- 5. BACKEND: sync both .ts + recreate -----------------------------------
install -D -m 644 "$STAGE/server/repos/contacts-repo.ts" "$APP/server/repos/contacts-repo.ts"
install -D -m 644 "$STAGE/server/routes/contacts.ts" "$APP/server/routes/contacts.ts"
echo "[deploy] synced contacts-repo.ts + contacts.ts into $APP/server"
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

# 5c. live container actually has the new code
LIVEREPO=$(docker exec "$CN" sh -c "grep -c 'listArchived' /app/server/repos/contacts-repo.ts" 2>/dev/null || echo 0)
LIVEROUTE=$(docker exec "$CN" sh -c "grep -c \"'/archived'\" /app/server/routes/contacts.ts" 2>/dev/null || echo 0)
[ "${LIVEREPO:-0}" -ge 1 ] || { echo "[deploy] FATAL: listArchived NOT in live container repo (count=$LIVEREPO)"; revert; exit 1; }
[ "${LIVEROUTE:-0}" -ge 1 ] || { echo "[deploy] FATAL: /archived route NOT in live container routes (count=$LIVEROUTE)"; revert; exit 1; }
echo "[deploy] live backend has soft-delete code (repo listArchived=$LIVEREPO, route /archived=$LIVEROUTE)"

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

echo "[deploy] DONE -- OpenLevel soft-delete LIVE. archived_at migrated + backend + frontend deployed. Backup: $BAK"
echo "[deploy] NEWHASH=$NEWHASH"
