#!/usr/bin/env bash
# READ-ONLY isolation check: prove the OpenLevel federation pipe end-to-end from INSIDE
# the gateway container (nginx route + token auth + tenant scope + buildToday), BEFORE
# any gateway env wiring. Token read from the box .env, passed via container env only -
# never printed (only its sha256 fp). Output is aggregate counts only (no PII).
set -uo pipefail
GW=agenthq-nerve-gateway

TOKEN=$(grep '^FEDERATION_SERVICE_TOKEN=' /opt/openlevel/.env | head -1 | cut -d= -f2-)
[ -n "$TOKEN" ] || { echo "FATAL: no FEDERATION_SERVICE_TOKEN in /opt/openlevel/.env"; exit 1; }
echo "token fp: $(printf '%s' "$TOKEN" | sha256sum | cut -c1-12)  (expect 9da7902dd799)"

FETCH_TODAY='fetch("http://openlevel-web/federation/today",{headers:{authorization:"Bearer "+process.env.TOK,"x-federation-operator":"bryan","x-federation-tenant":process.env.LOC}}).then(async r=>{const t=await r.text();let a=null;try{a=JSON.parse(t)}catch{}const arr=Array.isArray(a)?a:[];const h={};for(const it of arr)h[it.urgency]=(h[it.urgency]||0)+1;console.log("  status",r.status,"isArray",Array.isArray(a),"items",arr.length,"urgencyHist",JSON.stringify(h))}).catch(e=>console.log("  ERR",e.code||e.message))'

echo "=== A. capabilities (auth, no tenant) - DEFINITIVE wiring proof ==="
docker exec -e TOK="$TOKEN" "$GW" node -e 'fetch("http://openlevel-web/federation/capabilities",{headers:{authorization:"Bearer "+process.env.TOK}}).then(async r=>{const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}console.log("  status",r.status,"label",j&&j.label,"caps",j&&j.capabilities&&j.capabilities.length)}).catch(e=>console.log("  ERR",e.code||e.message))' 2>/dev/null

echo "=== B. today loc_bryan_insurance (auth + tenant) ==="
docker exec -e TOK="$TOKEN" -e LOC=loc_bryan_insurance "$GW" node -e "$FETCH_TODAY" 2>/dev/null

echo "=== C. today loc_jahfeel (auth + tenant) ==="
docker exec -e TOK="$TOKEN" -e LOC=loc_jahfeel "$GW" node -e "$FETCH_TODAY" 2>/dev/null

echo "=== D. negative: wrong token -> expect 401 ==="
docker exec -e LOC=loc_bryan_insurance "$GW" node -e 'fetch("http://openlevel-web/federation/today",{headers:{authorization:"Bearer deadbeefwrong","x-federation-tenant":process.env.LOC}}).then(r=>console.log("  status",r.status)).catch(e=>console.log("  ERR",e.code||e.message))' 2>/dev/null

echo "=== E. negative: auth ok but NO tenant -> expect 400 ==="
docker exec -e TOK="$TOKEN" "$GW" node -e 'fetch("http://openlevel-web/federation/today",{headers:{authorization:"Bearer "+process.env.TOK}}).then(r=>console.log("  status",r.status)).catch(e=>console.log("  ERR",e.code||e.message))' 2>/dev/null

echo "=== F. DB: loc_bryan_insurance open-task due windows (what 'today' would show) ==="
cat > /tmp/_fedcheck.sql <<'SQL'
SELECT
  count(*) FILTER (WHERE completed_at IS NULL) AS open_total,
  count(*) FILTER (WHERE completed_at IS NULL AND due_at IS NOT NULL AND due_at < now()) AS overdue,
  count(*) FILTER (WHERE completed_at IS NULL AND due_at IS NOT NULL AND due_at <= now() + interval '2 days') AS due_within_2d,
  to_char(min(due_at) FILTER (WHERE completed_at IS NULL), 'YYYY-MM-DD') AS earliest_due,
  to_char(max(due_at) FILTER (WHERE completed_at IS NULL), 'YYYY-MM-DD') AS latest_due
FROM contact_tasks WHERE location_id = 'loc_bryan_insurance';
SQL
docker cp /tmp/_fedcheck.sql openlevel-postgres:/tmp/_fedcheck.sql >/dev/null 2>&1
echo "  open_total|overdue|due_within_2d|earliest_due|latest_due"
docker exec openlevel-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -f /tmp/_fedcheck.sql' 2>/dev/null || echo "  (query failed)"
docker exec openlevel-postgres rm -f /tmp/_fedcheck.sql >/dev/null 2>&1 || true
rm -f /tmp/_fedcheck.sql
echo "=== isolation check done ==="
