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
 *    host(inet_server_addr())/inet_server_port() must satisfy the
 *    server-view policy + URL port. NOTE: `inet` casts to text WITH a
 *    netmask ('127.0.0.1/32'), so `host()` is mandatory (review3 defect 1).
 *  - Server-view policy: the client-side URL must always be strict
 *    loopback (that proves operator intent). The server-side observed
 *    address must be loopback, or — ONLY in container mode, after the
 *    orchestrator verified the container via docker inspect — must
 *    EXACTLY match one of that container's interface addresses
 *    (PHASE0_VERIFIED_ADDRS). Arbitrary RFC1918 is rejected even in
 *    container mode; every container-match acceptance is logged.
 *    Anything else (public, null/unix-socket, malformed) fails closed
 *    with observed-vs-expected detail.
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

export type ServerAddressVerdict = 'loopback' | 'private' | 'rejected';

/**
 * Server-view policy decision (pure; unit-tested).
 *
 * - Native mode (verifiedAddrs null): server address must be loopback.
 *   RFC1918 is REJECTED — there is no container binding it to.
 * - Container mode (verifiedAddrs from `docker inspect` of OUR container):
 *   loopback is still accepted, and any other address must EXACTLY match
 *   one of the verified interface addresses. Arbitrary RFC1918 (siblings,
 *   gateway, foreign hosts) is rejected with the evidence needed to see why.
 */
export function serverViewAllowed(
  addr: string | null | undefined,
  verifiedAddrs: string[] | null,
): { ok: true; mode: 'loopback' | 'container-match' } | { ok: false; reason: string } {
  const verdict = classifyServerAddress(addr);
  if (verdict === 'loopback') return { ok: true, mode: 'loopback' };
  if (verifiedAddrs === null) {
    return {
      ok: false,
      reason: `server "${addr ?? '(null/unix-socket)'}" is not loopback and no container identity is verified (native mode)`,
    };
  }
  const bare = String(addr ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\/(32|128)$/, '');
  const normalizedSet = verifiedAddrs.map((a) =>
    a.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\/(32|128)$/, ''),
  );
  if (normalizedSet.includes(bare) && bare.length > 0) return { ok: true, mode: 'container-match' };
  return {
    ok: false,
    reason:
      `server "${addr ?? '(null/unix-socket)'}" does not match verified container interfaces ` +
      `[${normalizedSet.join(', ') || '(none)'}]`,
  };
}

/** Read container verification context from the orchestrator-set env (absent = native mode). */
export function containerVerificationContext(): { addrs: string[] | null; serverPort: number | null } {
  const raw = process.env.PHASE0_VERIFIED_ADDRS;
  if (raw === undefined || raw.trim() === '') return { addrs: null, serverPort: null };
  const port = Number(process.env.PHASE0_CONTAINER_PORT ?? '5432');
  return {
    addrs: raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
    serverPort: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 5432,
  };
}

/**
 * Classify a server-observed address (pure; unit-tested without a database).
 * Accepts both `host()` form ('127.0.0.1') and raw inet text
 * ('127.0.0.1/32') defensively — callers must still use `host()` so the
 * database does the normalization, never string hope.
 */
export function classifyServerAddress(addr: string | null | undefined): ServerAddressVerdict {
  if (addr === null || addr === undefined) return 'rejected';
  const bare = addr
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    // Only host masks (/32, /128) are stripped: anything else is a network
    // or malformed input and must not launder into an accepted address.
    .replace(/\/(32|128)$/, '');
  if (bare === '::1' || bare === 'localhost') return 'loopback';
  const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return 'rejected';
  const octets = v4.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return 'rejected';
  const [a, b] = octets as [number, number, number, number];
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  return 'rejected';
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
              host(inet_server_addr()) AS addr, inet_server_port() AS port`,
    );
    const actualDb = current.rows[0].db as string;
    const addr = current.rows[0].addr as string | null;
    const port = Number(current.rows[0].port);
    if (actualDb !== expected.db) {
      throw new Error(`refusing to run: connected to "${actualDb}", expected "${expected.db}"`);
    }
    // Container mode (env set by the orchestrator after docker-inspect
    // verification): the server port is the CONTAINER port, and the address
    // must match a verified interface. Native mode: strict loopback + URL port.
    const ctx = containerVerificationContext();
    const decision = serverViewAllowed(addr, ctx.addrs);
    if (!decision.ok || addr === null) {
      throw new Error(
        `refusing to run: ${!decision.ok ? decision.reason : 'server address is null'} ` +
          `(URL host was loopback "${expected.host}")`,
      );
    }
    if (decision.mode === 'container-match') {
      console.log(`db-guard: server address "${addr}" matches verified container interfaces`);
    }
    const wantPort = ctx.serverPort ?? expected.port;
    if (port !== wantPort) {
      throw new Error(`refusing to run: server port ${port} does not match expected ${wantPort}`);
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
    `SELECT current_database() AS db, host(inet_server_addr()) AS addr, inet_server_port() AS port`,
  );
  const actualDb = current.rows[0].db as string;
  const addr = current.rows[0].addr as string | null;
  const port = Number(current.rows[0].port);
  if (actualDb !== expectedDb) throw new Error(`refusing destructive work: connected to "${actualDb}"`);
  const ctx = containerVerificationContext();
  const decision = serverViewAllowed(addr, ctx.addrs);
  if (!decision.ok) {
    throw new Error(`refusing destructive work: ${decision.reason}`);
  }
  if (decision.mode === 'container-match') {
    console.log(`db-guard: server address "${addr}" matches verified container interfaces`);
  }
  const wantPort = ctx.serverPort ?? expectedPort;
  if (port !== wantPort) throw new Error(`refusing destructive work: server port ${port} mismatch (expected ${wantPort})`);
}
