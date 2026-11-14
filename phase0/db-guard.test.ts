/**
 * db-guard unit tests (Phase 0). Pure logic — NO database required, so these
 * run in CI/sandbox as well as locally. They prove the M-01 guard table.
 */
import { describe, expect, test } from 'vitest';
import { assertDisposableUrl, parseTarget, redactUrl } from './db-guard.js';

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

describe('redactUrl (m-07)', () => {
  test('redacts userinfo password', () => {
    expect(redactUrl('postgres://bob:hunter2@127.0.0.1/db')).toBe('postgres://bob:<redacted>@127.0.0.1/db');
  });
  test('redacts password-like query values', () => {
    expect(redactUrl('postgres://u@h/db?password=x&x=1')).not.toContain('password=x');
    expect(redactUrl('postgres://u@h/db?sslmode=require')).toContain('sslmode=require');
  });
});
