/**
 * P2 worker boot wrapper (Phase 0, isolated). Sole place that sets the
 * executor identity. Fail-closed: any misconfiguration exits non-zero
 * BEFORE any workflow code initializes, so a misconfigured worker can
 * never dequeue or recover as a ghost executor.
 *
 * Usage: ROLE=worker node phase0/p2/boot-worker.mjs
 * Env in: P2_EXPECTED_VMID (default "worker-1"), P2_SYSTEM_DATABASE_URL.
 */
const EXPECTED_VMID = process.env.P2_EXPECTED_VMID ?? 'worker-1';

if (process.env.ROLE !== 'worker') {
  console.error('FATAL: boot-worker.mjs requires ROLE=worker, got: ' + process.env.ROLE);
  process.exit(2);
}
if (!process.env.P2_SYSTEM_DATABASE_URL) {
  console.error('FATAL: P2_SYSTEM_DATABASE_URL is required');
  process.exit(2);
}
if (process.env.DBOS__VMID && process.env.DBOS__VMID !== EXPECTED_VMID) {
  console.error(`FATAL: conflicting DBOS__VMID=${process.env.DBOS__VMID}, expected ${EXPECTED_VMID}`);
  process.exit(2);
}
process.env.DBOS__VMID = EXPECTED_VMID;
console.log(JSON.stringify({ boot: 'worker', vmid: EXPECTED_VMID, at: new Date().toISOString() }));

// Real worker entrypoint is imported here at Gate D (Phase 2 worker).
// For the P2 proof, a minimal DBOS worker probe replaces this import;
// the fencing assertions below do not depend on which workflows exist.
const entry = process.env.P2_WORKER_ENTRY ?? '';
if (!entry) {
  console.log(JSON.stringify({ note: 'no P2_WORKER_ENTRY: identity validated, exiting 0 (dry-run)' }));
  process.exit(0);
}
await import(entry);
