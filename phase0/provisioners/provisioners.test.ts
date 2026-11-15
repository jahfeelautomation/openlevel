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
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  assertContainerIdentity,
  parseImageInspection,
  parseInspection,
} from '../container-identity.js';
import {
  assertContainerEnvAbsent,
  assertHbaRequiresScram,
  assertScramVerifierFormat,
  assertSupportedServerVersion,
  cidrContainsV4,
  clearContainerEnv,
  findApplicableHbaRule,
  formatHbaRule,
  toHbaRuleRow,
  type HbaRuleRow,
} from './native.js';
import { escapeLikePrefix, planNativeTeardown } from './ownership.js';
import {
  LOOPBACK_HOST_IP,
  LoopbackPostgreSqlContainer,
  PG_IMAGE,
  stashLiveContainer,
  stopStashedContainerBestEffort,
  takeLiveContainer,
  withStartedContainer,
} from './testcontainers.js';
import { PROVISIONER_ENV_VAR, UNIT_TEST_FILES, parseProvisioner } from './types.js';

function hba(overrides: Partial<HbaRuleRow> & { line_number: number }): HbaRuleRow {
  return {
    type: 'host',
    database: ['all'],
    user_name: ['all'],
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

// pg_hba_file_rules declares database/user_name/options as text[], which
// node-postgres returns as JS arrays. Fixtures historically used strings too,
// so both agreed with each other and disagreed with PostgreSQL: the first
// live Track B run died on `field.split is not a function` (exit 2).
describe('toHbaRuleRow (real pg_hba_file_rules row shape)', () => {
  const pgRow = {
    line_number: 115,
    type: 'host',
    database: ['all'],
    user_name: ['all'],
    address: '127.0.0.1',
    netmask: '255.255.255.255',
    auth_method: 'scram-sha-256',
    options: null,
    error: null,
  };

  test('array-valued columns stay arrays end-to-end (M6)', () => {
    const row = toHbaRuleRow(pgRow);
    expect(row.database).toEqual(['all']);
    expect(row.user_name).toEqual(['all']);
  });

  test('multi-element, NULL and scalar inputs are all handled', () => {
    expect(toHbaRuleRow({ ...pgRow, database: ['db1', 'db2'] }).database).toEqual(['db1', 'db2']);
    expect(toHbaRuleRow({ ...pgRow, database: null }).database).toEqual([]);
    expect(toHbaRuleRow({ ...pgRow, user_name: ['phase0_rt'] }).user_name).toEqual(['phase0_rt']);
    expect(toHbaRuleRow({ ...pgRow, options: ['clientcert=verify-full'] }).options).toBe('clientcert=verify-full');
    expect(toHbaRuleRow({ ...pgRow, options: null }).options).toBeNull();
    // legacy scalar input degrades to a single element, never split
    expect(toHbaRuleRow({ ...pgRow, database: 'all' }).database).toEqual(['all']);
  });

  test('a converted real-shaped row still matches a loopback SCRAM rule', () => {
    const row = toHbaRuleRow(pgRow);
    const hit = findApplicableHbaRule([row], {
      database: 'phase0_proofs',
      user: 'phase0_rt',
      clientIp: '127.0.0.1',
      tls: false,
    });
    expect(hit.auth_method).toBe('scram-sha-256');
    expect(formatHbaRule(hit)).toContain('db=all');
    expect(() => assertHbaRequiresScram(hit)).not.toThrow();
  });

  test('a NULL database list degrades to fail-closed, never a TypeError', () => {
    const broken = toHbaRuleRow({ ...pgRow, database: null, user_name: null });
    expect(broken.database).toEqual([]);
    expect(() =>
      findApplicableHbaRule([broken], {
        database: 'phase0_proofs',
        user: 'phase0_rt',
        clientIp: '127.0.0.1',
        tls: false,
      }),
    ).toThrow(/no pg_hba\.conf rule matches/);
  });

  test('the live query no longer blind-casts the row shape', () => {
    const src = readFileSync('phase0/provisioners/native.ts', 'utf8');
    expect(src).not.toMatch(/rows\s*=\s*r\.rows as HbaRuleRow\[\]/);
    expect(src).toMatch(/r\.rows\.map\(toHbaRuleRow\)/);
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
    const row = hba({ line_number: 83, database: ['phase0_proofs', 'phase0_other'], user_name: ['phase0_rt', 'postgres'] });
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

describe('HBA token boundaries (review4 M6)', () => {
  const query = { database: 'phase0_x', user: 'phase0_rt', clientIp: '127.0.0.1', tls: false };

  test("['phase0_x,other'] must not match database phase0_x (quoted comma stays one token)", () => {
    const row = toHbaRuleRow({
      line_number: 100, type: 'host', database: ['phase0_x,other'], user_name: ['all'],
      address: '127.0.0.1', netmask: '255.255.255.255', auth_method: 'scram-sha-256', options: null, error: null,
    });
    expect(() => findApplicableHbaRule([row], query)).toThrow(/no pg_hba\.conf rule matches/);
  });

  test("['phase0_x'] must match database phase0_x", () => {
    const row = hba({ line_number: 101, database: ['phase0_x'] });
    expect(findApplicableHbaRule([row], query).line_number).toBe(101);
  });

  test("['phase0_x', 'other'] preserves multi-element matching", () => {
    const row = hba({ line_number: 102, database: ['phase0_x', 'other'] });
    expect(findApplicableHbaRule([row], query).line_number).toBe(102);
    expect(() =>
      findApplicableHbaRule([row], { ...query, database: 'elsewhere' }),
    ).toThrow(/no pg_hba\.conf rule matches/);
  });

  test('user-name matching preserves token boundaries equivalently', () => {
    const quoted = toHbaRuleRow({
      line_number: 103, type: 'host', database: ['phase0_x'], user_name: ['phase0_rt,other'],
      address: '127.0.0.1', netmask: '255.255.255.255', auth_method: 'scram-sha-256', options: null, error: null,
    });
    expect(() => findApplicableHbaRule([quoted], query)).toThrow(/no pg_hba\.conf rule matches/);
    const plain = hba({ line_number: 104, database: ['phase0_x'], user_name: ['phase0_rt', 'postgres'] });
    expect(findApplicableHbaRule([plain], query).line_number).toBe(104);
  });

  test('scalar database input degrades to one token, never re-split', () => {
    const row = toHbaRuleRow({
      line_number: 105, type: 'host', database: 'phase0_x,other', user_name: ['all'],
      address: '127.0.0.1', netmask: '255.255.255.255', auth_method: 'scram-sha-256', options: null, error: null,
    });
    expect(row.database).toEqual(['phase0_x,other']);
    expect(() => findApplicableHbaRule([row], query)).toThrow(/no pg_hba\.conf rule matches/);
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

  // Live Track B failure this guards: teardown dropped p1_business_event
  // while p1_business_event_discrepancy (FK → it) was still present →
  // "cannot drop table ... because other objects depend on it" (exit 3 path).
  test('FK children drop before their parents regardless of ledger order', () => {
    const plan = planNativeTeardown({
      ownedRunIds: ['run-1'],
      createdTables: ['p1_business_event', 'p1_business_event_discrepancy'],
      keyedTables: keyed,
      allPrototypeTables: ['p1_business_event', 'p1_business_event_discrepancy'],
      fkDependencies: [{ child: 'p1_business_event_discrepancy', parent: 'p1_business_event' }],
    });
    expect(plan.drops).toEqual(['p1_business_event_discrepancy', 'p1_business_event']);
    expect(plan.retained).toEqual([]);
  });

  test('a referencing table we do not own blocks the drop, named in retained', () => {
    const plan = planNativeTeardown({
      ownedRunIds: ['run-1'],
      createdTables: ['p1_business_event'],
      keyedTables: keyed,
      // The blocker is not a prototype table: the FK query reads all of
      // `public`, so a non-prototype referencer must still pin the drop.
      allPrototypeTables: ['p1_business_event'],
      fkDependencies: [{ child: 'someone_elses_table', parent: 'p1_business_event' }],
    });
    expect(plan.drops).toEqual([]);
    expect(plan.retained).toEqual([
      {
        item: 'p1_business_event',
        reason: expect.stringContaining('referenced by someone_elses_table'),
      },
    ]);
  });

  test('blocking propagates transitively through the FK chain', () => {
    // external → p1_c → p1_b → p1_a, all three created by this execution:
    // the external reference pins the whole chain.
    const plan = planNativeTeardown({
      ownedRunIds: ['run-1'],
      createdTables: ['p1_a', 'p1_b', 'p1_c'],
      keyedTables: [],
      allPrototypeTables: ['p1_a', 'p1_b', 'p1_c'],
      fkDependencies: [
        { child: 'external_table', parent: 'p1_c' },
        { child: 'p1_c', parent: 'p1_b' },
        { child: 'p1_b', parent: 'p1_a' },
      ],
    });
    expect(plan.drops).toEqual([]);
    expect(plan.retained.map((r) => r.item).sort()).toEqual(['p1_a', 'p1_b', 'p1_c']);
  });

  test('ordering is deterministic across a longer chain and keeps unrelated order', () => {
    const plan = planNativeTeardown({
      ownedRunIds: ['run-1'],
      createdTables: ['p3_wallet', 'p1_parent', 'p1_child', 'p3_operation'],
      keyedTables: [],
      allPrototypeTables: ['p3_wallet', 'p1_parent', 'p1_child', 'p3_operation'],
      fkDependencies: [{ child: 'p1_child', parent: 'p1_parent' }],
    });
    // p1_child before p1_parent; unrelated tables keep ledger order around them.
    expect(plan.drops.indexOf('p1_child')).toBeLessThan(plan.drops.indexOf('p1_parent'));
    expect(plan.drops).toHaveLength(4);
    expect([...plan.drops].sort()).toEqual(['p1_child', 'p1_parent', 'p3_operation', 'p3_wallet']);
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

type ExposedHook = { beforeContainerCreated(): Promise<void> };
type ExposedHostConfig = { hostConfig: { PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }>> } & Record<string, unknown> };

function hookOf(c: LoopbackPostgreSqlContainer): ExposedHook {
  return c as unknown as ExposedHook;
}

function bindingsOf(c: LoopbackPostgreSqlContainer): Record<string, Array<{ HostIp?: string; HostPort?: string }>> {
  return (c as unknown as ExposedHostConfig).hostConfig.PortBindings ?? {};
}

describe('LoopbackPostgreSqlContainer hook (review4 B1)', () => {
  test('HostIp-less bindings gain 127.0.0.1 (real constructor + real hook)', async () => {
    const c = new LoopbackPostgreSqlContainer(PG_IMAGE);
    // Precondition: Testcontainers populates bindings with HostPort only.
    expect(bindingsOf(c)['5432/tcp']).toEqual([{ HostPort: '0' }]);
    await hookOf(c).beforeContainerCreated();
    expect(bindingsOf(c)['5432/tcp']).toEqual([{ HostIp: LOOPBACK_HOST_IP, HostPort: '0' }]);
  });

  test('multiple published bindings all receive the loopback address', async () => {
    const c = new LoopbackPostgreSqlContainer(PG_IMAGE).withExposedPorts({ container: 5433, host: 0 });
    await hookOf(c).beforeContainerCreated();
    const bindings = bindingsOf(c);
    expect(Object.keys(bindings).sort()).toEqual(['5432/tcp', '5433/tcp']);
    for (const list of Object.values(bindings)) {
      for (const b of list) expect(b.HostIp).toBe(LOOPBACK_HOST_IP);
    }
  });

  test('other HostConfig fields remain intact', async () => {
    const c = new LoopbackPostgreSqlContainer(PG_IMAGE);
    const before = JSON.parse(JSON.stringify((c as unknown as ExposedHostConfig).hostConfig)) as Record<string, unknown>;
    await hookOf(c).beforeContainerCreated();
    const after = (c as unknown as ExposedHostConfig).hostConfig;
    for (const key of Object.keys(before)) {
      if (key === 'PortBindings') continue;
      expect(after[key]).toEqual(before[key]);
    }
    expect(Object.keys(bindingsOf(c))).toEqual(Object.keys(before.PortBindings as Record<string, unknown>));
  });

  test('an explicit non-loopback binding cannot survive the hook', async () => {
    const c = new LoopbackPostgreSqlContainer(PG_IMAGE);
    bindingsOf(c)['5432/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '0' }];
    await hookOf(c).beforeContainerCreated();
    expect(bindingsOf(c)['5432/tcp']).toEqual([{ HostIp: LOOPBACK_HOST_IP, HostPort: '0' }]);
  });

  test('missing bindings fail closed in the hook', async () => {
    const c = new LoopbackPostgreSqlContainer(PG_IMAGE);
    delete (c as unknown as ExposedHostConfig).hostConfig.PortBindings;
    await expect(hookOf(c).beforeContainerCreated()).rejects.toThrow(/no published port bindings/);
  });

  test('malformed bindings fail closed in the hook', async () => {
    const c = new LoopbackPostgreSqlContainer(PG_IMAGE);
    (c as unknown as ExposedHostConfig).hostConfig.PortBindings = { '5432/tcp': 'nope' } as unknown as Record<string, Array<{ HostIp?: string }>>;
    await expect(hookOf(c).beforeContainerCreated()).rejects.toThrow(/malformed PortBindings/);
  });

  test('hook output is accepted by the identity policy (no circular fixture)', async () => {
    const c = new LoopbackPostgreSqlContainer(PG_IMAGE);
    await hookOf(c).beforeContainerCreated();
    // The HostIp below comes from the hook's mutation, not hand-written.
    const hostIp = bindingsOf(c)['5432/tcp']?.[0]?.HostIp ?? '(missing)';
    const runId = 'hook-acceptance-run';
    const containerRaw = {
      Id: 'abc123def456789012345678901234567890123456789012345678901234',
      Name: '/phase0-pg-hook',
      Image: 'sha256:9f2d7d3e9c4b1a5f6e0d8c2b4a6f1e3d5c7b9a1d3f5e7c9b1d3f5a7c9e1b3d5f7',
      Config: { Image: PG_IMAGE, Labels: { 'openlevel.phase0.run': runId, 'openlevel.phase0.disposable': 'true' } },
      NetworkSettings: {
        Networks: { bridge: { IPAddress: '172.17.0.4', Gateway: '172.17.0.1' } },
        Ports: { '5432/tcp': [{ HostIp: hostIp, HostPort: '45432' }] },
      },
    };
    const imageRaw = {
      Id: 'sha256:9f2d7d3e9c4b1a5f6e0d8c2b4a6f1e3d5c7b9a1d3f5e7c9b1d3f5a7c9e1b3d5f7',
      RepoDigests: [] as string[],
      Architecture: 'amd64',
      Os: 'linux',
    };
    const v = assertContainerIdentity(parseInspection(containerRaw), parseImageInspection(imageRaw), parseImageInspection(imageRaw), {
      expectedRunId: runId,
      expectedImageRef: PG_IMAGE,
      expectedDb: 'phase0_proofs',
      expectedOs: 'linux',
      expectedArch: 'amd64',
      urlPort: 45432,
      containerPort: 5432,
    });
    expect(v.ok).toBe(true);
  });
});

describe('started-container lifecycle (review4 M2)', () => {
  const KEY = '__phase0_container';
  let saved: unknown;
  let hasSaved = false;
  let errors: string[];
  let errorSpy: ReturnType<typeof vi.spyOn>;

  function fakeContainer(opts: { failStop?: boolean } = {}) {
    return {
      stops: 0,
      async stop(): Promise<void> {
        this.stops += 1;
        if (opts.failStop) throw new Error('stop exploded');
      },
    };
  }

  function stashSetup() {
    hasSaved = KEY in (globalThis as Record<string, unknown>);
    saved = (globalThis as Record<string, unknown>)[KEY];
    delete (globalThis as Record<string, unknown>)[KEY];
    errors = [];
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
  }

  afterEach(() => {
    if (hasSaved) (globalThis as Record<string, unknown>)[KEY] = saved;
    else delete (globalThis as Record<string, unknown>)[KEY];
    errorSpy?.mockRestore();
  });

  test('identity-verification failure stops the started container, primary error preserved', async () => {
    stashSetup();
    const fake = fakeContainer();
    await expect(
      withStartedContainer(fake, async () => {
        throw new Error('identity boom');
      }),
    ).rejects.toThrow('identity boom');
    expect(fake.stops).toBe(1);
    expect(takeLiveContainer()).toBeUndefined();
  });

  test('readiness failure stops the started container', async () => {
    stashSetup();
    const fake = fakeContainer();
    await expect(
      withStartedContainer(fake, async () => {
        throw new Error('postgres readiness timeout');
      }),
    ).rejects.toThrow('postgres readiness timeout');
    expect(fake.stops).toBe(1);
  });

  test('SCRAM verification failure stops the started container', async () => {
    stashSetup();
    const fake = fakeContainer();
    await expect(
      withStartedContainer(fake, async () => {
        throw new Error("password_encryption is 'md5'");
      }),
    ).rejects.toThrow("password_encryption is 'md5'");
    expect(fake.stops).toBe(1);
  });

  test('state-persistence failure stops the started container', async () => {
    stashSetup();
    const fake = fakeContainer();
    await expect(
      withStartedContainer(fake, async () => {
        throw new Error('EACCES: state file');
      }),
    ).rejects.toThrow('EACCES: state file');
    expect(fake.stops).toBe(1);
  });

  test('cleanup failure is reported separately and never masks the primary error', async () => {
    stashSetup();
    const fake = fakeContainer({ failStop: true });
    await expect(
      withStartedContainer(fake, async () => {
        throw new Error('primary boom');
      }),
    ).rejects.toThrow('primary boom');
    expect(fake.stops).toBe(1);
    expect(errors.join('\n')).toContain('cleanup FAILED');
  });

  test('success keeps the handle stashed for normal teardown', async () => {
    stashSetup();
    const fake = fakeContainer();
    const out = await withStartedContainer(fake, async () => 'provisioned');
    expect(out).toBe('provisioned');
    expect(fake.stops).toBe(0);
    expect(takeLiveContainer()).toBe(fake);
  });

  test('repeated cleanup is idempotent: second stop is a no-op', async () => {
    stashSetup();
    const fake = fakeContainer();
    stashLiveContainer(fake);
    expect(await stopStashedContainerBestEffort('test')).toBe(true);
    expect(await stopStashedContainerBestEffort('test')).toBe(false);
    expect(fake.stops).toBe(1);
  });
});
