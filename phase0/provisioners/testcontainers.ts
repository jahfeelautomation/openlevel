/**
 * Testcontainers provisioner (prompt11 §4).
 *
 * Behavior-identical relocation of the original test-env.ts container
 * lifecycle: digest-pinned postgres:16.16, loopback-only mapping guard,
 * docker-inspect container-identity binding, SCRAM, state file, teardown.
 * The container adapter retains its exact image, container, network-
 * interface, and port-binding checks; nothing here was weakened to add
 * the native adapter beside it.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { assertDisposableUrl, connectGuarded, redactUrl } from '../db-guard.js';
import { verifyContainerIdentity } from '../container-identity.js';
import {
  newRunId,
  stateFilePath,
  type DownReport,
  type Provisioned,
  type Provisioner,
  type RuntimeEvidence,
} from './types.js';

/**
 * Pinned image (Adjustment 4 — captured 2026-11-15 from Docker Hub API):
 * postgres:16.16 manifest list
 * sha256:30551eca978d79ccf49d037bc297b5670baea61a04ceca42ff7fd3100163d3ce
 * (multi-arch; amd64+arm64 cover CI runners and Apple Silicon.)
 */
export const PG_IMAGE = 'postgres@sha256:30551eca978d79ccf49d037bc297b5670baea61a04ceca42ff7fd3100163d3ce';
export const PG_IMAGE_TAG = 'postgres:16.16'; // human label for the pinned digest above
export const SCRAM_REQUIRED = 'scram-sha-256';

export interface ContainerState extends Provisioned {
  containerId: string;
  containerName: string;
  host: string;
  port: number;
  bootstrapUser: string;
  image: string;
}

/** Build a postgres URL without ever logging the password beside it. */
export function buildUrl(opts: {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}): string {
  const u = new URL('postgres://placeholder.invalid/');
  u.hostname = opts.host;
  u.port = String(opts.port);
  u.username = opts.user;
  u.password = opts.password;
  u.pathname = `/${opts.database}`;
  return u.toString();
}

async function waitReady(url: string, timeoutMs: number): Promise<string> {
  const start = Date.now();
  let last: unknown = null;
  while (Date.now() - start < timeoutMs) {
    const probe = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
    try {
      const r = await probe.query('SELECT version() AS v');
      await probe.end().catch(() => undefined);
      return (r.rows[0] as { v: string }).v;
    } catch (err) {
      last = err;
      await probe.end().catch(() => undefined);
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  throw new Error(`postgres readiness timeout: ${String(last).slice(0, 200)}`);
}

async function assertScram(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const r = await pool.query('SHOW password_encryption');
    const value = (r.rows[0] as { password_encryption: string }).password_encryption;
    if (value !== SCRAM_REQUIRED) throw new Error(`password_encryption is '${value}', required '${SCRAM_REQUIRED}'`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export const testcontainersProvisioner: Provisioner = {
  name: 'testcontainers',

  async up(): Promise<Provisioned> {
    const id = newRunId();
    const password = randomBytes(24).toString('hex');
    const user = 'phase0_owner';
    const database = 'phase0_proofs';
    let container: StartedPostgreSqlContainer;
    try {
      container = await new PostgreSqlContainer(PG_IMAGE)
        .withDatabase(database)
        .withUsername(user)
        .withPassword(password)
        .withLabels({ 'openlevel.phase0.run': id, 'openlevel.phase0.disposable': 'true' })
        .withStartupTimeout(180_000)
        .start();
    } catch (err) {
      throw new Error(
        `container start failed (is Docker running?): ${String(err).slice(0, 300)}. ` +
          `Without Docker, use phase0/LOCAL_POSTGRES_RUNBOOK.md instead.`,
      );
    }
    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const url = buildUrl({ user, password, host, port, database });
    // Adjustment 3: the existing loopback-only guard judges the container URL.
    // Never weakened: a non-loopback mapping fails the run, loudly.
    assertDisposableUrl(url, 'test-env(container)');
    // Container-identity binding: inspect OUR container and require run label,
    // pinned digest, loopback-only publication, and interface addresses that
    // the live DB checks will match exactly. Anything else fails closed here,
    // before any test connects.
    const identity = await verifyContainerIdentity(container.getId(), {
      expectedRunId: id,
      expectedImageRef: PG_IMAGE,
      expectedDb: database,
      urlPort: port,
      containerPort: 5432,
    });
    process.env.PHASE0_VERIFIED_ADDRS = identity.serverAddresses.join(',');
    process.env.PHASE0_CONTAINER_PORT = '5432';
    console.log(`identity: container ${identity.containerId.slice(0, 12)} verified (${identity.evidence.networks})`);
    console.log(`identity: server view must match [${identity.serverAddresses.join(', ')}], port 5432`);
    const version = await waitReady(url, 120_000);
    await assertScram(url);
    const state: ContainerState = {
      provisioner: 'testcontainers',
      executionId: id,
      runIds: [id],
      containerId: container.getId(),
      containerName: container.getName(),
      host,
      port,
      database,
      bootstrapUser: user,
      image: `${PG_IMAGE_TAG} (${PG_IMAGE})`,
      startedAt: new Date().toISOString(),
    };
    console.log(`container: ${state.containerName} (${state.containerId.slice(0, 12)}) host=${host} port=${port}`);
    console.log(`postgres: ${version.split(' ').slice(0, 2).join(' ')} auth=${SCRAM_REQUIRED} (verified)`);
    console.log(`url: ${redactUrl(url)}`);
    writeFileSync(stateFilePath(), JSON.stringify({ ...state, bootstrapPassword: password }, null, 2), {
      mode: 0o600,
    });
    // Stash the live container handle for in-process teardown (run mode).
    (globalThis as Record<string, unknown>).__phase0_container = container;
    process.env.PHASE0_DATABASE_URL = url;
    process.env.PHASE0_BOOT_PASSWORD = password;
    process.env.PHASE0_RT_PASSWORD = randomBytes(24).toString('hex');
    process.env.PHASE0_RUN_ID = id;
    const { containerId: _c, containerName: _n, host: _h, port: _p, bootstrapUser: _u, image: _i, ...base } = state;
    return base;
  },

  async verifyRuntime(rtUrl: string): Promise<RuntimeEvidence> {
    process.env.PHASE0_RT_URL = rtUrl;
    const { pool, report } = await connectGuarded('PHASE0_RT_URL');
    try {
      if (report.user !== 'phase0_rt') {
        throw new Error(`refusing to run: runtime URL resolves to "${report.user}", not phase0_rt`);
      }
      const guc = await pool.query('SHOW password_encryption');
      const passwordEncryption = (guc.rows[0] as { password_encryption: string }).password_encryption;
      if (passwordEncryption !== SCRAM_REQUIRED) {
        throw new Error(`refusing to run: password_encryption is '${passwordEncryption}', required '${SCRAM_REQUIRED}'`);
      }
      return {
        provisioner: 'testcontainers',
        runtimeUser: report.user,
        serverVersion: report.serverVersion,
        serverAddress: report.serverAddress,
        serverPort: report.serverPort,
        scram: {
          passwordEncryption,
          hbaRule: 'container-managed (official image initdb)',
          verifierFormat: 'container-managed',
          passwordLogin: true,
        },
      };
    } finally {
      await pool.end().catch(() => undefined);
    }
  },

  async down(_state: Provisioned): Promise<DownReport> {
    const live = (globalThis as Record<string, unknown>).__phase0_container as
      | StartedPostgreSqlContainer
      | undefined;
    if (live) {
      await live.stop();
      delete (globalThis as Record<string, unknown>).__phase0_container;
      console.log('container stopped (in-process handle)');
    } else if (existsSync(stateFilePath())) {
      console.log('no live handle; remove the container with: docker rm -f <id from evidence log>');
    }
    rmSync(stateFilePath(), { force: true });
    console.log('teardown complete');
    return {
      provisioner: 'testcontainers',
      cleaned: live ? ['container (all databases, roles, and schemas inside it)'] : [],
      retained: live ? [] : [{ item: 'container', reason: 'no live handle in this process' }],
    };
  },
};
