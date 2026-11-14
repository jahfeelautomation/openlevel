/**
 * Phase 0 database guard (isolated test safeguard).
 *
 * Every destructive setup step and every DB-backed test must pass through
 * here. Rules (M-01):
 *  - URL must come from an explicit env var (default PHASE0_DATABASE_URL).
 *  - Scheme MUST be postgres:// or postgresql:// (pg ignores protocol,
 *    so anything else is refused outright).
 *  - Host MUST be loopback (localhost, 127.0.0.1, ::1). No unix-socket
 *    paths, no foreign hosts. No override variable exists by design.
 *  - Database name MUST match /^phase0_[A-Za-z0-9_]*$/ (disposable namespace).
 *  - Query string: only allowlisted params (sslmode). In particular host,
 *    port, dbname, user, password, and options are rejected — pg honors
 *    query overrides that would silently redirect the connection.
 *  - Dangerous PG* env (PGSERVICE, PGSERVICEFILE, PGPASSFILE, PGOPTIONS)
 *    must be unset: they can redirect or alter the session.
 *  - Live verification on the actual connection: current_database(),
 *    inet_server_addr()/inet_server_port() must be loopback + URL port.
 *  - Never log credentials: errors carry redacted URLs only.
 */
import { Pool } from 'pg';

// Disposable namespace + strict charset so the name is SQL-identifier-safe
// when quoted (defense in depth for setup scripts that interpolate it).
const REQUIRED_PATTERN = /^phase0_[A-Za-z0-9_]*$/;
const PROD_MARKERS = [/prod/i, /production/i, /customer/i, /^openlevel$/, /^postgres$/, /^template/];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ALLOWED_QUERY_PARAMS = new Set(['sslmode']);
// pg honors these env vars; the service/options/file ones can redirect the
// session away from the URL, so their mere presence fails closed.
const FORBIDDEN_ENV = ['PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'];

export interface GuardReport {
  database: string;
  serverVersion: string;
  user: string;
  serverAddress: string;
  serverPort: number;
}

const PASSWORD_QUERY_KEYS = ['password', 'passwd', 'pwd', 'pass'];

export function redactUrl(url: string): string {
  let out = url.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1:<redacted>@');
  for (const key of PASSWORD_QUERY_KEYS) {
    out = out.replace(new RegExp(`([?&]${key}=)[^&#]*`, 'gi'), '$1<redacted>');
  }
  return out;
}

interface ParsedTarget {
  db: string;
  host: string;
  port: number;
}

export function parseTarget(url: string, sourceEnv: string): ParsedTarget {
  if (!url) throw new Error(`refusing to run: ${sourceEnv} is not set`);
  const scheme = url.split('://')[0]?.toLowerCase() ?? '';
  if (scheme !== 'postgres' && scheme !== 'postgresql') {
    throw new Error(`refusing to run: scheme must be postgres:// or postgresql:// (from ${sourceEnv})`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`refusing to run: malformed connection URL (from ${sourceEnv})`);
  }
  // WHATWG keeps IPv6 brackets on .hostname ("[::1]"); strip for comparison.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`refusing to run: host "${parsed.hostname}" is not loopback (from ${sourceEnv})`);
  }
  for (const key of parsed.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMS.has(key.toLowerCase())) {
      throw new Error(`refusing to run: query parameter "${key}" is not allowlisted (from ${sourceEnv})`);
    }
  }
  for (const name of FORBIDDEN_ENV) {
    if (process.env[name]) {
      throw new Error(`refusing to run: ${name} is set and could redirect the session; unset it first`);
    }
  }
  const db = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] ?? '');
  if (!REQUIRED_PATTERN.test(db)) {
    throw new Error(`refusing to run: database "${db}" is not in the disposable phase0_ namespace`);
  }
  for (const marker of PROD_MARKERS) {
    if (marker.test(db)) throw new Error(`refusing to run: database "${db}" matches production marker ${marker}`);
  }
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`refusing to run: invalid port in connection URL (from ${sourceEnv})`);
  }
  return { db, host, port };
}

export function assertDisposableUrl(url: string, sourceEnv: string): string {
  return parseTarget(url, sourceEnv).db;
}

/** Connect, verify live identity, and return a pooled handle + report. */
export async function connectGuarded(envVar = 'PHASE0_DATABASE_URL'): Promise<{ pool: Pool; report: GuardReport }> {
  const url = process.env[envVar] ?? '';
  const expected = parseTarget(url, envVar);
  const pool = new Pool({ connectionString: url, max: 5 });
  try {
    const version = await pool.query('SHOW server_version');
    const current = await pool.query(
      `SELECT current_database() AS db, current_user AS usr,
              inet_server_addr()::text AS addr, inet_server_port() AS port`,
    );
    const actualDb = current.rows[0].db as string;
    const addr = current.rows[0].addr as string | null;
    const port = Number(current.rows[0].port);
    if (actualDb !== expected.db) {
      throw new Error(`refusing to run: connected to "${actualDb}", expected "${expected.db}"`);
    }
    if (addr !== '127.0.0.1' && addr !== '::1') {
      throw new Error(`refusing to run: server address "${addr}" is not loopback`);
    }
    if (port !== expected.port) {
      throw new Error(`refusing to run: server port ${port} does not match URL port ${expected.port}`);
    }
    return {
      pool,
      report: {
        database: actualDb,
        serverVersion: (version.rows[0] as { server_version: string }).server_version,
        user: current.rows[0].usr as string,
        serverAddress: addr,
        serverPort: port,
      },
    };
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  }
}

/** Re-verify live identity on an already-open pool before destructive work. */
export async function verifyLiveIdentity(pool: Pool, expectedDb: string, expectedPort: number): Promise<void> {
  const current = await pool.query(
    `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`,
  );
  const actualDb = current.rows[0].db as string;
  const addr = current.rows[0].addr as string | null;
  const port = Number(current.rows[0].port);
  if (actualDb !== expectedDb) throw new Error(`refusing destructive work: connected to "${actualDb}"`);
  if (addr !== '127.0.0.1' && addr !== '::1') throw new Error(`refusing destructive work: server "${addr}" not loopback`);
  if (port !== expectedPort) throw new Error(`refusing destructive work: port ${port} mismatch`);
}
