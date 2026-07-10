#!/usr/bin/env bash
# OpenLevel : ACTIVATE the federation surface (app side). Two location-agnostic steps,
# one flock on the openlevel compose lock:
#
#   (a) nginx: add `location /federation/` so openlevel-web proxies /federation/* to the
#       Hono api. WITHOUT this, the SPA fallback (location /) swallows /federation/* and
#       returns index.html (HTTP 200 HTML) - the gateway would fail to parse JSON and
#       silently show nothing. Graceful reload (nginx -t gate; no api restart).
#   (b) token: set FEDERATION_SERVICE_TOKEN in /opt/openlevel/.env (openssl rand -hex 32 =
#       64 chars) + recreate the api so it re-reads env_file. THIS is the first step that
#       can crash live OpenLevel: config.ts prod-validates the token at boot under
#       NODE_ENV=production, so the recreate is HEALTH-GATED with auto-rollback (remove the
#       line + recreate) on any failure.
#
# Verifies the real call path from INSIDE the gateway container (docker net), not the host:
#   after (a):  gw -> http://openlevel-web/federation/today (no auth) == 503  (reached api, inert)
#   after (b):  same call                                              == 401  (token live)
# The authed 200 isolation check + the gateway env wiring are SEPARATE later steps (the
# tenant/location id is a product choice). This script never echoes the raw token.
set -uo pipefail

COMPOSE_DIR=/opt/openlevel
SVC=api
CN=openlevel-api
WEB=openlevel-web
GW=agenthq-nerve-gateway
LOCKDIR=/opt/openclaw/.locks
LOCK="$LOCKDIR/openlevel-compose.lock"
NGINX_LIVE=/opt/openlevel/nginx.conf
ENVF=/opt/openlevel/.env
STAMP=$(date +%Y%m%d-%H%M%S)
NGINX_BAK="${NGINX_LIVE}.bak-fed-${STAMP}"
NGINX_TMP="/tmp/openlevel-nginx-fed-${STAMP}.conf"
ENV_BAK="${ENVF}.bak-fed-${STAMP}"

# status of a path from INSIDE the gateway container (the real call path), no auth
gw_status() {
  docker exec -e P="$1" "$GW" node -e \
    'fetch("http://openlevel-web"+process.env.P).then(r=>console.log(r.status)).catch(e=>console.log("ERR",e.code||e.message))' \
    2>/dev/null || echo ERR
}

# poll gw_status until it equals WANT. nginx -s reload is GRACEFUL (old workers drain
# for a moment) and an api recreate takes a beat to bind - so a single check can race.
# $1=path $2=want $3=tries(default 20). Echoes the last status; returns 1 if never matched.
wait_status() {
  local i s=""
  for i in $(seq 1 "${3:-20}"); do
    s=$(gw_status "$1")
    [ "$s" = "$2" ] && { echo "$s"; return 0; }
    sleep 1
  done
  echo "$s"; return 1
}

set -e
mkdir -p "$LOCKDIR"
exec 9>"$LOCK"
flock -w 90 9 || { echo "[act] FATAL: could not acquire openlevel lock $LOCK"; exit 1; }
echo "[act] lock acquired"

# ===== pre-flight =====
test -f "$NGINX_LIVE" || { echo "[act] FATAL: $NGINX_LIVE missing"; exit 1; }
test -f "$ENVF" || { echo "[act] FATAL: $ENVF missing"; exit 1; }
docker inspect "$CN" >/dev/null 2>&1 || { echo "[act] FATAL: $CN not running"; exit 1; }
docker inspect "$WEB" >/dev/null 2>&1 || { echo "[act] FATAL: $WEB not running"; exit 1; }
docker inspect "$GW" >/dev/null 2>&1 || { echo "[act] FATAL: $GW not running"; exit 1; }

# ===== (a) nginx /federation/ proxy =====
if docker exec "$WEB" grep -q 'location /federation/' /etc/nginx/conf.d/default.conf 2>/dev/null; then
  echo "[act] (a) nginx /federation/ already present - skipping edit"
else
  # Insert the /federation/ block immediately before the SPA fallback `location / {`.
  # awk string literals do NOT interpolate $ - $host/$uri stay literal in the output.
  awk '
    /^  location \/ \{/ && !ins {
      print "  # Hub federation surface (/federation/* on the Hono api). Internal only:"
      print "  # the nerve-gateway reaches it over the shared agenthq net via openlevel-web;"
      print "  # NOT a browser/SPA path. No trailing slash on proxy_pass keeps the full URI."
      print "  location /federation/ {"
      print "    proxy_pass http://api:8790;"
      print "    proxy_set_header Host $host;"
      print "    proxy_set_header X-Forwarded-Proto https;"
      print "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
      print "    proxy_read_timeout 120s;"
      print "  }"
      print ""
      ins=1
    }
    { print }
  ' "$NGINX_LIVE" > "$NGINX_TMP"
  grep -q 'location /federation/' "$NGINX_TMP" || { echo "[act] FATAL: awk did not insert /federation/ block"; rm -f "$NGINX_TMP"; exit 1; }
  # sanity: line count grew by exactly the block we added (3 comments + location{ + 5 proxy + } + blank = 11)
  OLDN=$(wc -l < "$NGINX_LIVE"); NEWN=$(wc -l < "$NGINX_TMP")
  [ "$((NEWN - OLDN))" -eq 11 ] || { echo "[act] FATAL: unexpected nginx delta ($OLDN -> $NEWN, want +11)"; rm -f "$NGINX_TMP"; exit 1; }
  # validation passed - NOW back up the live file and swap in the new one
  cp -a "$NGINX_LIVE" "$NGINX_BAK"
  cp -a "$NGINX_TMP" "$NGINX_LIVE"; rm -f "$NGINX_TMP"
  if ! docker exec "$WEB" nginx -t 2>/dev/null; then
    echo "[act] FATAL: nginx -t failed on new config - restoring backup, NOT reloading"
    cp -a "$NGINX_BAK" "$NGINX_LIVE"
    docker exec "$WEB" nginx -t 2>&1 | tail -8 || true
    exit 1
  fi
  docker exec "$WEB" nginx -s reload
  echo "[act] (a) nginx /federation/ block added + reloaded (graceful, no api restart). backup: $NGINX_BAK"
fi

# verify nginx now routes /federation/* to the api (poll past the graceful-reload drain).
# Expected status is 503 (no token) unless the token is already set (then 401).
if grep -q '^FEDERATION_SERVICE_TOKEN=' "$ENVF"; then WANT_A=401; else WANT_A=503; fi
SA=$(wait_status /federation/today "$WANT_A" 20) || true
echo "[act] (a) gateway -> openlevel-web/federation/today (no auth) = $SA  (want $WANT_A = reaches api, not SPA)"
[ "$SA" = "$WANT_A" ] || { echo "[act] FATAL: after nginx edit expected $WANT_A, got $SA (200 = still SPA-swallowed)"; exit 1; }

# ===== (b) FEDERATION_SERVICE_TOKEN on openlevel-api (HEALTH-GATED) =====
if grep -q '^FEDERATION_SERVICE_TOKEN=' "$ENVF"; then
  echo "[act] (b) FEDERATION_SERVICE_TOKEN already set in $ENVF - keeping it (no regen)"
  TOKSET=kept
else
  TOKEN=$(openssl rand -hex 32)
  [ "${#TOKEN}" -eq 64 ] || { echo "[act] FATAL: generated token not 64 chars (got ${#TOKEN})"; exit 1; }
  FP=$(printf '%s' "$TOKEN" | sha256sum | cut -c1-12)
  cp -a "$ENVF" "$ENV_BAK"
  umask 077
  grep -v '^FEDERATION_SERVICE_TOKEN=' "$ENVF" > "${ENVF}.tmp"
  printf 'FEDERATION_SERVICE_TOKEN=%s\n' "$TOKEN" >> "${ENVF}.tmp"
  mv "${ENVF}.tmp" "$ENVF"; chmod 600 "$ENVF"
  unset TOKEN
  echo "[act] (b) wrote FEDERATION_SERVICE_TOKEN (sha256 fp=$FP). backup: $ENV_BAK"
  TOKSET=new
fi

revert_token() {
  set +e   # cleanup must never abort mid-way under set -e
  echo "[act] !! reverting token: restore $ENVF from backup + recreate $SVC"
  if [ -f "$ENV_BAK" ]; then cp -a "$ENV_BAK" "$ENVF"; chmod 600 "$ENVF"; fi
  ( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" ) >/dev/null 2>&1 || true
}

if [ "$TOKSET" = "new" ]; then
  ( cd "$COMPOSE_DIR" && docker compose up -d --force-recreate "$SVC" )
  echo "[act] (b) up -d --force-recreate $SVC issued - health-gating..."
  READY=0
  for i in $(seq 1 45); do
    H=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}NOHEALTH{{end}}' "$CN" 2>/dev/null || echo ERR)
    case "$H" in
      healthy) READY=1; echo "[act] (b) health -> healthy"; break;;
      NOHEALTH) echo "[act] FATAL: no healthcheck on $CN"; revert_token; exit 1;;
      *) sleep 2;;
    esac
  done
  [ "$READY" = "1" ] || { echo "[act] FATAL: $CN never healthy after token - rolling back"; docker logs --since 3m "$CN" 2>&1 | tail -40 || true; revert_token; exit 1; }
  if docker logs --since 3m "$CN" 2>&1 | grep -qiE 'SyntaxError|Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ReferenceError|ZodError|Invalid environment|must be at least'; then
    echo "[act] FATAL: boot-crash / env-validation signature after token - rolling back"; docker logs --since 3m "$CN" 2>&1 | tail -40; revert_token; exit 1
  fi
  echo "[act] (b) api healthy after token, no crash signatures"
fi

# verify token LIVE: unauthed call now 401 (was 503). Poll (the api just recreated).
SB=$(wait_status /federation/today 401 20) || true
echo "[act] (b) gateway -> openlevel-web/federation/today (no auth) = $SB  (expect 401 = token live)"
[ "$SB" = "401" ] || { echo "[act] FATAL: expected 401 after token, got $SB"; [ "$TOKSET" = new ] && revert_token; exit 1; }

echo "[act] DONE - OpenLevel /federation/* reachable from the gateway + token LIVE (401 unauthed)."
echo "[act] Next (separate): authed isolation check with the real location id, then wire gateway env."
