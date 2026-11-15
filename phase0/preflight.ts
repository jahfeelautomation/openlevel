/**
 * Phase 0 preflight (isolated). Verifies the database target is disposable
 * and reachable, then prints identity facts (never credentials).
 * Exit non-zero on any refusal. Run: node --import tsx phase0/preflight.ts
 */
import { connectGuarded, redactUrl } from './db-guard.js';

const url = process.env.PHASE0_DATABASE_URL ?? '';
console.log(`target: ${url ? redactUrl(url) : '(unset)'}`);
const { pool, report } = await connectGuarded('PHASE0_DATABASE_URL');
console.log(`database: ${report.database}`);
console.log(`server_version: ${report.serverVersion}`);
console.log(`user: ${report.user}`);
console.log(`server: ${report.serverAddress}:${report.serverPort}`);
await pool.end();

// Runtime-role proof (M-03): when a runtime URL is provided, verify it
// connects as the restricted role — the tests must never run as superuser.
if (process.env.PHASE0_RT_URL) {
  const rt = await connectGuarded('PHASE0_RT_URL');
  console.log(`runtime user: ${rt.report.user}`);
  if (rt.report.user === report.user) {
    throw new Error('refusing to run: runtime URL resolves to the bootstrap user, not phase0_rt');
  }
  await rt.pool.end();
}
console.log('preflight: PASS (disposable target verified)');
