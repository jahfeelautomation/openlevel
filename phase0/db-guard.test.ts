/**
 * db-guard unit tests (Phase 0). Pure logic — NO database required, so these
 * run in CI/sandbox as well as locally. They prove the M-01 guard table.
 */
import { describe, expect, test } from 'vitest';
import {
  assertDisposableUrl,
  classifyServerAddress,
  containerVerificationContext,
  parseTarget,
  redactUrl,
  serverViewAllowed,
} from './db-guard.js';

describe('assertDisposableUrl table (M-01)', () => {
  const cases: { url: string; ok: boolean; note: string }[] = [
    { url: 'postgres://u@127.0.0.1:5432/phase0_proofs', ok: true, note: 'canonical local URL' },
    { url: 'postgresql://u@localhost/phase0_x', ok: true, note: 'postgresql scheme + default port' },
    { url: 'POSTGRES://u@127.0.0.1/phase0_x', ok: true, note: 'uppercase scheme normalized' },
    { url: 'postgres://u@[::1]:5432/phase0_x', ok: true, note: 'IPv6 loopback' },
    { url: 'postgres://u:secret@127.0.0.1/phase0_x?sslmode=require', ok: true, note: 'allowlisted param' },
    { url: 'postgres://u@evil.example.com/phase0_proofs', ok: false, note: 'foreign host' },
    { url: 'postgres://u@127.0.0.1/phase0_proofs?host=evil.example.com', ok: false, note: '?host override' },
    {
      url: 'postgres://u@127.0.0.1/phase0_proofs?options=-csearch_path%3Devil',
      ok: false,
      note: '?options startup-packet injection',
    },
    { url: 'postgres://u@127.0.0.1/phase0_proofs?port=5433', ok: false, note: '?port override' },
    { url: 'postgres://u@127.0.0.1/phase0_proofs?dbname=prod', ok: false, note: '?dbname override' },
    { url: 'postgres://u@127.0.0.1/phase0_proofs?user=root', ok: false, note: '?user override' },
    { url: 'postgres://u@127.0.0.1/%70hase0_proofs', ok: true, note: 'encoded path decodes before check (still in-namespace)' },
    { url: 'postgres://u@127.0.0.1/%2fetc%2fpasswd', ok: false, note: '%2f smuggling fails namespace check' },
    { url: 'https://u@127.0.0.1/phase0_proofs', ok: false, note: 'non-postgres scheme' },
    { url: 'postgres://u@/var/run/postgresql/phase0_x', ok: false, note: 'unix-socket path is not loopback TCP' },
    { url: 'postgres://u@127.0.0.1/openlevel', ok: false, note: 'outside disposable namespace' },
    { url: 'postgres://u@127.0.0.1/phase0_prod_mirror', ok: false, note: 'prod marker inside namespace' },
    { url: 'postgres://u@127.0.0.1/phase0_x;DROP', ok: false, note: 'charset rejects metacharacters' },
    { url: 'not a url at all', ok: false, note: 'malformed input fails closed' },
    { url: '', ok: false, note: 'empty input fails closed' },
  ];
  for (const c of cases) {
    test(`${c.ok ? 'accepts' : 'rejects'}: ${c.note}`, () => {
      if (c.ok) {
        expect(() => assertDisposableUrl(c.url, 'TEST_URL')).not.toThrow();
      } else {
        expect(() => assertDisposableUrl(c.url, 'TEST_URL')).toThrow(/refusing to run/);
      }
    });
  }

  test('parseTarget returns host/port for live comparison', () => {
    expect(parseTarget('postgres://u@127.0.0.1:5433/phase0_x', 'T')).toEqual({
      db: 'phase0_x',
      host: '127.0.0.1',
      port: 5433,
    });
  });

  test('forbidden PG* env fails closed', () => {
    process.env.PGSERVICE = 'anything';
    try {
      expect(() => assertDisposableUrl('postgres://u@127.0.0.1/phase0_x', 'T')).toThrow(/PGSERVICE/);
    } finally {
      delete process.env.PGSERVICE;
    }
  });
});

describe('classifyServerAddress (review3 defects 1–2)', () => {
  const cases: { addr: string | null | undefined; want: 'loopback' | 'private' | 'rejected' }[] = [
    // Loopback, host() form and raw inet text alike (defect 1 regression).
    { addr: '127.0.0.1', want: 'loopback' },
    { addr: '127.0.0.1/32', want: 'loopback' },
    { addr: '127.0.0.2', want: 'loopback' },
    { addr: '::1', want: 'loopback' },
    { addr: '::1/128', want: 'loopback' },
    { addr: '[::1]', want: 'loopback' },
    { addr: 'localhost', want: 'loopback' },
    { addr: '  127.0.0.1  ', want: 'loopback' },
    // RFC1918 private ranges (defect 2 policy: Docker bridge port-forwarding).
    { addr: '10.0.0.1', want: 'private' },
    { addr: '10.255.255.255', want: 'private' },
    { addr: '172.16.0.1', want: 'private' },
    { addr: '172.17.0.1', want: 'private' },
    { addr: '172.17.0.1/32', want: 'private' },
    { addr: '172.31.255.255', want: 'private' },
    { addr: '192.168.0.1', want: 'private' },
    { addr: '192.168.1.1/32', want: 'private' },
    // Everything else fails closed.
    { addr: null, want: 'rejected' },
    { addr: undefined, want: 'rejected' },
    { addr: '', want: 'rejected' },
    { addr: '8.8.8.8', want: 'rejected' },
    { addr: '172.15.255.255', want: 'rejected' },
    { addr: '172.32.0.1', want: 'rejected' },
    { addr: '192.167.1.1', want: 'rejected' },
    { addr: '11.0.0.1', want: 'rejected' },
    { addr: '1.2.3.0/24', want: 'rejected' },
    { addr: '127.0.0.1/33', want: 'rejected' },
    { addr: '999.1.1.1', want: 'rejected' },
    { addr: 'not-an-ip', want: 'rejected' },
    { addr: 'fe80::1', want: 'rejected' },
  ];
  for (const c of cases) {
    test(`${JSON.stringify(c.addr)} → ${c.want}`, () => {
      expect(classifyServerAddress(c.addr)).toBe(c.want);
    });
  }
});

describe('serverViewAllowed policy', () => {
  const VERIFIED = ['172.17.0.4'];
  test('native mode: loopback accepted, RFC1918 rejected', () => {
    expect(serverViewAllowed('127.0.0.1', null)).toEqual({ ok: true, mode: 'loopback' });
    expect(serverViewAllowed('172.17.0.4', null).ok).toBe(false);
    expect(serverViewAllowed('10.0.0.1', null).ok).toBe(false);
  });
  test('container mode: exact interface match accepted (either form)', () => {
    expect(serverViewAllowed('172.17.0.4', VERIFIED)).toEqual({ ok: true, mode: 'container-match' });
    expect(serverViewAllowed('172.17.0.4/32', VERIFIED)).toEqual({ ok: true, mode: 'container-match' });
    expect(serverViewAllowed('127.0.0.1', VERIFIED)).toEqual({ ok: true, mode: 'loopback' });
  });
  test('container mode: non-matching RFC1918 rejected with evidence', () => {
    for (const addr of ['172.17.0.1', '172.17.0.9', '10.0.0.5']) {
      const r = serverViewAllowed(addr, VERIFIED);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('172.17.0.4');
    }
  });
  test('container mode: empty verified set rejects everything but loopback', () => {
    expect(serverViewAllowed('172.17.0.4', []).ok).toBe(false);
    expect(serverViewAllowed('127.0.0.1', []).ok).toBe(true);
  });
  test('containerVerificationContext: unset means native mode', () => {
    delete process.env.PHASE0_VERIFIED_ADDRS;
    delete process.env.PHASE0_CONTAINER_PORT;
    expect(containerVerificationContext()).toEqual({ addrs: null, serverPort: null });
    process.env.PHASE0_VERIFIED_ADDRS = '172.17.0.4, 10.0.0.9';
    process.env.PHASE0_CONTAINER_PORT = '5432';
    try {
      expect(containerVerificationContext()).toEqual({ addrs: ['172.17.0.4', '10.0.0.9'], serverPort: 5432 });
    } finally {
      delete process.env.PHASE0_VERIFIED_ADDRS;
      delete process.env.PHASE0_CONTAINER_PORT;
    }
  });
});

describe('redactUrl (m-07)', () => {
  test('redacts userinfo password', () => {
    expect(redactUrl('postgres://bob:hunter2@127.0.0.1/db')).toBe('postgres://bob:<redacted>@127.0.0.1/db');
  });
  test('redacts password-like query values', () => {
    expect(redactUrl('postgres://u@h/db?password=x&x=1')).not.toContain('password=x');
    expect(redactUrl('postgres://u@h/db?sslmode=require')).toContain('sslmode=require');
  });
});
