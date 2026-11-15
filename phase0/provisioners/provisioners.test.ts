/**
 * Provisioner unit tests (no database, no Docker).
 *
 * Cover the pure decision logic for both adapters: provisioner selection,
 * container-env hygiene, server-version gating, SCRAM-evidence parsing
 * (verifier format, CIDR containment, pg_hba rule matching), LIKE escaping,
 * the teardown planner, and CLI dry-run refusals (spawned, exit 2, no
 * socket attempted). Live PostgreSQL behavior is proven by Track B runs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  assertContainerEnvAbsent,
  assertHbaRequiresScram,
  assertScramVerifierFormat,
  assertSupportedServerVersion,
  cidrContainsV4,
  clearContainerEnv,
  findApplicableHbaRule,
  formatHbaRule,
  type HbaRuleRow,
} from './native.js';
import { escapeLikePrefix, planNativeTeardown } from './ownership.js';
import { PROVISIONER_ENV_VAR, UNIT_TEST_FILES, parseProvisioner } from './types.js';

function hba(overrides: Partial<HbaRuleRow> & { line_number: number }): HbaRuleRow {
  return {
    type: 'host',
    database: 'all',
    user_name: 'all',
    address: '127.0.0.1',
    netmask: '255.255.255.255',
    auth_method: 'scram-sha-256',
    options: null,
    error: null,
    ...overrides,
  };
}

describe('parseProvisioner', () => {
  test('unset or blank selects the explicit testcontainers default', () => {
    expect(parseProvisioner(undefined)).toBe('testcontainers');
    expect(parseProvisioner('')).toBe('testcontainers');
    expect(parseProvisioner('   ')).toBe('testcontainers');
  });
  test('explicit values select the named adapter', () => {
    expect(parseProvisioner('testcontainers')).toBe('testcontainers');
    expect(parseProvisioner('native')).toBe('native');
    expect(parseProvisioner('NATIVE')).toBe('native');
  });
  test('unknown values fail closed, never silently switch', () => {
    for (const bad of ['docker', 'auto', 'postgres', 'native,testcontainers']) {
      expect(() => parseProvisioner(bad)).toThrow(/not a known provisioner/);
    }
  });
});

describe('unit file list', () => {
  test('package.json test:phase0:unit covers every file the run command executes', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    for (const file of UNIT_TEST_FILES) {
      expect(pkg.scripts['test:phase0:unit']).toContain(file);
    }
  });
});

describe('container-env hygiene', () => {
  const names = ['PHASE0_VERIFIED_ADDRS', 'PHASE0_CONTAINER_PORT', 'PHASE0_BOOT_PASSWORD'];
  const saved = new Map<string, string | undefined>();
  const stash = () => {
    for (const n of names) {
      saved.set(n, process.env[n]);
      delete process.env[n];
    }
  };
  const restore = () => {
    for (const n of names) {
      const v = saved.get(n);
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  };

  test('absent context passes', () => {
    stash();
    try {
      expect(() => assertContainerEnvAbsent()).not.toThrow();
    } finally {
      restore();
    }
  });
  test('any leaked container var fails closed', () => {
    stash();
    try {
      for (const n of names) {
        process.env[n] = 'leaked';
        expect(() => assertContainerEnvAbsent()).toThrow(/must never leak/);
        delete process.env[n];
      }
    } finally {
      restore();
    }
  });
  test('clearContainerEnv deletes all three', () => {
    stash();
    try {
      for (const n of names) process.env[n] = 'x';
      clearContainerEnv();
      for (const n of names) expect(process.env[n]).toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe('assertSupportedServerVersion', () => {
  test('accepts PostgreSQL 16.x', () => {
    expect(assertSupportedServerVersion('16.16').major).toBe(16);
    expect(assertSupportedServerVersion('16').major).toBe(16);
    expect(assertSupportedServerVersion('16.0 (Debian 16.0-1)').major).toBe(16);
  });
  test('rejects other majors and garbage', () => {
    expect(() => assertSupportedServerVersion('15.4')).toThrow(/major is 15/);
    expect(() => assertSupportedServerVersion('17.0')).toThrow(/major is 17/);
    expect(() => assertSupportedServerVersion('not-a-version')).toThrow(/unparseable/);
  });
});

describe('assertScramVerifierFormat', () => {
  test('accepts SCRAM verifiers', () => {
    expect(() => assertScramVerifierFormat('SCRAM-SHA-256$4096:abc$def:ghi', 'phase0_rt')).not.toThrow();
  });
  test('rejects null, md5, and empty verifiers', () => {
    expect(() => assertScramVerifierFormat(null, 'phase0_rt')).toThrow(/no password verifier/);
    expect(() => assertScramVerifierFormat('md5d8578edf8458ce06fbc5bb76a58c5ca4', 'phase0_rt')).toThrow(/md5, not SCRAM/);
    expect(() => assertScramVerifierFormat('', 'phase0_rt')).toThrow(/unrecognized format/);
  });
});

describe('cidrContainsV4', () => {
  test('loopback and private ranges', () => {
    expect(cidrContainsV4('127.0.0.1', '255.255.255.255', '127.0.0.1')).toBe(true);
    expect(cidrContainsV4('127.0.0.0', '255.0.0.0', '127.0.0.1')).toBe(true);
    expect(cidrContainsV4('192.168.1.0', '255.255.255.0', '192.168.1.5')).toBe(true);
    expect(cidrContainsV4('192.168.1.0', '255.255.255.0', '192.168.2.5')).toBe(false);
    expect(cidrContainsV4('127.0.0.1', '255.255.255.255', '127.0.0.2')).toBe(false);
  });
  test('malformed input never matches', () => {
    expect(cidrContainsV4('999.1.1.1', '255.255.255.0', '192.168.1.5')).toBe(false);
    expect(cidrContainsV4('192.168.1.0', '255.255.255.0', 'not-an-ip')).toBe(false);
  });
});

describe('findApplicableHbaRule', () => {
  const scramLoopback = hba({ line_number: 90 });
  test('matches the exact loopback SCRAM row', () => {
    const row = findApplicableHbaRule([scramLoopback], {
      database: 'phase0_proofs',
      user: 'phase0_rt',
      clientIp: '127.0.0.1',
      tls: false,
    });
    expect(row.line_number).toBe(90);
    expect(() => assertHbaRequiresScram(row)).not.toThrow();
  });
  test('first matching line wins, even when it is weaker', () => {
    const trustFirst = hba({ line_number: 80, auth_method: 'trust' });
    const row = findApplicableHbaRule([trustFirst, scramLoopback], {
      database: 'phase0_proofs',
      user: 'phase0_rt',
      clientIp: '127.0.0.1',
      tls: false,
    });
    expect(row.line_number).toBe(80);
    expect(() => assertHbaRequiresScram(row)).toThrow(/requires 'trust', not 'scram-sha-256'/);
  });
  test('TLS state selects the hostssl/hostnossl family', () => {
    const nossl = hba({ line_number: 81, type: 'hostnossl', auth_method: 'scram-sha-256' });
    const ssl = hba({ line_number: 82, type: 'hostssl', auth_method: 'trust' });
    const plain = findApplicableHbaRule([nossl, ssl], {
      database: 'phase0_proofs',
      user: 'phase0_rt',
      clientIp: '127.0.0.1',
      tls: false,
    });
    expect(plain.line_number).toBe(81);
    const encrypted = findApplicableHbaRule([nossl, ssl], {
      database: 'phase0_proofs',
      user: 'phase0_rt',
      clientIp: '127.0.0.1',
      tls: true,
    });
    expect(encrypted.line_number).toBe(82);
  });
  test('comma lists and all-keywords match; other databases do not', () => {
    const row = hba({ line_number: 83, database: 'phase0_proofs,phase0_other', user_name: 'phase0_rt,postgres' });
    expect(
      findApplicableHbaRule([row], { database: 'phase0_other', user: 'postgres', clientIp: '127.0.0.1', tls: false })
        .line_number,
    ).toBe(83);
    expect(() =>
      findApplicableHbaRule([row], { database: 'elsewhere', user: 'phase0_rt', clientIp: '127.0.0.1', tls: false }),
    ).toThrow(/no pg_hba.conf rule matches/);
  });
  test('a parse error anywhere earlier fails the lookup closed', () => {
    const broken = hba({ line_number: 70, error: 'could not parse line' });
    expect(() =>
      findApplicableHbaRule([broken, scramLoopback], {
        database: 'phase0_proofs',
        user: 'phase0_rt',
        clientIp: '127.0.0.1',
        tls: false,
      }),
    ).toThrow(/parse error/);
  });
  test('CIDR address matching, not string equality', () => {
    const wide = hba({ line_number: 84, address: '127.0.0.0', netmask: '255.0.0.0' });
    expect(
      findApplicableHbaRule([wide], { database: 'phase0_proofs', user: 'phase0_rt', clientIp: '127.0.0.1', tls: false })
        .line_number,
    ).toBe(84);
    expect(() =>
      findApplicableHbaRule([wide], { database: 'phase0_proofs', user: 'phase0_rt', clientIp: '10.0.0.5', tls: false }),
    ).toThrow(/no pg_hba.conf rule matches/);
  });
  test('formatHbaRule renders evidence without secrets', () => {
    expect(formatHbaRule(scramLoopback)).toContain('line 90');
    expect(formatHbaRule(scramLoopback)).toContain('scram-sha-256');
  });
});

describe('escapeLikePrefix', () => {
  test('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLikePrefix('run-1')).toBe('run-1');
    expect(escapeLikePrefix('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });
});

describe('planNativeTeardown', () => {
  const keyed = [{ table: 'p1_business_event', column: 'business_key' }];
  test('created tables drop; pre-existing keyed tables get namespaced deletes + retained note', () => {
    const plan = planNativeTeardown({
      ownedRunIds: ['run-1'],
      createdTables: ['p3_operation'],
      keyedTables: keyed,
      allPrototypeTables: ['p1_business_event', 'p3_operation'],
    });
    expect(plan.drops).toEqual(['p3_operation']);
    expect(plan.deletes).toEqual([{ table: 'p1_business_event', column: 'business_key', prefixes: ['run-1'] }]);
    expect(plan.retained).toEqual([
      { item: 'p1_business_event', reason: expect.stringContaining('only run-namespaced rows deleted') },
    ]);
  });
  test('pre-existing tables without run keys are fully retained', () => {
    const plan = planNativeTeardown({
      ownedRunIds: ['run-1'],
      createdTables: [],
      keyedTables: [],
      allPrototypeTables: ['p3_wallet'],
    });
    expect(plan.drops).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.retained).toEqual([
      { item: 'p3_wallet', reason: expect.stringContaining('all rows retained') },
    ]);
  });
  test('ledger entries for vanished tables are ignored, never acted on', () => {
    const plan = planNativeTeardown({
      ownedRunIds: ['run-1'],
      createdTables: ['p9_ghost'],
      keyedTables: keyed,
      allPrototypeTables: ['p1_business_event'],
    });
    expect(plan.drops).toEqual([]);
    expect(plan.retained.map((r) => r.item)).not.toContain('p9_ghost');
  });
  test('dropped tables get no deletes even when keyed', () => {
    const plan = planNativeTeardown({
      ownedRunIds: ['run-1'],
      createdTables: ['p1_business_event'],
      keyedTables: keyed,
      allPrototypeTables: ['p1_business_event'],
    });
    expect(plan.drops).toEqual(['p1_business_event']);
    expect(plan.deletes).toEqual([]);
    expect(plan.retained).toEqual([]);
  });
});

describe('CLI dry-run refusals (no database)', () => {
  function scrubbedEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('PHASE0_') || key.startsWith('P1_') || key.startsWith('P3_') || key.startsWith('PG')) {
        delete env[key];
      }
    }
    return { ...env, ...extra };
  }

  function runUp(env: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, ['--import', 'tsx', 'phase0/test-env.ts', 'up'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 120_000,
    });
  }

  test('unknown provisioner exits 2 naming the valid values', () => {
    const r = runUp(scrubbedEnv({ [PROVISIONER_ENV_VAR]: 'bogus' }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not a known provisioner');
  }, 150_000);

  test('native without a database URL exits 2 before any connection', () => {
    const r = runUp(scrubbedEnv({ [PROVISIONER_ENV_VAR]: 'native' }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('PHASE0_DATABASE_URL is not set');
  }, 150_000);

  test('native with a non-loopback URL exits 2 (statically refused)', () => {
    const r = runUp(
      scrubbedEnv({
        [PROVISIONER_ENV_VAR]: 'native',
        PHASE0_DATABASE_URL: 'postgres://u:p@10.0.0.5:5432/phase0_proofs',
        PHASE0_RT_PASSWORD: 'x',
      }),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('is not loopback');
  }, 150_000);
});
