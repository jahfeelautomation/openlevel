#!/usr/bin/env bash
# READ-ONLY recon for OpenLevel federation Stage 3 (token wiring). No mutation, no lock.
set -uo pipefail

echo "=== 1. openlevel-api: federation still live + inert (expect today=503, health ok) ==="
docker exec openlevel-api node -e 'fetch("http://localhost:"+(process.env.PORT||8790)+"/federation/today").then(r=>console.log("  today",r.status)).catch(e=>console.log("  today ERR",e.message))' 2>/dev/null || echo "  (api exec failed)"
docker exec openlevel-api node -e 'fetch("http://localhost:"+(process.env.PORT||8790)+"/health").then(r=>r.text()).then(t=>console.log("  health",t)).catch(e=>console.log("  health ERR",e.message))' 2>/dev/null || echo "  (api exec failed)"

echo "=== 2. gateway: v204 live ==="
docker inspect -f '  image={{.Config.Image}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' agenthq-nerve-gateway 2>/dev/null || echo "  (gateway inspect failed)"
docker exec agenthq-nerve-gateway node -e 'fetch("http://localhost:3000/health").then(r=>console.log("  gw-health",r.status)).catch(e=>console.log("  gw-health ERR",e.message))' 2>/dev/null || echo "  (gw exec failed)"

echo "=== 3. gateway -> openlevel-web reachability (DNS + current /federation routing) ==="
docker exec agenthq-nerve-gateway sh -c 'getent hosts openlevel-web || echo "  NO-DNS openlevel-web"' 2>/dev/null || echo "  (getent failed)"
docker exec agenthq-nerve-gateway node -e 'fetch("http://openlevel-web/federation/today").then(r=>console.log("  gw->web /federation/today",r.status)).catch(e=>console.log("  gw->web ERR",e.code||e.message))' 2>/dev/null || echo "  (gw fetch failed)"
docker exec agenthq-nerve-gateway node -e 'fetch("http://openlevel-web/health").then(r=>console.log("  gw->web /health",r.status)).catch(e=>console.log("  gw->web /health ERR",e.code||e.message))' 2>/dev/null || echo "  (gw fetch failed)"

echo "=== 4. current /opt/openlevel/nginx.conf (confirm unchanged before overwrite) ==="
sed -n '1,200p' /opt/openlevel/nginx.conf 2>/dev/null || echo "  (nginx.conf missing)"

echo "=== 5. token presence (counts only, NEVER values) ==="
echo -n "  openlevel .env FEDERATION_SERVICE_TOKEN lines: "; grep -c '^FEDERATION_SERVICE_TOKEN=' /opt/openlevel/.env 2>/dev/null || echo 0
echo -n "  gateway .env OPENLEVEL_FEDERATION* lines: ";       grep -c '^OPENLEVEL_FEDERATION' /opt/openclaw/agent-hq/.env 2>/dev/null || echo 0

echo "=== 6. openlevel locations + data counts (find the REAL tenant id) ==="
echo "  -- locations table --"
docker exec openlevel-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -c "SELECT id, name FROM locations ORDER BY id;"' 2>/dev/null || echo "  (no locations table / query failed)"
echo "  -- appointments by location --"
docker exec openlevel-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -c "SELECT location_id, count(*) FROM appointments GROUP BY location_id ORDER BY location_id;"' 2>/dev/null || echo "  (appointments query failed)"
echo "  -- contact_tasks by location (open / total) --"
docker exec openlevel-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -c "SELECT location_id, count(*) FILTER (WHERE completed_at IS NULL), count(*) FROM contact_tasks GROUP BY location_id ORDER BY location_id;"' 2>/dev/null || echo "  (contact_tasks query failed)"
echo "  -- contacts by location --"
docker exec openlevel-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -c "SELECT location_id, count(*) FROM contacts GROUP BY location_id ORDER BY location_id;"' 2>/dev/null || echo "  (contacts query failed)"

echo "=== recon done ==="
