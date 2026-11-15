/**
 * container-identity unit tests (no Docker required). Fixtures mirror real
 * `docker inspect` shapes — verified against the Docker API types
 * (@types/dockerode): RepoDigests exists ONLY on image objects, never on
 * container objects. The CI `no RepoDigests` FATAL was that wrong-object
 * read; identity now resolves through image inspect (see
 * container-identity.ts header for the trust argument).
 */
import { describe, expect, test } from 'vitest';
import {
  assertContainerIdentity,
  ContainerIdentityError,
  expectedRunnerArch,
  mapNodeArch,
  matchServerAddress,
  parseImageInspection,
  parseInspection,
  repoDigestMatches,
  type IdentityPolicy,
} from './container-identity.js';

const RUN = 'run-2026-11-15-001';
const DIGEST_HEX = '30551eca978d79ccf49d037bc297b5670baea61a04ceca42ff7fd3100163d3ce';
const DIGEST = `postgres@sha256:${DIGEST_HEX}`;
const IMAGE_ID = 'sha256:9f2d7d3e9c4b1a5f6e0d8c2b4a6f1e3d5c7b9a1d3f5e7c9b1d3f5a7c9e1b3d5f7';
const CONTAINER_ID = 'abc123def456789012345678901234567890123456789012345678901234';

/** Real `docker inspect <container>` shape: NO RepoDigests field exists here. */
function containerFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    Id: CONTAINER_ID,
    Name: '/phase0-pg-run-001',
    Image: IMAGE_ID,
    Config: {
      Image: DIGEST,
      Labels: {
        'openlevel.phase0.run': RUN,
        'openlevel.phase0.disposable': 'true',
      },
    },
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

/** Real `docker image inspect` shape. */
function imageFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    Id: IMAGE_ID,
    RepoTags: [],
    RepoDigests: [DIGEST],
    Architecture: 'amd64',
    Os: 'linux',
    ...overrides,
  };
}

const policy: IdentityPolicy = {
  expectedRunId: RUN,
  expectedImageRef: DIGEST,
  expectedDb: 'phase0_proofs',
  expectedOs: 'linux',
  expectedArch: 'amd64',
  urlPort: 45432,
  containerPort: 5432,
};

function verdictOf(containerRaw: unknown, imageByIdRaw: unknown = imageFixture(), imageByRefRaw: unknown = imageFixture()) {
  return assertContainerIdentity(
    parseInspection(containerRaw),
    parseImageInspection(imageByIdRaw),
    parseImageInspection(imageByRefRaw),
    policy,
  );
}

describe('container identity (prompt12 Workstream B)', () => {
  test('CI regression: real-shaped container (no RepoDigests field) verifies via image chain', () => {
    const raw = containerFixture() as Record<string, unknown>;
    expect('RepoDigests' in raw).toBe(false); // the field genuinely does not exist here
    const v = verdictOf(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.serverAddresses).toEqual(['172.17.0.4']);
    expect(v.containerId).toBe(CONTAINER_ID);
  });

  test('verified container-private address: accepted', () => {
    const v = verdictOf(containerFixture());
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(matchServerAddress('172.17.0.4', v)).toEqual({ ok: true });
  });

  test('arbitrary RFC1918 address: rejected', () => {
    const v = verdictOf(containerFixture());
    if (!v.ok) throw new Error('unreachable');
    for (const addr of ['172.17.0.1', '172.17.0.9', '10.0.0.5', '192.168.1.1']) {
      expect(matchServerAddress(addr, v).ok).toBe(false);
    }
  });

  test('correct container address but public host-port binding: rejected', () => {
    const raw = containerFixture() as Record<string, any>;
    raw.NetworkSettings.Ports['5432/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '45432' }];
    expect(() => verdictOf(raw)).toThrow(/not loopback-only/);
  });

  test('correct loopback host binding and container identity: accepted', () => {
    expect(verdictOf(containerFixture()).ok).toBe(true);
  });

  test('IPv6 loopback binding accepted', () => {
    const raw = containerFixture() as Record<string, any>;
    raw.NetworkSettings.Ports['5432/tcp'] = [{ HostIp: '::1', HostPort: '45432' }];
    expect(verdictOf(raw).ok).toBe(true);
  });

  test('missing run label: rejected', () => {
    const raw = containerFixture() as Record<string, any>;
    raw.Config.Labels = {};
    expect(() => verdictOf(raw)).toThrow(/run label/);
  });

  test('wrong run id: rejected', () => {
    const raw = containerFixture() as Record<string, any>;
    raw.Config.Labels['openlevel.phase0.run'] = 'someone-elses-run';
    expect(() => verdictOf(raw)).toThrow(/run label mismatch/);
  });

  test('missing disposable flag: rejected', () => {
    const raw = containerFixture() as Record<string, any>;
    delete raw.Config.Labels['openlevel.phase0.disposable'];
    expect(() => verdictOf(raw)).toThrow(/disposable/);
  });

  test('container created from a different image: rejected', () => {
    const raw = containerFixture() as Record<string, any>;
    raw.Config.Image = 'postgres@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    expect(() => verdictOf(raw)).toThrow(/created from a different image/);
  });

  test('pinned digest resolving to a different image: rejected (wrong manifest digest)', () => {
    const other = imageFixture({
      Id: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(() => verdictOf(containerFixture(), imageFixture(), other)).toThrow(/resolves to a different image/);
  });

  test('image inspect inconsistent with container image id: rejected (wrong config digest)', () => {
    const other = imageFixture({
      Id: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(() => verdictOf(containerFixture(), other, imageFixture())).toThrow(/does not match container image/);
  });

  test('wrong platform arch: rejected', () => {
    const other = imageFixture({ Architecture: 'arm64' });
    expect(() => verdictOf(containerFixture(), other, other)).toThrow(/platform mismatch/);
  });

  test('wrong platform OS: rejected', () => {
    const other = imageFixture({ Os: 'windows' });
    expect(() => verdictOf(containerFixture(), other, other)).toThrow(/platform mismatch/);
  });

  test('image-level RepoDigests empty: accepted, recorded as bookkeeping-absent', () => {
    // The resolution chain (pinned digest → daemon image → container) is the
    // cryptographic anchor; RepoDigests is a consistency signal, not the anchor.
    const bare = imageFixture({ RepoDigests: [] });
    const v = verdictOf(containerFixture(), bare, bare);
    expect(v.ok).toBe(true);
  });

  test('image-level RepoDigests present but missing pinned ref: rejected as inconsistent', () => {
    const bare = imageFixture({
      RepoDigests: ['postgres@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
    });
    expect(() => verdictOf(containerFixture(), bare, bare)).toThrow(/inconsistent with pinned/);
  });

  test('registry-prefixed RepoDigest entry still matches (normalization)', () => {
    expect(repoDigestMatches(`docker.io/library/postgres@sha256:${DIGEST_HEX}`, DIGEST)).toBe(true);
    expect(repoDigestMatches(DIGEST, DIGEST)).toBe(true);
    expect(repoDigestMatches('postgres@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', DIGEST)).toBe(
      false,
    );
    expect(repoDigestMatches('not-a-digest', DIGEST)).toBe(false);
    expect(repoDigestMatches(`evil.io/postgres@sha256:${DIGEST_HEX}`, DIGEST)).toBe(false);
  });

  test('valid multi-platform image verification: accepted with full evidence', () => {
    const img = imageFixture({
      RepoDigests: [DIGEST, `docker.io/library/postgres@sha256:${DIGEST_HEX}`],
    });
    const v = verdictOf(containerFixture(), img, img);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.evidence.imageId).toBe(IMAGE_ID);
    expect(v.evidence.platform).toBe('linux/amd64');
  });

  test('unpublished port: rejected', () => {
    const raw = containerFixture() as Record<string, any>;
    raw.NetworkSettings.Ports['5432/tcp'] = null;
    expect(() => verdictOf(raw)).toThrow(/no published binding/);
  });

  test('URL port not among bindings: rejected', () => {
    expect(() =>
      assertContainerIdentity(
        parseInspection(containerFixture()),
        parseImageInspection(imageFixture()),
        parseImageInspection(imageFixture()),
        { ...policy, urlPort: 9999 },
      ),
    ).toThrow(/not among published bindings/);
  });

  test('empty interface list: rejected as ambiguous', () => {
    const raw = containerFixture() as Record<string, any>;
    raw.NetworkSettings.Networks = { bridge: { IPAddress: '', Gateway: '' } };
    expect(() => verdictOf(raw)).toThrow(/no interface addresses/);
  });

  test('malformed container inspect payload: rejected, never throws raw TypeError', () => {
    for (const bad of [null, 42, 'x', {}, { Id: 'short' }]) {
      expect(() => parseInspection(bad)).toThrow(ContainerIdentityError);
    }
  });

  test('missing Config.Image or top-level Image: rejected at parse', () => {
    const noConfigImage = containerFixture() as Record<string, any>;
    delete noConfigImage.Config.Image;
    expect(() => parseInspection(noConfigImage)).toThrow(/creation image reference/);
    const noImageId = containerFixture() as Record<string, any>;
    delete noImageId.Image;
    expect(() => parseInspection(noImageId)).toThrow(/image id/);
  });

  test('malformed image inspect payload: rejected', () => {
    for (const bad of [null, 42, 'x', {}, { Id: 'sha256:abc' }]) {
      expect(() => parseImageInspection(bad)).toThrow(ContainerIdentityError);
    }
  });

  test('malformed port entry: rejected', () => {
    const raw = containerFixture() as Record<string, any>;
    raw.NetworkSettings.Ports['5432/tcp'] = [{ HostIp: 12345 }];
    expect(() => verdictOf(raw)).toThrow(/malformed binding/);
  });

  test('runner arch mapping is explicit and closed', () => {
    expect(mapNodeArch('x64')).toBe('amd64');
    expect(mapNodeArch('arm64')).toBe('arm64');
    expect(() => mapNodeArch('ppc64')).toThrow(/unsupported runner arch/);
    expect(['amd64', 'arm64']).toContain(expectedRunnerArch());
  });
});
