/**
 * Phase 0 database setup (isolated). Idempotent; safe to re-run.
 *
 *  1. Guard: refuse unless PHASE0_DATABASE_URL targets a phase0_* database.
 *  2. Ensure the DBOS system schema exists (internal ensureSystemDatabase —
 *     pinned SDK 5.5.0 API, verified in installed .d.ts).
 *  3. Apply p1/p3 prototype schemas (IF NOT EXISTS throughout).
 *  4. Ensure restricted runtime role exists (created by bootstrap superuser).
 *  5. Grant runtime role rights within the scratch DB only.
 *  6. Verify: list created relations; print server version (no secrets).
 *
 * Run: node --import tsx phase0/setup-db.ts   (with PHASE0_DATABASE_URL set)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
// Internal SDK entry points (pinned 5.5.0, verified present in dist .d.ts):
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- subpath types resolve at runtime; compile gate allows via skipLibCheck boundary
import { ensureSystemDatabase } from '@dbos-inc/dbos-sdk/internal/system_database';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { GlobalLogger } from '@dbos-inc/dbos-sdk/internal/telemetry/logs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { grantDbosSchemaPermissions } from '@dbos-inc/dbos-sdk/internal/system_database';
import { assertDisposableUrl, parseTarget, redactUrl, verifyLiveIdentity } from './db-guard.js';

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROLE = 'phase0_rt';

async function main(): Promise<void> {
  const url = process.env.PHASE0_DATABASE_URL ?? '';
  const db = assertDisposableUrl(url, 'PHASE0_DATABASE_URL');
  console.log(`setup target database: ${db} (static check passed; live check follows)`);
  console.log(`connecting via: ${redactUrl(url)}`);

  const admin = new Pool({ connectionString: url, max: 2 });
  try {
    // Live identity on THIS connection before any DDL (M-02).
    const target = parseTarget(url, 'PHASE0_DATABASE_URL');
    await verifyLiveIdentity(admin, target.db, target.port);
    console.log('live identity verified on setup connection');

    const logger = new GlobalLogger();
    await ensureSystemDatabase(url, logger);
    console.log('dbos system schema: ensured');

    for (const f of ['p1/schema.sql', 'p1/worker-schema.sql', 'p2/schema.sql', 'p3/schema.sql']) {
      const sql = readFileSync(join(here, f), 'utf8');
      await admin.query(sql);
      console.log(`applied: phase0/${f}`);
    }
    const rolePassword = process.env.PHASE0_RT_PASSWORD;
    const role = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [RUNTIME_ROLE]);
    if (role.rows.length === 0) {
      if (!rolePassword) throw new Error('PHASE0_RT_PASSWORD is required to create the runtime role');
      await admin.query(`CREATE ROLE "${RUNTIME_ROLE}" WITH LOGIN PASSWORD '${rolePassword.replace(/'/g, "''")}'`);
      console.log(`role created: ${RUNTIME_ROLE}`);
    } else if (rolePassword) {
      // Never silently preserve a stale password when a new one is supplied (m-08).
      await admin.query(`ALTER ROLE "${RUNTIME_ROLE}" WITH PASSWORD '${rolePassword.replace(/'/g, "''")}'`);
      console.log(`role password rotated: ${RUNTIME_ROLE}`);
    } else {
      console.log(`role exists (password unchanged — none supplied): ${RUNTIME_ROLE}`);
    }
    // Least privilege for the scratch runtime (i-05: each grant justified):
    // - CONNECT: tests/worker must open sessions.
    // - public schema: USAGE + CRUD + sequence rights (handler CRUD,
    //   projections, bigserial inserts) + TRUNCATE on prototype tables only
    //   (test isolation, narrow explicit list below).
    // - dbos schema: the SDK's OWN grant function (grantDbosSchemaPermissions)
    //   — DBOS internals (tables, sequences, functions) are versioned with the
    //   SDK, so hand-enumerating them risks missing a right the runtime needs.
    // - No CREATE, no DDL, no superuser for the runtime role anywhere.
    await admin.query(`GRANT CONNECT ON DATABASE "${db}" TO "${RUNTIME_ROLE}"`);
    await grantDbosSchemaPermissions(url, RUNTIME_ROLE, logger);
    console.log('dbos schema rights granted via SDK grant function');
    await admin.query(`GRANT USAGE ON SCHEMA "public" TO "${RUNTIME_ROLE}"`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "${RUNTIME_ROLE}"`,
    );
    await admin.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "public" TO "${RUNTIME_ROLE}"`);
    await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${RUNTIME_ROLE}"`);
    await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${RUNTIME_ROLE}"`);
    const prototypeTables = [
      'p1_business_event',
      'p1_business_event_generation',
      'p1_business_event_discrepancy',
      'p1_domain_action',
      'p1_execution_log',
      'p2_probe_log',
      'p3_operation',
      'p3_attempt',
      'p3_wallet',
      'p3_settlement',
    ];
    await admin.query(`GRANT TRUNCATE ON ${prototypeTables.map((t) => `"public"."${t}"`).join(', ')} TO "${RUNTIME_ROLE}"`);
    console.log('grants applied (scratch DB only — NOT the production grant matrix)');
    const rels = await admin.query(
      `SELECT schemaname || '.' || tablename AS rel FROM pg_tables
       WHERE schemaname IN ('public','dbos')
         AND (tablename LIKE 'p1\\_%' ESCAPE '\\' OR tablename LIKE 'p2\\_%' ESCAPE '\\' OR tablename LIKE 'p3\\_%' ESCAPE '\\')
       ORDER BY 1`,
    );
    console.log(`prototype relations present: ${rels.rows.length}`);
    const ver = await admin.query('SHOW server_version');
    console.log(`server_version: ${ver.rows[0].server_version}`);
  } finally {
    await admin.end();
  }
}

await main();
