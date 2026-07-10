#!/usr/bin/env bash
# READ-ONLY clock + due-date sanity check. The federation /today for loc_bryan_insurance
# returned 6 TASK_DUE items, but a postgres `now()`-based count said only 2 tasks are due
# within 2 days. buildToday uses the api container's new Date(); the SQL used postgres now().
# If those clocks disagree (sim container skew), the gap is explained and harmless. If the
# api clock is WRONG, the "today" feed is misleading and must NOT be activated. This decides.
# No mutation, no lock.
set -uo pipefail

echo "=== clocks (UTC) ==="
echo -n "  host:            "; date -u +%Y-%m-%dT%H:%M:%SZ
echo -n "  api container:   "; docker exec openlevel-api sh -c 'date -u +%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "(exec failed)"
echo -n "  api new Date():  "; docker exec openlevel-api node -e 'console.log(new Date().toISOString())' 2>/dev/null || echo "(node failed)"
echo -n "  pg container:    "; docker exec openlevel-postgres sh -c 'date -u +%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "(exec failed)"
echo -n "  pg now():        "; docker exec openlevel-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tA -c \"select to_char(now() at time zone 'UTC','YYYY-MM-DD\\\"T\\\"HH24:MI:SS\\\"Z\\\"')\"" 2>/dev/null || echo "(psql failed)"

echo "=== loc_bryan_insurance open-task due_at (UTC, sorted) - timestamps only, no names ==="
cat > /tmp/_clockcheck.sql <<'SQL'
SELECT to_char(due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS due_utc,
       CASE WHEN due_at < now() THEN 'overdue'
            WHEN due_at <= now() + interval '2 days' THEN 'within2d'
            ELSE 'future' END AS bucket
FROM contact_tasks
WHERE location_id = 'loc_bryan_insurance' AND completed_at IS NULL AND due_at IS NOT NULL
ORDER BY due_at;
SQL
docker cp /tmp/_clockcheck.sql openlevel-postgres:/tmp/_clockcheck.sql >/dev/null 2>&1
docker exec openlevel-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -f /tmp/_clockcheck.sql' 2>/dev/null || echo "  (query failed)"
docker exec openlevel-postgres rm -f /tmp/_clockcheck.sql >/dev/null 2>&1 || true
rm -f /tmp/_clockcheck.sql
echo "=== clockcheck done ==="
