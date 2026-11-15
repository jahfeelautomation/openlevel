/**
 * P1 race contention observer (prompt16). Pure decision logic over
 * `pg_stat_activity` rows: which backends prove genuine PostgreSQL-level
 * contention on the P1 business-key insert.
 *
 * The live test holds the winning transaction open at the `afterInsert`
 * hook while losers block on its uncommitted unique insert, and polls this
 * predicate through an independent observer pool until at least two
 * distinct blocked contender backends appear (or a bounded deadline fails
 * loudly with a snapshot). Blocking evidence comes from
 * `pg_blocking_pids(pid)` — a contender with no blockers proves nothing,
 * so it never counts, even when active.
 */
export interface ActivityRow {
  pid: number;
  datname: string | null;
  application_name: string | null;
  state: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
  query: string | null;
  xact_start: string | null;
  blockers: number[];
}

export interface ContentionFilter {
  database: string;
  contenderApp: string;
  /** Query-text fragment identifying the P1 business-event insert. */
  queryFragment: string;
}

/**
 * Distinct PIDs proving contention: same database, contender sessions,
 * actively executing the P1 insert, each actually blocked on another
 * backend. The observer's own PID never counts. Pure; unit-tested.
 */
export function selectContendingBackends(
  rows: ActivityRow[],
  selfPid: number,
  filter: ContentionFilter,
): number[] {
  const pids = new Set<number>();
  for (const r of rows) {
    if (r.pid === selfPid) continue;
    if (r.datname !== filter.database) continue;
    if (r.application_name !== filter.contenderApp) continue;
    if (r.state !== 'active') continue;
    if (!r.query || !r.query.includes(filter.queryFragment)) continue;
    if (r.blockers.length === 0) continue;
    pids.add(r.pid);
  }
  return [...pids].sort((a, b) => a - b);
}

/** One-line-per-backend diagnostic snapshot for deadline failures. */
export function formatActivitySnapshot(rows: ActivityRow[]): string {
  const lines = rows.map(
    (r) =>
      `pid=${r.pid} app=${r.application_name ?? '(null)'} state=${r.state ?? '(null)'} ` +
      `wait=${r.wait_event_type ?? '(none)'}/${r.wait_event ?? '(none)'} ` +
      `blockers=[${r.blockers.join(',')}] xact=${r.xact_start ?? '(none)'} ` +
      `query=${(r.query ?? '(null)').slice(0, 160).replace(/\s+/g, ' ')}`,
  );
  return lines.length > 0 ? lines.join('\n') : '(no backends observed)';
}
