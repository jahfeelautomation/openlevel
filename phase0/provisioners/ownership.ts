/**
 * Phase 0 resource-ownership ledger (prompt11 §3).
 *
 * The native provisioner connects to owner-controlled infrastructure, so
 * cleanup must delete ONLY resources proven to have been created by the
 * current Phase 0 execution. Database naming alone (even `phase0_proofs`)
 * never proves ownership.
 *
 * Ownership facts:
 * - `setup-db.ts` snapshots the prototype tables before/after applying
 *   schemas and records every table THIS execution created.
 * - P1 business rows carry a `${RUN_ID}:` key prefix, so per-run record
 *   deletion is exact. P3 rows use fixed ids and are attributable only
 *   when their whole table was created by this execution.
 * - Teardown NEVER stops the server, drops the database, or drops roles.
 *   Anything unattributable is reported retained, never deleted.
 */
import { Pool } from 'pg';

export const OWNERSHIP_TABLE = 'phase0_ownership';

export const OWNERSHIP_DDL = `CREATE TABLE IF NOT EXISTS "public"."${OWNERSHIP_TABLE}" (
  execution_id    text NOT NULL,
  run_id          text NOT NULL,
  object_kind     text NOT NULL,
  object_identity text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, object_kind, object_identity)
)`;

/** Prototype-table name filter shared by setup snapshot + teardown. */
export const PROTOTYPE_TABLE_PREDICATE = `(tablename LIKE 'p1\\_%' ESCAPE '\\' OR tablename LIKE 'p2\\_%' ESCAPE '\\' OR tablename LIKE 'p3\\_%' ESCAPE '\\')`;

export interface LedgerRow {
  execution_id: string;
  run_id: string;
  object_kind: 'table' | 'run-namespace' | 'ledger-table';
  object_identity: string;
}

export interface TeardownPlan {
  /** Exact per-run record deletes: table.column LIKE prefix% (escaped). */
  deletes: Array<{ table: string; column: string; prefixes: string[] }>;
  /** Whole tables created by this execution: every row is Phase 0 test data. */
  drops: string[];
  retained: Array<{ item: string; reason: string }>;
}

/** Escape a LIKE prefix so run ids cannot act as wildcards. Pure. */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** FK edge among public tables: `child` holds a foreign key to `parent`. */
export interface FkDependency {
  child: string;
  parent: string;
}

/**
 * Order `candidates` for DROP (FK children first) and report any table that
 * cannot be dropped because a referencing table survives outside the drop
 * set. PostgreSQL refuses such drops ("other objects depend on it") and the
 * referencing table is not ours to delete, so the plan retains the parent
 * with the blocker named instead of failing the whole teardown. Pure;
 * unit-tested.
 */
function orderDropsForForeignKey(
  candidates: string[],
  fk: FkDependency[],
): { drops: string[]; blocked: Map<string, string> } {
  const blocked = new Map<string, string>();
  if (fk.length === 0) return { drops: candidates, blocked };
  const set = new Set(candidates);
  // Fixpoint: if a survivor references X, X is undroppable — and so is
  // anything X itself references, transitively.
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of [...set]) {
      const survivor = fk.find((e) => e.parent === t && !set.has(e.child));
      if (survivor) {
        set.delete(t);
        blocked.set(t, survivor.child);
        changed = true;
      }
    }
  }
  // Stable topological order: emit a table only once every FK child of it
  // that is also being dropped has been emitted; ledger order breaks ties.
  const remaining = candidates.filter((t) => set.has(t));
  const drops: string[] = [];
  while (remaining.length > 0) {
    const idx = remaining.findIndex(
      (t) => !remaining.some((c) => c !== t && fk.some((e) => e.child === c && e.parent === t)),
    );
    if (idx === -1) break; // FK cycle among survivors: keep ledger order; DROP fails loudly
    drops.push(...remaining.splice(idx, 1));
  }
  drops.push(...remaining);
  return { drops, blocked };
}

/**
 * Build the teardown plan from ledger evidence (pure; unit-tested).
 *
 * - `ownedRunIds`: run ids whose record-namespace this execution owns.
 * - `createdTables`: prototype tables this execution created (ledger kind
 *   'table'); their rows are all attributable → DROP.
 * - `keyedTables`: prototype tables carrying a run-prefixed key column
 *   (discovered from information_schema, not hardcoded).
 * - `allPrototypeTables`: every p1_/p2_/p3_ table present now.
 * - `fkDependencies`: FK edges from the live catalog (child REFERENCES
 *   parent). Without it the planner preserves ledger order (unit tests).
 *
 * A table this execution did NOT create keeps its unattributable rows
 * (notably P3 fixed-id rows); only run-namespaced deletes apply there.
 */
export function planNativeTeardown(args: {
  ownedRunIds: string[];
  createdTables: string[];
  keyedTables: Array<{ table: string; column: string }>;
  allPrototypeTables: string[];
  fkDependencies?: FkDependency[];
}): TeardownPlan {
  const candidates = args.createdTables.filter((t) => args.allPrototypeTables.includes(t));
  const { drops, blocked } = orderDropsForForeignKey(candidates, args.fkDependencies ?? []);
  const dropped = new Set(drops);
  const deletes = args.keyedTables
    .filter((k) => args.allPrototypeTables.includes(k.table) && !dropped.has(k.table))
    .map((k) => ({ table: k.table, column: k.column, prefixes: [...args.ownedRunIds] }));
  const retained: TeardownPlan['retained'] = [];
  for (const t of args.allPrototypeTables) {
    if (dropped.has(t)) continue;
    const blocker = blocked.get(t);
    if (blocker !== undefined) {
      retained.push({
        item: t,
        reason: `referenced by ${blocker}, which this execution does not drop`,
      });
      continue;
    }
    const keyed = args.keyedTables.some((k) => k.table === t);
    retained.push({
      item: t,
      reason: keyed
        ? 'pre-existing table: only run-namespaced rows deleted, other rows retained'
        : 'pre-existing table without run-namespaced keys: all rows retained',
    });
  }
  return { deletes, drops, retained };
}

/** Snapshot the prototype tables existing right now (bootstrap pool). */
export async function snapshotPrototypeTables(pool: Pool): Promise<string[]> {
  const r = await pool.query(
    `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND ${PROTOTYPE_TABLE_PREDICATE} ORDER BY 1`,
  );
  return r.rows.map((row) => (row as { t: string }).t);
}

/** Record ownership facts for this execution (bootstrap pool). Idempotent. */
export async function recordOwnership(
  pool: Pool,
  args: { executionId: string; runId: string; createdTables: string[] },
): Promise<void> {
  const ledgerBefore = await pool.query(`SELECT to_regclass('public."${OWNERSHIP_TABLE}"') AS r`);
  const ledgerPreexisted = (ledgerBefore.rows[0] as { r: string | null }).r !== null;
  await pool.query(OWNERSHIP_DDL);
  if (!ledgerPreexisted) {
    await pool.query(
      `INSERT INTO "public"."${OWNERSHIP_TABLE}" (execution_id, run_id, object_kind, object_identity)
       VALUES ($1, $2, 'ledger-table', $3)
       ON CONFLICT (execution_id, object_kind, object_identity) DO NOTHING`,
      [args.executionId, args.runId, OWNERSHIP_TABLE],
    );
  }
  await pool.query(
    `INSERT INTO "public"."${OWNERSHIP_TABLE}" (execution_id, run_id, object_kind, object_identity)
     VALUES ($1, $2, 'run-namespace', $2)
     ON CONFLICT (execution_id, object_kind, object_identity) DO NOTHING`,
    [args.executionId, args.runId],
  );
  for (const table of args.createdTables) {
    await pool.query(
      `INSERT INTO "public"."${OWNERSHIP_TABLE}" (execution_id, run_id, object_kind, object_identity)
       VALUES ($1, $2, 'table', $3)
       ON CONFLICT (execution_id, object_kind, object_identity) DO NOTHING`,
      [args.executionId, args.runId, table],
    );
  }
}

/** Load this execution's ledger rows (bootstrap pool). */
export async function loadLedger(pool: Pool, executionId: string): Promise<LedgerRow[]> {
  const exists = await pool.query(`SELECT to_regclass('public."${OWNERSHIP_TABLE}"') AS r`);
  if ((exists.rows[0] as { r: string | null }).r === null) return [];
  const r = await pool.query(
    `SELECT execution_id, run_id, object_kind, object_identity
     FROM "public"."${OWNERSHIP_TABLE}" WHERE execution_id = $1`,
    [executionId],
  );
  return r.rows as LedgerRow[];
}

/** Discover prototype tables carrying a run-prefixed key column (any pool). */
export async function discoverKeyedTables(pool: Pool): Promise<Array<{ table: string; column: string }>> {
  const r = await pool.query(
    `SELECT c.table_name AS table, c.column_name AS column
     FROM information_schema.columns c
     JOIN pg_tables t ON t.schemaname = c.table_schema AND t.tablename = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'business_key'
       AND ${PROTOTYPE_TABLE_PREDICATE.replaceAll('tablename', 'c.table_name')}
     ORDER BY 1`,
  );
  return (r.rows as Array<{ table: string; column: string }>).map((row) => ({
    table: row.table,
    column: row.column,
  }));
}
