/**
 * Phase 0 container identity verification (isolated).
 *
 * Binds the live PostgreSQL server back to the exact Testcontainers
 * instance we started:
 *
 *  1. `docker inspect` the container id (no Docker SDK needed).
 *  2. Require our run label + disposable label on that container.
 *  3. Require the container's creation image reference to equal our pinned
 *     digest reference exactly (Testcontainers passes our string verbatim).
 *  4. `docker image inspect` the container's image id AND our pinned
 *     reference; require both to resolve to the SAME image id.
 *  5. Require the resolved image platform (os/arch) to match the runner.
 *  6. Consistency-check image-level RepoDigests when present (see below).
 *  7. Require every published 5432 binding to be loopback-only, including
 *     the URL port.
 *  8. Collect the container's own interface addresses; the normalized
 *     server address must equal one of THOSE (the server's view of a
 *     DNATed connection is its own interface IP), and the server port
 *     must equal the container port (5432), not the mapped host port.
 *
 * Root cause of the CI `no RepoDigests` FATAL (prompt12 Workstream B):
 * RepoDigests exists ONLY on Docker *image* objects (`ImageInspectInfo`),
 * never on *container* objects (`ContainerInspectInfo`) — verified against
 * the Docker API types. The old code read it from container inspect, so it
 * was always absent and the check could never pass on any Docker version.
 *
 * Trust argument for the new chain: the daemon is necessarily trusted (it
 * executes the container). Digest references are content addresses: the
 * daemon verifies blob hashes on pull/store, so resolving OUR pinned
 * digest to an image id re-verifies the manifest bytes by hash, and the
 * container's image id ties the running container to that resolution.
 * The manifest-list → platform-manifest → config chain was hash-verified
 * by the daemon at pull; our re-resolution re-anchors the pinned list
 * digest to the local image, and the platform assertion pins WHICH
 * platform entry was selected. No registry calls are made: re-fetching
 * manifests would only re-prove what the daemon's content addressing
 * already guarantees, while adding network/rate-limit failure modes.
 * Image-level RepoDigests is therefore a consistency signal (present but
 * missing our pin = inconsistent daemon state = reject), not the anchor:
 * its absence is daemon bookkeeping absence, while the resolution chain
 * above is the cryptographic proof.
 *
 * Anything unknown, missing, or ambiguous fails closed. Pure parsing and
 * policy live in testable functions; only the inspect helpers touch Docker.
 *
 * Known limitation (documented, not silent): @testcontainers/postgresql
 * exposes no host-interface pinning (`PortWithOptionalBinding` carries
 * only container/host ports + protocol), so loopback-only publication cannot
 * be ENFORCED at creation — it is VERIFIED post-hoc here and any
 * non-loopback binding fails the run loudly.
 */
import { execFile } from 'node:child_process';

export interface ContainerNetworkRecord {
  name: string;
  ipAddress: string;
  gateway: string;
}

export interface ContainerPortBinding {
  containerPort: number;
  hostIp: string;
  hostPort: number;
}

export interface ContainerInspection {
  id: string;
  name: string;
  labels: Record<string, string>;
  /** Creation-time image reference (Config.Image), e.g. our pinned digest ref. */
  configImage: string;
  /** Resolved local image id (top-level Image), `sha256:<config digest>`. */
  imageId: string;
  networks: ContainerNetworkRecord[];
  bindings: ContainerPortBinding[];
}

export interface ImageInspection {
  id: string;
  architecture: string;
  os: string;
  /** Daemon bookkeeping; may be empty on digest-only flows. See header. */
  repoDigests: string[];
}

export interface IdentityPolicy {
  expectedRunId: string;
  expectedImageRef: string; // e.g. 'postgres@sha256:<manifest-list digest>'
  expectedDb: string;
  expectedOs: string; // 'linux'
  expectedArch: string; // 'amd64' | 'arm64' (see expectedRunnerArch)
  urlPort: number; // mapped host port from the connection URL
  containerPort: number; // container-internal postgres port (5432)
}

export interface IdentityVerdict {
  ok: true;
  serverAddresses: string[]; // exact container IPs the server may present
  containerId: string;
  evidence: Record<string, string>;
}

export interface IdentityRejection {
  ok: false;
  reason: string;
  observed: Record<string, string>;
}

export class ContainerIdentityError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Map node arch to Docker arch names. Closed set; anything else fails closed. */
export function mapNodeArch(nodeArch: string): string {
  if (nodeArch === 'x64') return 'amd64';
  if (nodeArch === 'arm64') return 'arm64';
  throw new ContainerIdentityError(`unsupported runner arch "${nodeArch}" (want x64 or arm64)`);
}

/** The container arch the runner's Docker daemon must have selected. */
export function expectedRunnerArch(): string {
  return mapNodeArch(process.arch);
}

async function dockerInspectJson(args: string[], what: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: 30000 }, (err, stdout) => {
      if (err) {
        reject(new Error(`docker ${what} failed: ${String(err).slice(0, 200)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`docker ${what} returned unparseable output`));
      }
    });
  });
}

/** Parse raw container `docker inspect` JSON. Throws on unknown shape. */
export function parseInspection(raw: unknown): ContainerInspection {
  if (typeof raw !== 'object' || raw === null) throw new ContainerIdentityError('inspect: top-level value is not an object');
  const o = raw as Record<string, unknown>;
  const id = o.Id;
  const name = o.Name;
  if (typeof id !== 'string' || id.length < 12) throw new ContainerIdentityError('inspect: missing container id');
  if (typeof name !== 'string' || name.length === 0) throw new ContainerIdentityError('inspect: missing container name');
  const imageId = o.Image;
  if (typeof imageId !== 'string' || !imageId.startsWith('sha256:') || imageId.length < 20) {
    throw new ContainerIdentityError('inspect: missing or malformed container image id');
  }
  const config = (o.Config ?? {}) as Record<string, unknown>;
  const labels = (config.Labels ?? {}) as Record<string, unknown>;
  const configImage = config.Image;
  if (typeof configImage !== 'string' || configImage.length === 0) {
    throw new ContainerIdentityError('inspect: missing container creation image reference (Config.Image)');
  }
  const netSettings = (o.NetworkSettings ?? {}) as Record<string, unknown>;
  const networksRaw = (netSettings.Networks ?? {}) as Record<string, unknown>;
  const networks: ContainerNetworkRecord[] = [];
  for (const [netName, netVal] of Object.entries(networksRaw)) {
    const nv = (netVal ?? {}) as Record<string, unknown>;
    networks.push({
      name: netName,
      ipAddress: typeof nv.IPAddress === 'string' ? nv.IPAddress : '',
      gateway: typeof nv.Gateway === 'string' ? nv.Gateway : '',
    });
  }
  const portsRaw = (netSettings.Ports ?? {}) as Record<string, unknown>;
  const bindings: ContainerPortBinding[] = [];
  for (const [portKey, bindVal] of Object.entries(portsRaw)) {
    const containerPort = Number(String(portKey).split('/')[0]);
    if (!Number.isInteger(containerPort)) continue;
    if (bindVal === null) continue; // exposed but not published
    if (!Array.isArray(bindVal)) throw new ContainerIdentityError(`inspect: malformed Ports entry for ${portKey}`);
    for (const b of bindVal) {
      const bb = (b ?? {}) as Record<string, unknown>;
      if (typeof bb.HostIp !== 'string' || typeof bb.HostPort !== 'string') {
        throw new ContainerIdentityError(`inspect: malformed binding for ${portKey}`);
      }
      bindings.push({ containerPort, hostIp: bb.HostIp, hostPort: Number(bb.HostPort) });
    }
  }
  const labelStrings: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v === 'string') labelStrings[k] = v;
  }
  return { id, name, labels: labelStrings, configImage, imageId, networks, bindings };
}

/** Parse raw `docker image inspect` JSON. Throws on unknown shape. */
export function parseImageInspection(raw: unknown): ImageInspection {
  if (typeof raw !== 'object' || raw === null) {
    throw new ContainerIdentityError('image inspect: top-level value is not an object');
  }
  const o = raw as Record<string, unknown>;
  const id = o.Id;
  if (typeof id !== 'string' || !id.startsWith('sha256:') || id.length < 20) {
    throw new ContainerIdentityError('image inspect: missing or malformed image id');
  }
  const architecture = o.Architecture;
  const os = o.Os;
  if (typeof architecture !== 'string' || architecture.length === 0) {
    throw new ContainerIdentityError('image inspect: missing Architecture');
  }
  if (typeof os !== 'string' || os.length === 0) {
    throw new ContainerIdentityError('image inspect: missing Os');
  }
  const repoDigestsRaw = o.RepoDigests;
  const repoDigests = Array.isArray(repoDigestsRaw)
    ? repoDigestsRaw.filter((d): d is string => typeof d === 'string')
    : [];
  return { id, architecture, os, repoDigests };
}

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1']);

/** Split `repo@sha256:<hex>` into comparable parts; null when not a digest ref. */
function splitDigestRef(ref: string): { repo: string; digest: string } | null {
  const at = ref.lastIndexOf('@');
  if (at <= 0) return null;
  const repo = ref.slice(0, at);
  const digest = ref.slice(at + 1);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) return null;
  return { repo, digest };
}

/** Normalize docker.io/library/ prefixes so equivalent repos compare equal. */
function normalizeRepo(repo: string): string {
  return repo.replace(/^docker\.io\/library\//, '').replace(/^docker\.io\//, '');
}

/**
 * Whether an image-level RepoDigests entry names our pinned reference.
 * Compares digest hex exactly and requires repo compatibility after
 * registry-prefix normalization — `evil.io/postgres@<same-digest>` does
 * NOT match `postgres@<same-digest>`.
 */
export function repoDigestMatches(entry: string, expectedRef: string): boolean {
  const a = splitDigestRef(entry);
  const b = splitDigestRef(expectedRef);
  if (!a || !b) return false;
  if (a.digest !== b.digest) return false;
  return normalizeRepo(a.repo) === normalizeRepo(b.repo);
}

/**
 * Apply the identity policy over one container inspection plus the two
 * image inspections (by container image id, by pinned reference). Returns
 * the exact server addresses that may appear, or throws.
 */
export function assertContainerIdentity(
  inspection: ContainerInspection,
  imageById: ImageInspection,
  imageByRef: ImageInspection,
  policy: IdentityPolicy,
): IdentityVerdict {
  const observed: Record<string, string> = {
    container: `${inspection.name} (${inspection.id.slice(0, 12)})`,
  };
  const reject = (reason: string): never => {
    throw new ContainerIdentityError(`${reason} [observed: ${JSON.stringify(observed)}]`);
  };

  // 1. Run-label binding: this must be OUR container from THIS run.
  const runLabel = inspection.labels['openlevel.phase0.run'];
  observed.runLabel = runLabel ?? '(missing)';
  if (!runLabel) reject('missing run label openlevel.phase0.run');
  if (runLabel !== policy.expectedRunId) reject(`run label mismatch: expected ${policy.expectedRunId}`);
  const disposable = inspection.labels['openlevel.phase0.disposable'];
  if (disposable !== 'true') reject('disposable label missing or false');

  // 2. Creation-image binding: the container must have been created from
  // our pinned digest reference, exactly (Testcontainers passes it verbatim).
  observed.configImage = inspection.configImage;
  if (inspection.configImage !== policy.expectedImageRef) {
    reject(`container was created from a different image: expected ${policy.expectedImageRef}`);
  }

  // 3. Local image consistency: inspecting the container's image id must
  // return that same id (config digest == local image id).
  observed.imageId = inspection.imageId;
  if (imageById.id !== inspection.imageId) {
    reject('image inspect by container image id does not match container image');
  }

  // 4. Pinned-digest resolution: OUR pinned digest must resolve (by daemon
  // content addressing) to that same image. A different resolution means a
  // wrong manifest digest somewhere in the chain.
  observed.resolvedId = imageByRef.id;
  if (imageByRef.id !== inspection.imageId) {
    reject(`pinned image reference ${policy.expectedImageRef} resolves to a different image`);
  }

  // 5. Platform binding: the daemon must have selected the runner's
  // platform entry from the multi-arch manifest.
  observed.platform = `${imageById.os}/${imageById.architecture}`;
  if (imageById.os !== policy.expectedOs || imageById.architecture !== policy.expectedArch) {
    reject(`platform mismatch: expected ${policy.expectedOs}/${policy.expectedArch}`);
  }

  // 6. RepoDigests consistency signal (image-level, where the field lives):
  // absent = daemon bookkeeping absent (resolution chain above governs);
  // present-but-missing-our-pin = inconsistent daemon state = reject.
  observed.repoDigests = imageById.repoDigests.join(',') || '(none)';
  if (
    imageById.repoDigests.length > 0 &&
    !imageById.repoDigests.some((d) => repoDigestMatches(d, policy.expectedImageRef))
  ) {
    reject('image RepoDigests present but inconsistent with pinned reference');
  }

  // 7. Published-port binding: 5432 must be published, loopback-only.
  const pgBindings = inspection.bindings.filter((b) => b.containerPort === policy.containerPort);
  observed.bindings = pgBindings.map((b) => `${b.hostIp}:${b.hostPort}`).join(',') || '(none)';
  if (pgBindings.length === 0) reject(`no published binding for container port ${policy.containerPort}`);
  for (const b of pgBindings) {
    if (!LOOPBACK_IPS.has(b.hostIp)) {
      reject(`host binding ${b.hostIp}:${b.hostPort} is not loopback-only`);
    }
  }
  if (!pgBindings.some((b) => b.hostPort === policy.urlPort)) {
    reject(`URL port ${policy.urlPort} is not among published bindings`);
  }

  // 8. Collect this exact container's interface addresses (non-empty required).
  const addrs = [...new Set(inspection.networks.map((n) => n.ipAddress).filter((a) => a.length > 0))];
  observed.addresses = addrs.join(',') || '(none)';
  if (addrs.length === 0) reject('container has no interface addresses to match the server view against');

  return {
    ok: true,
    serverAddresses: addrs,
    containerId: inspection.id,
    evidence: {
      ...observed,
      imageId: inspection.imageId,
      platform: `${imageById.os}/${imageById.architecture}`,
      networks: inspection.networks.map((n) => `${n.name}=${n.ipAddress}`).join(','),
    },
  };
}

/**
 * Full flow: inspect container by id, inspect the image by id and by pinned
 * reference, then assert. Used by the orchestrator.
 */
export async function verifyContainerIdentity(
  containerId: string,
  policy: IdentityPolicy,
): Promise<IdentityVerdict> {
  const containerRaw = await dockerInspectJson(
    ['inspect', '--format', '{{json .}}', containerId],
    `inspect for ${containerId.slice(0, 12)}`,
  );
  const inspection = parseInspection(containerRaw);
  const byIdRaw = await dockerInspectJson(
    ['image', 'inspect', '--format', '{{json .}}', inspection.imageId],
    `image inspect for ${inspection.imageId.slice(0, 19)}`,
  );
  const byRefRaw = await dockerInspectJson(
    ['image', 'inspect', '--format', '{{json .}}', policy.expectedImageRef],
    `image inspect for pinned reference`,
  );
  return assertContainerIdentity(
    inspection,
    parseImageInspection(byIdRaw),
    parseImageInspection(byRefRaw),
    policy,
  );
}

/**
 * Decide a normalized server address against the verified container identity.
 * Pure; unit-tested. Only exact interface matches pass — arbitrary RFC1918
 * (including sibling containers and the bridge gateway) is rejected so the
 * failure names the evidence needed to revisit the policy deliberately.
 */
export function matchServerAddress(
  normalizedAddr: string,
  verdict: IdentityVerdict,
): { ok: true } | { ok: false; reason: string } {
  if (verdict.serverAddresses.includes(normalizedAddr)) return { ok: true };
  return {
    ok: false,
    reason:
      `server address "${normalizedAddr}" does not match container ${verdict.containerId.slice(0, 12)} ` +
      `interfaces [${verdict.serverAddresses.join(', ')}]`,
  };
}
