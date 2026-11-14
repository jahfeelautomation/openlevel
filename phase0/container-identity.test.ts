/**
 * container-identity unit tests (no Docker required). Fixtures mirror real
 * `docker inspect` shapes. Covers the four mandated regression cases plus
 * unknown/missing/ambiguous-data rejections.
 */
import { describe, expect, test } from 'vitest';
import {
  assertContainerIdentity,
  ContainerIdentityError,
  matchServerAddress,
  parseInspection,
  type IdentityPolicy,
} from './container-identity.js';

const RUN = 'run-2026-11-15-001';
const DIGEST = 'postgres@sha256:30551eca978d79ccf49d037bc297b5670baea61a04ceca42ff7fd3100163d3ce';

function fixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    Id: 'abc123def456789012345678901234567890123456789012345678901234',
    Name: '/phase0-pg-run-001',
    Config: {
      Labels: {
        'openlevel.phase0.run': RUN,
        'openlevel.phase0.disposable': 'true',
      },
    },
    RepoDigests: [DIGEST, 'postgres@sha256:otherarchdigest000000000000000000000000000000000000000000000001'],
    NetworkSettings: {
      Networks: {
        bridge: { IPAddress: '172.17.0.4', Gateway: '172.17.0.1' },
      },
      Ports: {
        '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '45432' }],
      },
    },
    ...overrides,
  };
}

const policy: IdentityPolicy = {
  expectedRunId: RUN,
  expectedImageRef: DIGEST,
  expectedDb: 'phase0_proofs',
  urlPort: 45432,
  containerPort: 5432,
};

function verdictOf(raw: unknown) {
  return assertContainerIdentity(parseInspection(raw), policy);
}

describe('container identity (review3 follow-up)', () => {
  test('verified container-private address: accepted', () => {
    const v = verdictOf(fixture());
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.serverAddresses).toEqual(['172.17.0.4']);
    expect(matchServerAddress('172.17.0.4', v)).toEqual({ ok: true });
  });

  test('arbitrary RFC1918 address: rejected', () => {
    const v = verdictOf(fixture());
    if (!v.ok) throw new Error('unreachable');
    // Sibling container / gateway IPs share the range but are NOT this container.
    for (const addr of ['172.17.0.1', '172.17.0.9', '10.0.0.5', '192.168.1.1']) {
      const r = matchServerAddress(addr, v);
      expect(r.ok).toBe(false);
    }
  });

  test('correct container address but public host-port binding: rejected', () => {
    const raw = fixture() as Record<string, any>;
    raw.NetworkSettings.Ports['5432/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '45432' }];
    expect(() => verdictOf(raw)).toThrow(/not loopback-only/);
  });

  test('correct loopback host binding and container identity: accepted', () => {
    const v = verdictOf(fixture());
    expect(v.ok).toBe(true);
  });

  test('IPv6 loopback binding accepted', () => {
    const raw = fixture() as Record<string, any>;
    raw.NetworkSettings.Ports['5432/tcp'] = [{ HostIp: '::1', HostPort: '45432' }];
    expect(verdictOf(raw).ok).toBe(true);
  });

  test('missing run label: rejected', () => {
    const raw = fixture() as Record<string, any>;
    raw.Config.Labels = {};
    expect(() => verdictOf(raw)).toThrow(/run label/);
  });

  test('wrong run id: rejected', () => {
    const raw = fixture() as Record<string, any>;
    raw.Config.Labels['openlevel.phase0.run'] = 'someone-elses-run';
    expect(() => verdictOf(raw)).toThrow(/run label mismatch/);
  });

  test('missing disposable flag: rejected', () => {
    const raw = fixture() as Record<string, any>;
    delete raw.Config.Labels['openlevel.phase0.disposable'];
    expect(() => verdictOf(raw)).toThrow(/disposable/);
  });

  test('digest mismatch: rejected', () => {
    const raw = fixture() as Record<string, any>;
    raw.RepoDigests = ['postgres@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'];
    expect(() => verdictOf(raw)).toThrow(/digest mismatch/);
  });

  test('missing RepoDigests: rejected as unknown', () => {
    const raw = fixture() as Record<string, any>;
    delete raw.RepoDigests;
    expect(() => verdictOf(raw)).toThrow(/no RepoDigests/i);
  });

  test('unpublished port: rejected', () => {
    const raw = fixture() as Record<string, any>;
    raw.NetworkSettings.Ports['5432/tcp'] = null;
    expect(() => verdictOf(raw)).toThrow(/no published binding/);
  });

  test('URL port not among bindings: rejected', () => {
    const v = (() => assertContainerIdentity(parseInspection(fixture()), { ...policy, urlPort: 9999 })) ;
    expect(v).toThrow(/not among published bindings/);
  });

  test('empty interface list: rejected as ambiguous', () => {
    const raw = fixture() as Record<string, any>;
    raw.NetworkSettings.Networks = { bridge: { IPAddress: '', Gateway: '' } };
    expect(() => verdictOf(raw)).toThrow(/no interface addresses/);
  });

  test('malformed inspect payload: rejected, never throws raw TypeError', () => {
    for (const bad of [null, 42, 'x', {}, { Id: 'short' }]) {
      expect(() => parseInspection(bad)).toThrow(ContainerIdentityError);
    }
  });

  test('malformed port entry: rejected', () => {
    const raw = fixture() as Record<string, any>;
    raw.NetworkSettings.Ports['5432/tcp'] = [{ HostIp: 12345 }];
    expect(() => verdictOf(raw)).toThrow(/malformed binding/);
  });
});
