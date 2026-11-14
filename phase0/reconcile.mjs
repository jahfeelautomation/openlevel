#!/usr/bin/env node
/**
 * Phase 0 reconciliation (runs pre-teardown, DB alive).
 * Compares provider-side journal against application ledger and wallet.
 * Usage: node phase0/reconcile.mjs <output.json>
 * Env: PHASE0_DATABASE_URL (bootstrap, read-only queries),
 *      P3_PROVIDER_LOG (JSONL journal path).
 * Exit 0 iff every invariant holds; prints the verdict summary.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';

const [outPath] = process.argv.slice(2);
if (!outPath) {
  console.error('usage: node phase0/reconcile.mjs <output.json>');
  process.exit(2);
}
const url = process.env.PHASE0_DATABASE_URL ?? '';
if (!url) {
  console.error('FATAL: PHASE0_DATABASE_URL is not set');
  process.exit(2);
}
// Minimal target guard (mirrors db-guard.ts namespace rule; this script runs
// on plain node without the TS guard module): refuse anything outside phase0_*.
try {
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, '').split('/')[0] ?? '');
  if (!/^phase0_[A-Za-z0-9_]*$/.test(dbName)) throw new Error(dbName || '(empty)');
} catch {
  console.error('FATAL: refusing to reconcile a non-disposable database target');
  process.exit(2);
}

const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000 });
try {
  await pool.query('SELECT 1');
} catch (err) {
  console.error(`FATAL: cannot reach database (${String(err.code ?? err.message ?? err).slice(0, 120)})`);
  await pool.end().catch(() => undefined);
  process.exit(2);
}
const invariants = [];
const check = (name, pass, detail = '') => {
  invariants.push({ name, pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'RECON-OK  ' : 'RECON-FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
};

try {
  // --- P1 counts ---
  const p1events = await pool.query(`SELECT status, count(*)::int AS n FROM (SELECT last_status AS status FROM p1_business_event) s GROUP BY 1`).catch(() => ({ rows: [] }));
  const p1exec = await pool.query(`SELECT count(*)::int AS n FROM p1_execution_log`).catch(() => ({ rows: [{ n: -1 }] }));
  const p1gen = await pool.query(`SELECT count(*)::int AS n FROM p1_business_event_generation`).catch(() => ({ rows: [{ n: -1 }] }));

  // --- P3 counts ---
  const ops = await pool.query(`SELECT billing_state, count(*)::int AS n FROM p3_operation GROUP BY 1`).catch(() => ({ rows: [] }));
  const attempts = await pool.query(`SELECT state, count(*)::int AS n FROM p3_attempt GROUP BY 1`).catch(() => ({ rows: [] }));
  const settle = await pool.query(
    `SELECT kind, count(*)::int AS n, coalesce(sum(amount_micro),0)::bigint AS total FROM p3_settlement GROUP BY 1`,
  ).catch(() => ({ rows: [] }));
  const wallets = await pool.query(`SELECT agency_id, balance_credits_micro::bigint AS b FROM p3_wallet`).catch(() => ({ rows: [] }));

  // --- Provider journal ---
  const logPath = process.env.P3_PROVIDER_LOG ?? '';
  let journal = [];
  let corruptLines = 0;
  if (logPath && existsSync(logPath)) {
    for (const line of readFileSync(logPath, 'utf8').split('\n').filter(Boolean)) {
      try {
        journal.push(JSON.parse(line));
      } catch {
        corruptLines++;
      }
    }
  }
  const chargedByOp = new Map();
  for (const e of journal) {
    if (e.charged) chargedByOp.set(e.operationId, (chargedByOp.get(e.operationId) ?? 0) + 1);
  }

  // --- Invariants ---
  check('journal-parseable', corruptLines === 0, corruptLines ? `${corruptLines} corrupt lines` : `${journal.length} entries ok`);
  const negWallets = wallets.rows.filter((w) => Number(w.b) < 0);
  check('no-negative-wallets', negWallets.length === 0, negWallets.length ? `${negWallets.length} negative` : `${wallets.rows.length} wallets ok`);

  // Every charged provider entry must have a matching attempt row.
  const chargedOps = [...chargedByOp.keys()];
  let orphanCharges = 0;
  for (const op of chargedOps) {
    const r = await pool.query(`SELECT count(*)::int AS n FROM p3_attempt WHERE operation_id = $1`, [op]);
    if (r.rows[0].n === 0) orphanCharges++;
  }
  check('charges-have-attempts', orphanCharges === 0, `${chargedOps.length} charged ops checked`);

  // Settled amounts must equal their attempt costs (no silent averaging).
  const mismatch = await pool.query(
    `SELECT count(*)::int AS n FROM p3_settlement s JOIN p3_attempt a ON a.attempt_id = s.attempt_id
     WHERE s.kind = 'settle' AND s.amount_micro <> a.cost_usd_micro`,
  ).catch(() => ({ rows: [{ n: -1 }] }));
  check('settle-equals-attempt-cost', mismatch.rows[0].n === 0, `${mismatch.rows[0].n} mismatches`);

  const out = {
    at: new Date().toISOString(),
    p1: { eventsByStatus: p1events.rows, executions: p1exec.rows[0]?.n ?? -1, archivedGenerations: p1gen.rows[0]?.n ?? -1 },
    p3: {
      operationsByState: ops.rows,
      attemptsByState: attempts.rows,
      settlements: settle.rows,
      wallets: wallets.rows.map((w) => ({ agency_id: w.agency_id, balance_credits_micro: String(w.b) })),
      providerCharges: chargedByOp.size,
      providerLogEntries: journal.length,
    },
    invariants,
    verdict: invariants.every((i) => i.pass) ? 'PASS' : 'FAIL',
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`reconciliation: ${out.verdict} -> ${outPath}`);
  process.exit(out.verdict === 'PASS' ? 0 : 1);
} finally {
  await pool.end().catch(() => undefined);
}
