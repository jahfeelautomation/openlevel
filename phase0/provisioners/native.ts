/**
 * Native provisioner (prompt11 §2–§4).
 *
 * Connects to an explicitly configured, owner-controlled local PostgreSQL
 * instance. The server, database, roles, and installation are NEVER stopped,
 * restarted, modified, or dropped — teardown removes only ledger-proven
 * Phase 0 objects (see ./ownership.ts).
 *
 * SCRAM is DEMONSTRATED, not inferred, from four live facts:
 *   1. SHOW password_encryption = scram-sha-256 (server default);
 *   2. the applicable pg_hba_file_rules row for this exact connection
 *      (observed client address + observed TLS state) requires scram-sha-256;
 *   3. the phase0_rt verifier in pg_authid has the SCRAM-SHA-256$ format;
 *   4. a real TCP password login as phase0_rt succeeds.
 * Any unprovable piece fails the run closed with the exact gap.
 *
 * Provisioner isolation: native mode deletes the container-verification env
 * vars on entry and asserts them absent at every trust boundary, so db-guard
 * always applies strict-loopback native policy here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { assertDisposableUrl, connectGuarded, redactUrl } from '../db-guard.js';
import {
  newRunId,
  writeProvisionedState,
  type DownReport,
  type Provisioned,
  type Provisioner,
  type RuntimeEvidence,
} from './types.js';
import {
  OWNERSHIP_TABLE,
  discoverKeyedTables,
  escapeLikePrefix,
  loadLedger,
  planNativeTeardown,
  snapshotPrototypeTables,
} from './ownership.js';

export const RUNTIME_ROLE = 'phase0_rt';
/** CI runs postgres:16.16; native must be the same major. */
export const REQUIRED_PG_MAJOR = 16;
const SCRAM_METHOD = 'scram-sha-256';
const SCRAM_VERIFIER_PREFIX = 'SCRAM-SHA-256$';
const CONTAINER_ENV_VARS = ['PHASE0_VERIFIED_ADDRS', 'PHASE0_CONTAINER_PORT', 'PHASE0_BOOT_PASSWORD'];

/** Delete container-verification context so native checks stand alone. */
export function clearContainerEnv(): void {
  for (const name of CONTAINER_ENV_VARS) delete process.env[name];
}

/** Fail closed if container-verification context leaked into native mode. */
export function assertContainerEnvAbsent(): void {
  for (const name of CONTAINER_ENV_VARS) {
    if (process.env[name] !== undefined && process.env[name] !== '') {
      throw new Error(
        `refusing to run: ${name} is set in native mode — container-verification ` +
          `context must never leak across provisioners`,
      );
    }
  }
}

/** Parse SHOW server_version; require the CI-compatible major. Pure. */
export function assertSupportedServerVersion(version: string): { major: number; full: string } {
  const match = version.trim().match(/^(\d+)(?:\.(\d+))?/);
  if (!match) throw new Error(`refusing to run: unparseable server_version "${version}"`);
  const major = Number(match[1]);
  if (major !== REQUIRED_PG_MAJOR) {
    throw new Error(
      `refusing to run: server major is ${major}, required ${REQUIRED_PG_MAJOR} ` +
        `(native must match the CI image major; full version "${version}")`,
    );
  }
  return { major, full: version };
}

/** The pg_authid verifier must have the SCRAM format. Pure. */
export function assertScramVerifierFormat(rolpassword: string | null, role: string): void {
  if (rolpassword === null) {
    throw new Error(
      `refusing to run: role "${role}" has no password verifier (null) — password ` +
        `authentication cannot be SCRAM without one`,
    );
  }
  if (!rolpassword.startsWith(SCRAM_VERIFIER_PREFIX)) {
    const observed = rolpassword.startsWith('md5') ? 'md5' : 'unrecognized format';
    throw new Error(
      `refusing to run: role "${role}" verifier is ${observed}, not SCRAM-SHA-256 ` +
        `(verifier value never logged)`,
    );
  }
}

export interface HbaRuleRow {
  line_number: number;
  type: string;
  database: string;
  user_name: string;
  address: string | null;
  netmask: string | null;
  auth_method: string | null;
  options: string | null;
  error: string | null;
}

export function formatHbaRule(row: HbaRuleRow): string {
  return `line ${row.line_number}: ${row.type} db=${row.database} user=${row.user_name} addr=${row.address ?? '(n/a)'} method=${row.auth_method ?? '(error)'}`;
}

function parseIpv4(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return ((octets[0] as number) * 256 ** 3 + (octets[1] as number) * 256 ** 2 + (octets[2] as number) * 256 + (octets[3] as number)) >>> 0;
}

/** True when an IPv4 CIDR (address + dotted netmask) contains the client. Pure. */
export function cidrContainsV4(address: string, netmask: string, clientIp: string): boolean {
  const net = parseIpv4(address);
  const mask = parseIpv4(netmask);
  const client = parseIpv4(clientIp);
  if (net === null || mask === null || client === null) return false;
  return (net & mask) >>> 0 === (client & mask) >>> 0;
}

function fieldMatchesList(field: string, value: string, dbForSameUser?: { db: string; user: string }): boolean {
  for (const raw of field.split(',')) {
    const entry = raw.trim();
    if (entry === 'all' || entry === value) return true;
    if (dbForSameUser && entry === 'sameuser' && dbForSameUser.db === dbForSameUser.user) return true;
    // '+' group entries, 'samerole', 'replication', 'samegroup' are NOT
    // evaluated here: failing closed with an explicit message beats
    // pretending an unevaluated rule was checked.
  }
  return false;
}

/**
 * Find the applicable pg_hba rule for an observed connection (pure;
 * unit-tested with fixtures). First matching line in file order wins, per
 * PostgreSQL semantics. Rows with a parse `error` fail the lookup closed:
 * an unreadable earlier line means the applicable rule is unknowable.
 */
export function findApplicableHbaRule(
  rows: HbaRuleRow[],
  query: { database: string; user: string; clientIp: string; tls: boolean },
): HbaRuleRow {
  const ordered = [...rows].sort((a, b) => a.line_number - b.line_number);
  const wantTypes = query.tls ? new Set(['host', 'hostssl']) : new Set(['host', 'hostnossl']);
  for (const row of ordered) {
    if (row.error) {
      throw new Error(
        `refusing to run: pg_hba.conf line ${row.line_number} has a parse error (${row.error}); ` +
          `the applicable rule cannot be determined reliably`,
      );
    }
    if (!wantTypes.has(row.type)) continue;
    if (!fieldMatchesList(row.database, query.database, { db: query.database, user: query.user })) continue;
    if (!fieldMatchesList(row.user_name, query.user)) continue;
    if (row.address === null) continue; // host-type line without an address: not evaluable
    const netmask = row.netmask ?? '255.255.255.255';
    const v4 = parseIpv4(row.address) !== null;
    const matches = v4
      ? cidrContainsV4(row.address, netmask, query.clientIp)
      : row.address.toLowerCase() === query.clientIp.toLowerCase();
    if (!matches) continue;
    return row;
  }
  throw new Error(
    `refusing to run: no pg_hba.conf rule matches database="${query.database}" user="${query.user}" ` +
      `client=${query.clientIp} tls=${query.tls ? 'on' : 'off'}`,
  );
}

/** Assert the applicable rule requires SCRAM. Pure over the matched row. */
export function assertHbaRequiresScram(row: HbaRuleRow): void {
  if (row.auth_method !== SCRAM_METHOD) {
    throw new Error(
      `refusing to run: applicable pg_hba rule (${formatHbaRule(row)}) requires ` +
        `'${row.auth_method ?? '(none)'}', not '${SCRAM_METHOD}'`,
    );
  }
}

function quoteName(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`refusing teardown: unexpected identifier "${name}"`);
  return `"${name}"`;
}

function quoteTable(name: string): string {
  return `"public".${quoteName(name)}`;
}

async function queryApplicableHba(pool: Pool, database: string): Promise<HbaRuleRow> {
  const client = await pool.query(`SELECT host(inet_client_addr()) AS ip`);
  const clientIp = (client.rows[0] as { ip: string | null }).ip;
  if (!clientIp) throw new Error('refusing to run: inet_client_addr() is null (not a TCP connection?)');
  const tls = await pool.query(`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`);
  const tlsOn = (tls.rows[0] as { ssl: boolean }).ssl === true;
  let rows: HbaRuleRow[];
  try {
    const r = await pool.query(
      `SELECT line_number, type, database, user_name, address, netmask, auth_method, options, error
       FROM pg_hba_file_rules ORDER BY line_number`,
    );
    rows = r.rows as HbaRuleRow[];
  } catch (err) {
    throw new Error(
      `refusing to run: cannot read pg_hba_file_rules from the bootstrap connection ` +
        `(${(err as Error).message.slice(0, 160)}). Native mode requires a superuser-capable ` +
        `bootstrap URL so SCRAM can be demonstrated, not inferred.`,
    );
  }
  const rule = findApplicableHbaRule(rows, { database, user: RUNTIME_ROLE, clientIp, tls: tlsOn });
  assertHbaRequiresScram(rule);
  console.log(`native: hba rule for ${RUNTIME_ROLE}@${clientIp} (tls=${tlsOn ? 'on' : 'off'}): ${formatHbaRule(rule)}`);
  return rule;
}

async function queryVerifier(pool: Pool): Promise<void> {
  let rows: Array<{ rolpassword: string | null }>;
  try {
    const r = await pool.query(`SELECT rolpassword FROM pg_authid WHERE rolname = $1`, [RUNTIME_ROLE]);
    rows = r.rows as Array<{ rolpassword: string | null }>;
  } catch (err) {
    throw new Error(
      `refusing to run: cannot read pg_authid from the bootstrap connection ` +
        `(${(err as Error).message.slice(0, 160)}). Native mode requires a superuser-capable ` +
        `bootstrap URL so the SCRAM verifier can be demonstrated.`,
    );
  }
  if (rows.length === 0) throw new Error(`refusing to run: role "${RUNTIME_ROLE}" does not exist after setup`);
  assertScramVerifierFormat(rows[0]?.rolpassword ?? null, RUNTIME_ROLE);
  console.log(`native: role ${RUNTIME_ROLE} has a SCRAM-SHA-256 verifier (value never logged)`);
}

export const nativeProvisioner: Provisioner = {
  name: 'native',

  async up(): Promise<Provisioned> {
    clearContainerEnv();
    assertContainerEnvAbsent();
    const executionId = newRunId();
    const url = process.env.PHASE0_DATABASE_URL ?? '';
    const database = assertDisposableUrl(url, 'PHASE0_DATABASE_URL');
    if (!process.env.PHASE0_RT_PASSWORD) {
      throw new Error(
        'refusing to run: PHASE0_RT_PASSWORD is not set (native setup must create/rotate ' +
          `the ${RUNTIME_ROLE} role with an explicit password)`,
      );
    }
    const { pool, report } = await connectGuarded('PHASE0_DATABASE_URL');
    try {
      // Native policy is strict loopback on the server view (no container
      // context exists — asserted absent above) and the URL port must match
      // the observed server port. Both enforced inside connectGuarded.
      const { full } = assertSupportedServerVersion(report.serverVersion);
      const guc = await pool.query('SHOW password_encryption');
      const passwordEncryption = (guc.rows[0] as { password_encryption: string }).password_encryption;
      if (passwordEncryption !== SCRAM_METHOD) {
        throw new Error(`refusing to run: password_encryption is '${passwordEncryption}', required '${SCRAM_METHOD}'`);
      }
      const hbaRule = await queryApplicableHba(pool, database);
      console.log(`native: ${report.user}@${report.serverAddress}:${report.serverPort}/${database} (${full})`);
      console.log(`native: password_encryption=${passwordEncryption} (verified)`);
      console.log(`native: url ${redactUrl(url)}`);
      mkdirSync('phase0/evidence', { recursive: true });
      writeFileSync(
        `phase0/evidence/native-provision-${executionId}.json`,
        JSON.stringify(
          {
            provisioner: 'native',
            executionId,
            database,
            bootstrapUser: report.user,
            serverVersion: full,
            serverAddress: report.serverAddress,
            serverPort: report.serverPort,
            passwordEncryption,
            hbaRule: formatHbaRule(hbaRule),
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } finally {
      await pool.end().catch(() => undefined);
    }
    const state: Provisioned = {
      provisioner: 'native',
      executionId,
      runIds: [executionId],
      database,
      startedAt: new Date().toISOString(),
    };
    process.env.PHASE0_RUN_ID = executionId;
    writeProvisionedState(state);
    return state;
  },

  async verifyRuntime(rtUrl: string): Promise<RuntimeEvidence> {
    assertContainerEnvAbsent();
    process.env.PHASE0_RT_URL = rtUrl;
    const rt = await connectGuarded('PHASE0_RT_URL');
    try {
      if (rt.report.user !== RUNTIME_ROLE) {
        throw new Error(`refusing to run: runtime URL resolves to "${rt.report.user}", not ${RUNTIME_ROLE}`);
      }
      const bootstrapUrl = process.env.PHASE0_DATABASE_URL ?? '';
      const bootstrap = new Pool({ connectionString: bootstrapUrl, max: 1 });
      try {
        const guc = await bootstrap.query('SHOW password_encryption');
        const passwordEncryption = (guc.rows[0] as { password_encryption: string }).password_encryption;
        if (passwordEncryption !== SCRAM_METHOD) {
          throw new Error(`refusing to run: password_encryption is '${passwordEncryption}', required '${SCRAM_METHOD}'`);
        }
        const hbaRule = await queryApplicableHba(bootstrap, rt.report.database);
        await queryVerifier(bootstrap);
      } finally {
        await bootstrap.end().catch(() => undefined);
      }
      return {
        provisioner: 'native',
        runtimeUser: rt.report.user,
        serverVersion: rt.report.serverVersion,
        serverAddress: rt.report.serverAddress,
        serverPort: rt.report.serverPort,
        scram: {
          passwordEncryption: SCRAM_METHOD,
          hbaRule: 'verified (see provision log)',
          verifierFormat: 'scram-sha-256',
          passwordLogin: true,
        },
      };
    } finally {
      await rt.pool.end().catch(() => undefined);
    }
  },

  async down(state: Provisioned): Promise<DownReport> {
    const cleaned: string[] = [];
    const retained: DownReport['retained'] = [];
    const url = process.env.PHASE0_DATABASE_URL ?? '';
    if (!url) {
      return {
        provisioner: 'native',
        cleaned,
        retained: [
          {
            item: `database "${state.database}" (all Phase 0 objects)`,
            reason: 'PHASE0_DATABASE_URL is not set in this shell; refusing to guess a target',
          },
        ],
      };
    }
    const { pool, report } = await connectGuarded('PHASE0_DATABASE_URL');
    try {
      if (report.database !== state.database) {
        throw new Error(
          `refusing teardown: connected to "${report.database}" but this execution owns ` +
            `objects in "${state.database}" — set PHASE0_DATABASE_URL to the execution database`,
        );
      }
      const ledger = await loadLedger(pool, state.executionId);
      if (ledger.length === 0) {
        return {
          provisioner: 'native',
          cleaned,
          retained: [
            {
              item: `database "${state.database}" (all Phase 0 objects)`,
              reason: 'no ownership ledger rows for this execution: nothing is attributable, nothing deleted',
            },
          ],
        };
      }
      const ownedRunIds = [...new Set(ledger.filter((r) => r.object_kind === 'run-namespace').map((r) => r.run_id))];
      const createdTables = ledger.filter((r) => r.object_kind === 'table').map((r) => r.object_identity);
      const ownsLedgerTable = ledger.some((r) => r.object_kind === 'ledger-table');
      const allPrototypeTables = await snapshotPrototypeTables(pool);
      const keyedTables = await discoverKeyedTables(pool);
      const plan = planNativeTeardown({ ownedRunIds, createdTables, keyedTables, allPrototypeTables });
      for (const del of plan.deletes) {
        for (const prefix of del.prefixes) {
          const pattern = `${escapeLikePrefix(prefix)}:%`;
          await pool.query(
            `DELETE FROM ${quoteTable(del.table)} WHERE ${quoteName(del.column)} LIKE $1 ESCAPE '\\'`,
            [pattern],
          );
        }
        cleaned.push(`${del.table}: run-namespaced rows deleted (${del.prefixes.length} run id(s))`);
      }
      for (const table of plan.drops) {
        await pool.query(`DROP TABLE IF EXISTS ${quoteTable(table)}`);
        cleaned.push(`${table}: dropped (created by this execution)`);
      }
      await pool.query(`DELETE FROM "public"."${OWNERSHIP_TABLE}" WHERE execution_id = $1`, [state.executionId]);
      cleaned.push(`${OWNERSHIP_TABLE}: this execution's ledger rows deleted`);
      if (ownsLedgerTable) {
        const remaining = await pool.query(`SELECT COUNT(*) AS c FROM "public"."${OWNERSHIP_TABLE}"`);
        if (Number((remaining.rows[0] as { c: string }).c) === 0) {
          await pool.query(`DROP TABLE "public"."${OWNERSHIP_TABLE}"`);
          cleaned.push(`${OWNERSHIP_TABLE}: dropped (created by this execution, now empty)`);
        } else {
          retained.push({ item: OWNERSHIP_TABLE, reason: 'other executions still have ledger rows' });
        }
      } else {
        retained.push({ item: OWNERSHIP_TABLE, reason: 'ledger table pre-existed this execution' });
      }
      for (const r of plan.retained) retained.push(r);
      return { provisioner: 'native', cleaned, retained };
    } finally {
      await pool.end().catch(() => undefined);
    }
  },
};
