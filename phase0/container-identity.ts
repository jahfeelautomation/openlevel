/**
 * Phase 0 container identity verification (isolated).
 *
 * Closes the gap review3 left open: accepting "any RFC1918 address" does not
 * prove the database IS our container. This module binds the live PostgreSQL
 * server back to the exact Testcontainers instance we started:
 *
 *  1. `docker inspect` the container id (no Docker SDK needed).
 *  2. Require our run label + the pinned image digest on that container.
 *  3. Require every published 5432 binding to be loopback-only.
 *  4. Collect the container's own interface addresses.
 *  5. Require the normalized server address to equal one of THOSE addresses
 *     (the server's view of a DNATed connection is its own interface IP),
 *     and the server port to equal the container port (5432), not the
 *     mapped host port.
 *
 * Anything unknown, missing, or ambiguous fails closed. Pure parsing and
 * policy live in testable functions; only `inspectContainer` touches Docker.
 *
 * Known limitation (documented, not silent): @testcontainers/postgresql
 * 12.2.1 exposes no host-interface pinning (`PortWithOptionalBinding` carries
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
  repoDigests: string[];
  networks: ContainerNetworkRecord[];
  bindings: ContainerPortBinding[];
}

export interface IdentityPolicy {
  expectedRunId: string;
  expectedImageRef: string; // e.g. 'postgres@sha256:<manifest digest>'
  expectedDb: string;
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

async function dockerInspect(containerId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile('docker', ['inspect', '--format', '{{json .}}', containerId], { timeout: 30000 }, (err, stdout) => {
      if (err) {
        reject(new Error(`docker inspect failed for ${containerId.slice(0, 12)}: ${String(err).slice(0, 200)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('docker inspect returned unparseable output'));
      }
    });
  });
}

/** Parse raw `docker inspect` JSON into a ContainerInspection. Throws on unknown shape. */
export function parseInspection(raw: unknown): ContainerInspection {
  if (typeof raw !== 'object' || raw === null) throw new ContainerIdentityError('inspect: top-level value is not an object');
  const o = raw as Record<string, unknown>;
  const id = o.Id;
  const name = o.Name;
  if (typeof id !== 'string' || id.length < 12) throw new ContainerIdentityError('inspect: missing container id');
  if (typeof name !== 'string' || name.length === 0) throw new ContainerIdentityError('inspect: missing container name');
  const config = (o.Config ?? {}) as Record<string, unknown>;
  const labels = (config.Labels ?? {}) as Record<string, unknown>;
  const repoDigestsRaw = o.RepoDigests;
  const repoDigests = Array.isArray(repoDigestsRaw) ? repoDigestsRaw.filter((d): d is string => typeof d === 'string') : [];
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
  return { id, name, labels: labelStrings, repoDigests, networks, bindings };
}

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1']);

/**
 * Apply the identity policy. Returns the exact server addresses that may
 * appear (container interface IPs) or throws ContainerIdentityError.
 */
export function assertContainerIdentity(
  inspection: ContainerInspection,
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

  // 2. Image digest binding: the exact pinned image, not a same-tag rebuild.
  observed.repoDigests = inspection.repoDigests.join(',') || '(none)';
  if (inspection.repoDigests.length === 0) reject('no RepoDigests present to verify image identity');
  if (!inspection.repoDigests.includes(policy.expectedImageRef)) {
    reject(`image digest mismatch: expected ${policy.expectedImageRef}`);
  }

  // 3. Published-port binding: 5432 must be published, loopback-only.
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

  // 4. Collect this exact container's interface addresses (non-empty required).
  const addrs = [...new Set(inspection.networks.map((n) => n.ipAddress).filter((a) => a.length > 0))];
  observed.addresses = addrs.join(',') || '(none)';
  if (addrs.length === 0) reject('container has no interface addresses to match the server view against');

  return {
    ok: true,
    serverAddresses: addrs,
    containerId: inspection.id,
    evidence: {
      ...observed,
      networks: inspection.networks.map((n) => `${n.name}=${n.ipAddress}`).join(','),
    },
  };
}

/** Full flow: inspect by id, then assert. Used by the orchestrator. */
export async function verifyContainerIdentity(
  containerId: string,
  policy: IdentityPolicy,
): Promise<IdentityVerdict> {
  const raw = await dockerInspect(containerId);
  return assertContainerIdentity(parseInspection(raw), policy);
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
